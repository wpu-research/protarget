import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { execFile } from 'node:child_process';

export type MediaKind = 'VIDEO' | 'IMAGE';
export class MediaToolUnavailable extends Error {
  constructor() { super('ffprobe is not available'); this.name = 'MediaToolUnavailable'; }
}
export interface SniffedType { mime: 'video/mp4' | 'image/png' | 'image/jpeg'; kind: MediaKind }
export interface ProbeResult { durationSeconds: number | null; width: number | null; height: number | null; videoCodec: string | null }
export type InspectResult =
  | { ok: true; type: SniffedType; probe: ProbeResult }
  | { ok: false; reason: string; type: SniffedType | null };

/** Type is decided from magic bytes, never from the client-supplied name or Content-Type. */
export function sniff(head: Buffer): SniffedType | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', kind: 'IMAGE' };
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mime: 'image/jpeg', kind: 'IMAGE' };
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') return { mime: 'video/mp4', kind: 'VIDEO' };
  return null;
}

export async function readHead(path: string, bytes = 16): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('error', reject).on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(`sha256:${hash.digest('hex')}`));
  });
}

interface FfprobeStream {
  codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string;
  disposition?: { attached_pic?: number }; tags?: { rotate?: string };
  side_data_list?: { rotation?: number | string }[];
}
interface FfprobeOutput { streams?: FfprobeStream[]; format?: { duration?: string; format_name?: string; tags?: { major_brand?: string } } }

/** Largest accepted edge, in pixels, for images and video (after rotation). */
export const MAX_DIMENSION = 8192;
/** ISO base media brands that denote a real MP4 (not QuickTime/3GP/etc., which share ffprobe's `mov,mp4,...` name). */
export const MP4_BRANDS: readonly string[] = ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V', 'dash'];
/** Spawn/resource faults that say nothing about the uploaded file. */
const TOOL_FAULT_CODES = ['ENOENT', 'ENOBUFS', 'EACCES', 'EAGAIN', 'ENOMEM', 'EMFILE', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'];

export type FfprobeRunner = (path: string) => Promise<FfprobeOutput>;
export const runFfprobe: FfprobeRunner = path => new Promise((resolve, reject) => {
  execFile(process.env.FFPROBE_PATH || 'ffprobe',
    ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_streams', '-show_format', '--', path],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout) as FfprobeOutput); } catch (parseError) { reject(parseError); }
    });
});

const positiveInt = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
const positiveSeconds = (value: unknown) => {
  const n = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
};

const rotationOf = (stream: FfprobeStream): number => {
  const raw = stream.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0;
  const degrees = Number(raw);
  return Number.isFinite(degrees) ? ((Math.round(degrees) % 360) + 360) % 360 : 0;
};

/** Pure interpretation of ffprobe output; failures become rejection reasons, not exceptions. */
export function interpretProbe(type: SniffedType, output: FfprobeOutput): InspectResult {
  const streams = output.streams ?? [];
  // Cover art (attached_pic) is not playable video.
  const video = streams.find(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
  if (!video) return { ok: false, reason: 'NO_VISUAL_STREAM', type };
  let width = positiveInt(video.width);
  let height = positiveInt(video.height);
  if (!width || !height) return { ok: false, reason: 'UNKNOWN_DIMENSIONS', type };
  if (type.kind === 'IMAGE') {
    const expected = type.mime === 'image/png' ? 'png' : 'mjpeg';
    if (video.codec_name !== expected) return { ok: false, reason: 'IMAGE_DECODE_MISMATCH', type };
    if (Math.max(width, height) > MAX_DIMENSION) return { ok: false, reason: 'DIMENSIONS_TOO_LARGE', type };
    return { ok: true, type, probe: { durationSeconds: null, width, height, videoCodec: null } };
  }
  const brand = (output.format?.tags?.major_brand ?? '').trim();
  if (!(output.format?.format_name ?? '').split(',').includes('mp4') || !MP4_BRANDS.includes(brand)) {
    return { ok: false, reason: 'NOT_MP4_CONTAINER', type };
  }
  if (video.codec_name !== 'h264') return { ok: false, reason: 'VIDEO_CODEC_NOT_H264', type };
  const rotation = rotationOf(video);
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  if (Math.max(width, height) > MAX_DIMENSION) return { ok: false, reason: 'DIMENSIONS_TOO_LARGE', type };
  const durationSeconds = positiveSeconds(output.format?.duration) ?? positiveSeconds(video.duration);
  if (!durationSeconds) return { ok: false, reason: 'UNKNOWN_DURATION', type };
  return { ok: true, type, probe: { durationSeconds, width, height, videoCodec: 'h264' } };
}

export async function inspectMedia(path: string, probe: FfprobeRunner = runFfprobe): Promise<InspectResult> {
  const type = sniff(await readHead(path));
  if (!type) return { ok: false, reason: 'UNSUPPORTED_TYPE', type: null };
  let output: FfprobeOutput;
  try { output = await probe(path); } catch (error) {
    // Timeouts, signals, spawn/resource faults are operations faults (503, nothing stored); only a normal
    // non-zero exit says the file itself is unreadable.
    const fault = error as { code?: unknown; killed?: unknown; signal?: unknown };
    if (fault.killed || fault.signal || (typeof fault.code === 'string' && TOOL_FAULT_CODES.includes(fault.code))) throw new MediaToolUnavailable();
    return { ok: false, reason: 'UNREADABLE_MEDIA', type };
  }
  return interpretProbe(type, output);
}
