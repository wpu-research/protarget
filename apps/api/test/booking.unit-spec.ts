import 'reflect-metadata';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BOOKING_STATUSES, BOOKING_TRANSITIONS, canBookingTransition } from '@protarget/shared';
import { findScheduleOverlap, slotSegments, validateBooking, weeklyWindowHours, type ValidationInput } from '../src/modules/campaigns/booking-rules';
import { interpretProbe, inspectMedia, MediaToolUnavailable, sniff } from '../src/modules/creatives/media';
import { CreativesService, safeFilename } from '../src/modules/creatives/creatives.service';
import { LocalDiskStorage, S3Storage, storageConfig } from '../src/common/storage/object-storage';
import { CreateCmsOperationDto, ReplaceScheduleDto, UpdateCampaignDto } from '../src/modules/campaigns/campaigns.dto';

const tz = 'Europe/Istanbul';
const screen = (extra: Partial<ValidationInput['screens'][number]> = {}): ValidationInput['screens'][number] => ({
  code: 'SCR-1', active: true, deleted: false, venueActive: true, timezone: tz, operatingStart: '06:00', operatingEnd: '23:00',
  defaultSlotLengthSec: 15, resolutionWidth: 1920, resolutionHeight: 1080, hasMultiplier: true, cmsUploaded: true, ...extra,
});
const base = (extra: Partial<ValidationInput> = {}): ValidationInput => ({
  status: 'DRAFT', startAt: new Date('2030-01-01T00:00:00Z'), endAt: new Date('2030-02-01T00:00:00Z'), timezone: tz,
  primaryGoal: 'PLAYOUTS', targetPlayouts: 1000n, targetImpressions: null,
  commercial: { pricingModel: 'CPM', unitPrice: '1', contractedAmount: null, guaranteedImpressions: null, contractedQuantity: null },
  screens: [screen()], creatives: [{ status: 'APPROVED', durationSeconds: 10, width: 1920, height: 1080 }],
  schedule: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }], ...extra,
});
const now = new Date('2029-12-01T00:00:00Z');
const codes = (list: { code: string }[]) => list.map(item => item.code);

describe('booking state machine (simplified manual-CMS subset)', () => {
  it('allows only the approved transitions', () => {
    expect(canBookingTransition('DRAFT', 'READY')).toBe(true);
    expect(canBookingTransition('READY', 'LIVE')).toBe(true);
    expect(canBookingTransition('LIVE', 'PAUSED')).toBe(true);
    expect(canBookingTransition('PAUSED', 'LIVE')).toBe(true);
    expect(canBookingTransition('PAUSED', 'COMPLETED')).toBe(true);
    expect(canBookingTransition('DRAFT', 'LIVE')).toBe(false);
    expect(canBookingTransition('LIVE', 'CANCELLED')).toBe(false);
    expect(canBookingTransition('COMPLETED', 'LIVE')).toBe(false);
    expect(canBookingTransition('READY_FOR_REVIEW', 'READY')).toBe(false);
    expect(canBookingTransition('LIVE', 'PAUSING')).toBe(false);
    for (const status of BOOKING_STATUSES) expect(BOOKING_TRANSITIONS[status]).toBeDefined();
  });
});

