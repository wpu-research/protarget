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

interface FfprobeStream { codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }
interface FfprobeOutput { streams?: FfprobeStream[]; format?: { duration?: string; format_name?: string } }

export type FfprobeRunner = (path: string) => Promise<FfprobeOutput>;
export const runFfprobe: FfprobeRunner = path => new Promise((resolve, reject) => {
  execFile(process.env.FFPROBE_PATH || 'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', '--', path],
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

/** Pure interpretation of ffprobe output; failures become rejection reasons, not exceptions. */
export function interpretProbe(type: SniffedType, output: FfprobeOutput): InspectResult {
  const streams = output.streams ?? [];
  const video = streams.find(stream => stream.codec_type === 'video');
  if (!video) return { ok: false, reason: 'NO_VISUAL_STREAM', type };
  const width = positiveInt(video.width);
  const height = positiveInt(video.height);
  if (!width || !height) return { ok: false, reason: 'UNKNOWN_DIMENSIONS', type };
  if (type.kind === 'IMAGE') {
    const expected = type.mime === 'image/png' ? 'png' : 'mjpeg';
    if (video.codec_name !== expected) return { ok: false, reason: 'IMAGE_DECODE_MISMATCH', type };
    return { ok: true, type, probe: { durationSeconds: null, width, height, videoCodec: null } };
  }
  if (!(output.format?.format_name ?? '').split(',').includes('mp4')) return { ok: false, reason: 'NOT_MP4_CONTAINER', type };
  if (video.codec_name !== 'h264') return { ok: false, reason: 'VIDEO_CODEC_NOT_H264', type };
  const durationSeconds = positiveSeconds(output.format?.duration) ?? positiveSeconds(video.duration);
  if (!durationSeconds) return { ok: false, reason: 'UNKNOWN_DURATION', type };
  return { ok: true, type, probe: { durationSeconds, width, height, videoCodec: 'h264' } };
}

export async function inspectMedia(path: string, probe: FfprobeRunner = runFfprobe): Promise<InspectResult> {
  const type = sniff(await readHead(path));
  if (!type) return { ok: false, reason: 'UNSUPPORTED_TYPE', type: null };
  let output: FfprobeOutput;
  try { output = await probe(path); } catch (error) {
    // A missing ffprobe binary is an operations fault, not a property of the uploaded file.
    if ((error as { code?: unknown }).code === 'ENOENT') throw new MediaToolUnavailable();
    return { ok: false, reason: 'UNREADABLE_MEDIA', type };
  }
  return interpretProbe(type, output);
}