describe('schedule geometry', () => {
  it('splits overnight dayparts and wraps Sunday into Monday', () => {
    expect(slotSegments({ dayOfWeek: 1, startTime: '08:00', endTime: '10:00' })).toEqual([[480, 600]]);
    expect(slotSegments({ dayOfWeek: 7, startTime: '23:00', endTime: '01:00' })).toEqual([[6 * 1440 + 1380, 7 * 1440], [0, 60]]);
    expect(slotSegments({ dayOfWeek: 2, startTime: '22:00', endTime: '00:00' })).toEqual([[1440 + 1320, 2880]]);
  });
  it('detects overlaps including overnight spill and touching edges are allowed', () => {
    expect(findScheduleOverlap([{ dayOfWeek: 1, startTime: '08:00', endTime: '10:00' }, { dayOfWeek: 1, startTime: '10:00', endTime: '12:00' }])).toBe(-1);
    expect(findScheduleOverlap([{ dayOfWeek: 1, startTime: '08:00', endTime: '10:00' }, { dayOfWeek: 1, startTime: '09:59', endTime: '12:00' }])).toBe(1);
    expect(findScheduleOverlap([{ dayOfWeek: 7, startTime: '22:00', endTime: '02:00' }, { dayOfWeek: 1, startTime: '01:00', endTime: '03:00' }])).toBe(1);
  });
  it('computes weekly window hours only when hours and timezone are known', () => {
    const slots = [{ dayOfWeek: 1, startTime: '05:00', endTime: '07:00' }, { dayOfWeek: 3, startTime: '22:00', endTime: '01:00' }];
    expect(weeklyWindowHours(slots, tz, { operatingStart: '06:00', operatingEnd: '23:00', timezone: tz })).toBe(2);
    expect(weeklyWindowHours(slots, tz, { operatingStart: '20:00', operatingEnd: '02:00', timezone: tz })).toBe(3);
    expect(weeklyWindowHours(slots, tz, { operatingStart: null, operatingEnd: null, timezone: tz })).toBeNull();
    expect(weeklyWindowHours(slots, tz, { operatingStart: '06:00', operatingEnd: '23:00', timezone: 'Europe/Athens' })).toBeNull();
    expect(weeklyWindowHours(slots, tz, { operatingStart: '6:00', operatingEnd: '23:00', timezone: tz })).toBeNull();
  });
});

describe('launch validation', () => {
  it('passes a complete booking with only the CMS upload outstanding', () => {
    const result = validateBooking(base({ screens: [screen({ cmsUploaded: false })] }), now);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.missingCmsUpload).toEqual(['SCR-1']);
  });
  it('reports every blocker for an empty booking', () => {
    const result = validateBooking(base({ screens: [], creatives: [], schedule: [], primaryGoal: null }), now);
    expect(codes(result.blockers)).toEqual(['NO_SCREENS', 'NO_APPROVED_CREATIVE', 'NO_GOAL', 'NO_SCHEDULE']);
  });
  it('requires the target matching the primary goal and multipliers for impression goals', () => {
    expect(codes(validateBooking(base({ primaryGoal: 'IMPRESSIONS', targetPlayouts: 5n }), now).blockers)).toContain('NO_GOAL');
    const result = validateBooking(base({ primaryGoal: 'IMPRESSIONS', targetImpressions: 5n,
      screens: [screen(), screen({ code: 'SCR-2', hasMultiplier: false })] }), now);
    expect(result.blockers).toEqual([{ code: 'MISSING_MULTIPLIER', screens: ['SCR-2'] }]);
    expect(codes(validateBooking(base({ screens: [screen({ hasMultiplier: false })] }), now).blockers)).toEqual([]);
  });
  it('blocks inactive screens, closed windows and too-long creatives; warns on unknowns', () => {
    const result = validateBooking(base({
      screens: [screen({ code: 'OFF', active: false }), screen({ code: 'SHIP-OFF', venueActive: false }),
        screen({ code: 'NIGHT', operatingStart: '13:00', operatingEnd: '17:00' }), screen({ code: 'SHORT', defaultSlotLengthSec: 5 }),
        screen({ code: 'UNKNOWN', operatingStart: null, operatingEnd: null, defaultSlotLengthSec: null, resolutionWidth: null, resolutionHeight: null }),
        screen({ code: 'ATHENS', timezone: 'Europe/Athens' }), screen({ code: 'PORTRAIT', resolutionWidth: 1080, resolutionHeight: 1920 })],
      creatives: [{ status: 'APPROVED', durationSeconds: 10, width: 1920, height: 1080 }, { status: 'VALIDATING', durationSeconds: 60, width: 1, height: 1 }],
    }), now);
    expect(result.blockers).toEqual([
      { code: 'INACTIVE_SCREENS', screens: ['OFF', 'SHIP-OFF'] },
      { code: 'NO_PLAYBACK_WINDOW', screens: ['NIGHT'] },
      { code: 'CREATIVE_TOO_LONG', screens: ['SHORT'] },
    ]);
    expect(result.warnings).toEqual([
      { code: 'UNAPPROVED_CREATIVES', screens: [] },
      { code: 'OPERATING_HOURS_UNKNOWN', screens: ['UNKNOWN'] },
      { code: 'TIMEZONE_MISMATCH', screens: ['ATHENS'] },
      { code: 'SLOT_LENGTH_UNKNOWN', screens: ['UNKNOWN'] },
      { code: 'RESOLUTION_MISMATCH', screens: ['PORTRAIT'] },
    ]);
  });
  it('treats an ended flight as a blocker before launch and a warning while running', () => {
    const ended = { endAt: new Date('2029-11-01T00:00:00Z'), startAt: new Date('2029-10-01T00:00:00Z') };
    expect(codes(validateBooking(base(ended), now).blockers)).toContain('INVALID_FLIGHT');
    const running = validateBooking(base({ ...ended, status: 'LIVE' }), now);
    expect(codes(running.blockers)).not.toContain('INVALID_FLIGHT');
    expect(codes(running.warnings)).toContain('FLIGHT_ENDED');
  });
  it('applies conditional commercial requirements; an empty model is only a warning', () => {
    const commercial = (extra: object) => ({ ...base().commercial, unitPrice: null, ...extra });
    expect(codes(validateBooking(base({ commercial: commercial({ pricingModel: null }) }), now).warnings)).toContain('NO_COMMERCIAL_TERMS');
    expect(codes(validateBooking(base({ commercial: commercial({ pricingModel: 'CPM' }) }), now).blockers)).toContain('INVALID_COMMERCIAL');
    expect(codes(validateBooking(base({ commercial: commercial({ pricingModel: 'FIXED', contractedAmount: '5' }) }), now).blockers)).toEqual([]);
    expect(codes(validateBooking(base({ commercial: commercial({ pricingModel: 'PG', unitPrice: '1' }) }), now).blockers)).toContain('INVALID_COMMERCIAL');
    expect(codes(validateBooking(base({ commercial: commercial({ pricingModel: 'PG', unitPrice: '1', contractedQuantity: 9n }) }), now).blockers)).toEqual([]);
  });
});

describe('booking DTO validation', () => {
  const errors = (cls: new () => object, value: object) => validateSync(plainToInstance(cls, value), { whitelist: true, forbidNonWhitelisted: true });
  it('accepts only plain decimal strings and positive integer counts', () => {
    expect(errors(UpdateCampaignDto, { unitPrice: '12.3456', budget: '99999999999999.9999', publisherSharePct: '100.00', targetPlayouts: '1' })).toHaveLength(0);
    for (const bad of [{ unitPrice: '1e3' }, { unitPrice: '0.0000' }, { unitPrice: '1.23456' }, { unitPrice: 5 }, { budget: '-1' },
      { publisherSharePct: '100.01' }, { overdeliveryTolerancePct: '101' }, { targetPlayouts: '0' }, { targetImpressions: '1.5' },
      { maxPlayoutsPerHourPerScreen: 0 }, { currency: 'EUR' }, { primaryGoal: 'CLICKS' }, { startAt: '2030-01-01T10:00:00+03:00' }, { timezone: 'Mars/Base' }]) {
      expect(errors(UpdateCampaignDto, bad).length).toBeGreaterThan(0);
    }
  });
  it('validates dayparts and CMS operations', () => {
    expect(errors(ReplaceScheduleDto, { slots: [{ dayOfWeek: 1, startTime: '24:00', endTime: '10:00' }] }).length).toBeGreaterThan(0);
    expect(errors(ReplaceScheduleDto, { slots: Array.from({ length: 51 }, () => ({ dayOfWeek: 1, startTime: '01:00', endTime: '02:00' })) }).length).toBeGreaterThan(0);
    expect(errors(CreateCmsOperationDto, { screenId: '00000000-0000-4000-8000-000000000000', type: 'PLAYBACK_STARTED', performedAt: '2030-01-01T00:00:00Z' })).toHaveLength(0);
    expect(errors(CreateCmsOperationDto, { screenId: '00000000-0000-4000-8000-000000000000', type: 'PROOF_OF_PLAY', performedAt: '2030-01-01T00:00:00Z' }).length).toBeGreaterThan(0);
  });
});

describe('creative media inspection', () => {
  const png = { mime: 'image/png' as const, kind: 'IMAGE' as const };
  const mp4 = { mime: 'video/mp4' as const, kind: 'VIDEO' as const };
  it('sniffs magic bytes, not names', () => {
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual(png);
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniff(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom')]))).toEqual(mp4);
    expect(sniff(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniff(Buffer.alloc(0))).toBeNull();
  });
  it('interprets ffprobe output into metadata or rejection reasons', () => {
    const video = { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 };
    expect(interpretProbe(mp4, { streams: [video], format: { duration: '15.0004', format_name: 'mov,mp4,m4a' } }))
      .toEqual({ ok: true, type: mp4, probe: { durationSeconds: 15, width: 1920, height: 1080, videoCodec: 'h264' } });
    expect(interpretProbe(mp4, { streams: [{ ...video, codec_name: 'hevc' }], format: { duration: '5', format_name: 'mov,mp4' } })).toMatchObject({ ok: false, reason: 'VIDEO_CODEC_NOT_H264' });
    expect(interpretProbe(mp4, { streams: [video], format: { duration: '5', format_name: 'matroska,webm' } })).toMatchObject({ ok: false, reason: 'NOT_MP4_CONTAINER' });
    expect(interpretProbe(mp4, { streams: [video], format: { duration: 'N/A', format_name: 'mov,mp4' } })).toMatchObject({ ok: false, reason: 'UNKNOWN_DURATION' });
    expect(interpretProbe(mp4, { streams: [{ codec_type: 'audio' }], format: {} })).toMatchObject({ ok: false, reason: 'NO_VISUAL_STREAM' });
    expect(interpretProbe(png, { streams: [{ codec_type: 'video', codec_name: 'png', width: 0, height: 10 }] })).toMatchObject({ ok: false, reason: 'UNKNOWN_DIMENSIONS' });
    expect(interpretProbe(png, { streams: [{ codec_type: 'video', codec_name: 'mjpeg', width: 10, height: 10 }] })).toMatchObject({ ok: false, reason: 'IMAGE_DECODE_MISMATCH' });
  });
  it('treats a missing ffprobe binary as an operations fault, not a rejection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const file = join(dir, 'x.png');
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]));
    await expect(inspectMedia(file, () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOENT' })))).rejects.toBeInstanceOf(MediaToolUnavailable);
    await expect(inspectMedia(file, () => Promise.reject(new Error('corrupt')))).resolves.toMatchObject({ ok: false, reason: 'UNREADABLE_MEDIA' });
  });
  it('sanitizes filenames', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\x\\spot "one".mp4')).toBe('spot one.mp4');
    expect(safeFilename('a\u0000b\r\n.mp4')).toBe('ab.mp4');
    expect(safeFilename(undefined)).toBe('upload');
    expect(safeFilename('x'.repeat(400))).toHaveLength(255);
  });
});

describe('object storage', () => {
  const key = 'creatives/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
  it('never falls back to container disk in production and validates driver settings', () => {
    expect(storageConfig({ NODE_ENV: 'production' })).toEqual({ driver: 'disabled' });
    expect(storageConfig({ NODE_ENV: 'test' }).driver).toBe('local');
    expect(() => storageConfig({ STORAGE_DRIVER: 'local' })).toThrow('STORAGE_LOCAL_DIR');
    expect(() => storageConfig({ STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: 'relative' })).toThrow('STORAGE_LOCAL_DIR');
    expect(() => storageConfig({ STORAGE_DRIVER: 'ftp' })).toThrow('STORAGE_DRIVER');
    expect(() => storageConfig({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY: 'a' })).toThrow('S3_SECRET_KEY');
    expect(() => storageConfig({ NODE_ENV: 'production', STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's',
      S3_ENDPOINT: 'http://minio:9000' })).toThrow('S3_ENDPOINT');
    expect(storageConfig({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's', S3_FORCE_PATH_STYLE: 'true' }))
      .toMatchObject({ driver: 's3', s3: { bucket: 'b', region: 'us-east-1', forcePathStyle: true } });
  });
  it('stores, streams and deletes on local disk; refuses foreign keys and overwrites', async () => {
    const root = mkdtempSync(join(tmpdir(), 'store-'));
    const source = join(root, 'src.bin');
    writeFileSync(source, 'payload');
    const storage = new LocalDiskStorage(root);
    await storage.put(key, source, 'video/mp4');
    await expect(storage.put(key, source, 'video/mp4')).rejects.toThrow();
    const out = await storage.get(key);
    expect(out.size).toBe(7);
    expect(Buffer.concat(await out.stream.toArray()).toString()).toBe('payload');
    await expect(storage.put('../../escape', source, 'video/mp4')).rejects.toThrow('Invalid storage key');
    await storage.delete(key);
    expect(existsSync(join(root, key))).toBe(false);
    await expect(storage.get(key)).rejects.toMatchObject({ status: 404 });
  });
  it('sends bucket, key, length and type to S3 without exposing credentials', async () => {
    const root = mkdtempSync(join(tmpdir(), 's3-'));
    const source = join(root, 'src.bin');
    writeFileSync(source, 'abc');
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const client = { send: jest.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === 'GetObjectCommand') return { Body: Readable.from(['abc']), ContentLength: 3 };
      return {};
    }) };
    const storage = new S3Storage({ bucket: 'creatives', region: 'eu', accessKeyId: 'AK', secretAccessKey: 'SK', forcePathStyle: true },
      client as never);
    await storage.put(key, source, 'image/png');
    expect(sent[0]).toMatchObject({ name: 'PutObjectCommand', input: { Bucket: 'creatives', Key: key, ContentLength: 3, ContentType: 'image/png' } });
    expect((await storage.get(key)).size).toBe(3);
    await storage.delete(key);
    expect(sent.map(item => item.name)).toEqual(['PutObjectCommand', 'GetObjectCommand', 'DeleteObjectCommand']);
    expect(JSON.stringify(sent)).not.toContain('SK');
    client.send.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    await expect(storage.get(key)).rejects.toMatchObject({ status: 404 });
  });
});

describe('creative upload without configured storage', () => {
  it('returns 503 after authorization and always removes the temporary file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'upload-'));
    const file = join(dir, 'tmp-upload');
    writeFileSync(file, readFileSync(__filename));
    const tx = { organization: { findUnique: jest.fn().mockResolvedValue({ type: 'ADVERTISER', active: true }) } };
    const db = { serializable: (work: (t: unknown) => unknown) => work(tx) };
    const sessions = { requireAdmin: jest.fn().mockResolvedValue(undefined) };
    const service = new CreativesService(db as never, {} as never, sessions as never, null, jest.fn());
    await expect(service.upload({ user: { id: 'u' } } as never, { path: file, originalname: 'a.mp4', size: 10 },
      { advertiserId: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ status: 503, code: 'STORAGE_UNAVAILABLE' });
    expect(sessions.requireAdmin).toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
  });
  it('rejects a missing file part with 400', async () => {
    const service = new CreativesService({} as never, {} as never, {} as never, null, jest.fn());
    await expect(service.upload({ user: { id: 'u' } } as never, undefined, { advertiserId: 'x' })).rejects.toMatchObject({ status: 400 });
  });
});
