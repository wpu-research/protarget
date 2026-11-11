import 'reflect-metadata';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BOOKING_STATUSES, BOOKING_TRANSITIONS, canBookingTransition } from '@protarget/shared';
import { findScheduleOverlap, flightMask, slotSegments, validateBooking, weeklyWindowHours, type ValidationInput } from '../src/modules/campaigns/booking-rules';
import { interpretProbe, inspectMedia, MediaToolUnavailable, sniff } from '../src/modules/creatives/media';
import { contentDisposition } from '../src/modules/creatives/creatives.controller';
import { Prisma } from '@prisma/client';
import { inventoryTransaction, isCheckViolation, LowerUuidPipe } from '../src/common/inventory-validation';
import { UploadCreativeDto } from '../src/modules/creatives/creatives.dto';
import { CreativesService, safeFilename } from '../src/modules/creatives/creatives.service';
import { LocalDiskStorage, S3Storage, storageConfig } from '../src/common/storage/object-storage';
import { CreateCmsOperationDto, ReplaceScheduleDto, ScreenIdsDto, UpdateCampaignDto } from '../src/modules/campaigns/campaigns.dto';

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
    // Case/alias spellings of the same zone are the same zone (P16).
    expect(weeklyWindowHours(slots, tz, { operatingStart: '06:00', operatingEnd: '23:00', timezone: 'europe/istanbul' })).toBe(2);
    expect(weeklyWindowHours(slots, 'Asia/Calcutta', { operatingStart: '00:00', operatingEnd: '23:59', timezone: 'Asia/Kolkata' })).not.toBeNull();
  });
  it('builds the flight minute mask in the campaign timezone (per-hour offsets, fractional-hour zones, 7-day cut-off)', () => {
    const minutesOf = (mask: Uint8Array | null) => mask ? Array.from(mask.keys()).filter(minute => mask[minute]) : null;
    // 2030-01-01 is a Tuesday. 00:00–01:00 UTC is 05:30–06:30 in Kolkata (UTC+5:30), 03:00–04:00 in Istanbul.
    const kolkata = minutesOf(flightMask(new Date('2030-01-01T00:00:00Z'), new Date('2030-01-01T01:00:00Z'), 'Asia/Kolkata'))!;
    expect([kolkata[0], kolkata.length]).toEqual([1440 + 330, 60]);
    const istanbul = minutesOf(flightMask(new Date('2030-01-01T00:00:00Z'), new Date('2030-01-01T01:00:00Z'), tz))!;
    expect(istanbul[0]).toBe(1440 + 180);
    // Crossing local midnight into Wednesday; a Sunday night wraps into Monday.
    const crossing = minutesOf(flightMask(new Date('2030-01-01T20:00:00Z'), new Date('2030-01-01T22:00:00Z'), tz))!;
    expect([crossing[0], crossing[crossing.length - 1]]).toEqual([1440 + 23 * 60, 2880 + 59]);
    const sunday = minutesOf(flightMask(new Date('2030-01-06T20:30:00Z'), new Date('2030-01-06T21:30:00Z'), tz))!;
    expect([sunday[0], sunday.length, sunday.includes(0)]).toEqual([0, 60, true]);
    expect(flightMask(new Date('2030-01-01T00:00:00Z'), new Date('2030-01-08T00:00:00Z'), tz)).toBeNull();
    // Seconds are not truncated away: a 30-second flight still covers its minute.
    expect(minutesOf(flightMask(new Date('2030-01-01T07:00:10Z'), new Date('2030-01-01T07:00:40Z'), tz))).toEqual([1440 + 600]);
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
  it('is flight-aware: dayparts that never occur inside a short flight block every screen (P1)', () => {
    // Tuesday 2030-01-01 10:00–18:00 local (UTC+3).
    const flight = { startAt: new Date('2030-01-01T07:00:00Z'), endAt: new Date('2030-01-01T15:00:00Z') };
    const screens = [screen(), screen({ code: 'UNKNOWN', operatingStart: null, operatingEnd: null }),
      screen({ code: 'LATE', operatingStart: '19:00', operatingEnd: '23:00' })];
    const monFri = [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }, { dayOfWeek: 5, startTime: '08:00', endTime: '12:00' }];
    const blocked = validateBooking(base({ ...flight, screens, schedule: monFri }), now);
    expect(blocked.blockers).toEqual([{ code: 'NO_PLAYBACK_WINDOW', screens: ['SCR-1', 'UNKNOWN', 'LATE'] }]);
    expect(codes(blocked.warnings)).toContain('OPERATING_HOURS_UNKNOWN');
    const ok = validateBooking(base({ ...flight, screens, schedule: [{ dayOfWeek: 2, startTime: '12:00', endTime: '14:00' }] }), now);
    // Inside the flight; only LATE (opens after the daypart) has no window.
    expect(ok.blockers).toEqual([{ code: 'NO_PLAYBACK_WINDOW', screens: ['LATE'] }]);
    const outside = validateBooking(base({ ...flight, screens: [screen()], schedule: [{ dayOfWeek: 2, startTime: '08:00', endTime: '09:30' }] }), now);
    expect(codes(outside.blockers)).toEqual(['NO_PLAYBACK_WINDOW']);
    const fine = validateBooking(base({ ...flight, schedule: [{ dayOfWeek: 2, startTime: '17:00', endTime: '20:00' }] }), now);
    expect(fine.blockers).toEqual([]);
    // A week-long flight keeps the abstract-week behaviour.
    expect(validateBooking(base({ schedule: monFri }), now).blockers).toEqual([]);
  });
  it('warns about revoked creatives, unknown durations and a READY flight that has not started (P15, G2, P10)', () => {
    const revoked = validateBooking(base({ creatives: [{ status: 'APPROVED', durationSeconds: 10, width: 1920, height: 1080 },
      { status: 'REVOKED', durationSeconds: 10, width: 1920, height: 1080 }] }), now);
    expect(codes(revoked.warnings)).toEqual(['REVOKED_CREATIVE']);
    expect(codes(validateBooking(base({ creatives: [{ status: 'REVOKED', durationSeconds: 10, width: 1, height: 1 }] }), now).blockers)).toContain('NO_APPROVED_CREATIVE');
    const unknown = validateBooking(base({ creatives: [{ status: 'APPROVED', durationSeconds: null, width: 1920, height: 1080 }] }), now);
    expect(unknown.warnings).toEqual([{ code: 'CREATIVE_DURATION_UNKNOWN', screens: [] }]);
    expect(codes(validateBooking(base({ status: 'READY' }), now).warnings)).toEqual(['FLIGHT_NOT_STARTED']);
    expect(codes(validateBooking(base({ status: 'READY' }), new Date('2030-01-15T00:00:00Z')).warnings)).toEqual([]);
    expect(codes(validateBooking(base({ status: 'DRAFT' }), now).warnings)).toEqual([]);
  });
  it('compares timezones canonically so aliases and case do not warn (P16)', () => {
    const result = validateBooking(base({ screens: [screen({ timezone: 'europe/istanbul' }), screen({ code: 'ATHENS', timezone: 'Europe/Athens' })] }), now);
    expect(result.warnings).toEqual([{ code: 'TIMEZONE_MISMATCH', screens: ['ATHENS'] }]);
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
  it('lowercases UUID inputs, including arrays, before validating uniqueness (P3)', () => {
    const upper = '0A1B2C3D-0000-4000-8000-00000000ABCD';
    const dto = plainToInstance(ScreenIdsDto, { screenIds: [upper, upper.toLowerCase()] });
    expect(dto.screenIds).toEqual([upper.toLowerCase(), upper.toLowerCase()]);
    expect(validateSync(dto, { whitelist: true }).some(error => error.constraints?.arrayUnique)).toBe(true);
    expect(errors(ScreenIdsDto, { screenIds: [upper] })).toHaveLength(0);
    const upload = plainToInstance(UploadCreativeDto, { advertiserId: upper, replacesId: upper });
    expect([upload.advertiserId, upload.replacesId]).toEqual([upper.toLowerCase(), upper.toLowerCase()]);
    expect(plainToInstance(UpdateCampaignDto, { advertiserId: upper, agencyId: upper }).agencyId).toBe(upper.toLowerCase());
  });
  it('lowercases path UUIDs and still rejects malformed ones', async () => {
    const pipe = new LowerUuidPipe();
    await expect(pipe.transform('0A1B2C3D-0000-4000-8000-00000000ABCD', { type: 'param' })).resolves.toBe('0a1b2c3d-0000-4000-8000-00000000abcd');
    await expect(pipe.transform('nope', { type: 'param' })).rejects.toMatchObject({ status: 400 });
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
    const tags = { major_brand: 'isom' };
    expect(interpretProbe(mp4, { streams: [video], format: { duration: '15.0004', format_name: 'mov,mp4,m4a', tags } }))
      .toEqual({ ok: true, type: mp4, probe: { durationSeconds: 15, width: 1920, height: 1080, videoCodec: 'h264' } });
    expect(interpretProbe(mp4, { streams: [{ ...video, codec_name: 'hevc' }], format: { duration: '5', format_name: 'mov,mp4', tags } })).toMatchObject({ ok: false, reason: 'VIDEO_CODEC_NOT_H264' });
    expect(interpretProbe(mp4, { streams: [video], format: { duration: '5', format_name: 'matroska,webm' } })).toMatchObject({ ok: false, reason: 'NOT_MP4_CONTAINER' });
    expect(interpretProbe(mp4, { streams: [video], format: { duration: 'N/A', format_name: 'mov,mp4', tags } })).toMatchObject({ ok: false, reason: 'UNKNOWN_DURATION' });
    expect(interpretProbe(mp4, { streams: [{ codec_type: 'audio' }], format: {} })).toMatchObject({ ok: false, reason: 'NO_VISUAL_STREAM' });
    expect(interpretProbe(png, { streams: [{ codec_type: 'video', codec_name: 'png', width: 0, height: 10 }] })).toMatchObject({ ok: false, reason: 'UNKNOWN_DIMENSIONS' });
    expect(interpretProbe(png, { streams: [{ codec_type: 'video', codec_name: 'mjpeg', width: 10, height: 10 }] })).toMatchObject({ ok: false, reason: 'IMAGE_DECODE_MISMATCH' });
  });
  it('accepts only real MP4 brands; QuickTime and 3GP share ffprobe\'s mov,mp4 name but are rejected (P6)', () => {
    const video = { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 };
    const probe = (brand?: string) => interpretProbe(mp4, { streams: [video], format: { duration: '5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      ...(brand === undefined ? {} : { tags: { major_brand: brand } }) } });
    for (const brand of ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V', 'dash', ' isom ']) expect(probe(brand)).toMatchObject({ ok: true });
    for (const brand of ['qt  ', '3gp4', 'mp42x', 'm4v', undefined]) expect(probe(brand)).toMatchObject({ ok: false, reason: 'NOT_MP4_CONTAINER' });
  });
  it('skips cover-art streams, swaps rotated dimensions and caps size (P6)', () => {
    const format = { duration: '5', format_name: 'mov,mp4', tags: { major_brand: 'isom' } };
    const cover = { codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600, disposition: { attached_pic: 1 } };
    const video = { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 };
    expect(interpretProbe(mp4, { streams: [cover, video], format })).toMatchObject({ ok: true, probe: { width: 1920, height: 1080 } });
    expect(interpretProbe(mp4, { streams: [cover], format })).toMatchObject({ ok: false, reason: 'NO_VISUAL_STREAM' });
    expect(interpretProbe(mp4, { streams: [{ ...video, side_data_list: [{ rotation: -90 }] }], format })).toMatchObject({ ok: true, probe: { width: 1080, height: 1920 } });
    expect(interpretProbe(mp4, { streams: [{ ...video, tags: { rotate: '270' } }], format })).toMatchObject({ ok: true, probe: { width: 1080, height: 1920 } });
    expect(interpretProbe(mp4, { streams: [{ ...video, side_data_list: [{ rotation: 180 }] }], format })).toMatchObject({ ok: true, probe: { width: 1920, height: 1080 } });
    expect(interpretProbe(mp4, { streams: [{ ...video, width: 8193 }], format })).toMatchObject({ ok: false, reason: 'DIMENSIONS_TOO_LARGE' });
    expect(interpretProbe(mp4, { streams: [{ ...video, width: 100, height: 9000, side_data_list: [{ rotation: 90 }] }], format })).toMatchObject({ ok: false, reason: 'DIMENSIONS_TOO_LARGE' });
    expect(interpretProbe(mp4, { streams: [{ ...video, width: 8192, height: 4320 }], format })).toMatchObject({ ok: true });
    expect(interpretProbe(png, { streams: [{ codec_type: 'video', codec_name: 'png', width: 8192, height: 8193 }] })).toMatchObject({ ok: false, reason: 'DIMENSIONS_TOO_LARGE' });
    expect(interpretProbe(png, { streams: [{ codec_type: 'video', codec_name: 'png', width: 8192, height: 8192 }] })).toMatchObject({ ok: true });
  });
  it('treats timeouts, signals and resource faults as tool outages; only a normal non-zero exit is unreadable media (P7)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const file = join(dir, 'x.png');
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]));
    const fail = (extra: object) => () => Promise.reject(Object.assign(new Error('x'), extra));
    for (const extra of [{ killed: true, signal: 'SIGTERM' }, { signal: 'SIGKILL' }, { code: 'ENOBUFS' }, { code: 'EACCES' }, { code: 'EAGAIN' },
      { code: 'ENOMEM' }, { code: 'EMFILE' }, { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }]) {
      await expect(inspectMedia(file, fail(extra))).rejects.toBeInstanceOf(MediaToolUnavailable);
    }
    await expect(inspectMedia(file, fail({ code: 1 }))).resolves.toMatchObject({ ok: false, reason: 'UNREADABLE_MEDIA' });
  });
  it('treats a missing ffprobe binary as an operations fault, not a rejection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const file = join(dir, 'x.png');
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]));
    await expect(inspectMedia(file, () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOENT' })))).rejects.toBeInstanceOf(MediaToolUnavailable);
    await expect(inspectMedia(file, () => Promise.reject(new Error('corrupt')))).resolves.toMatchObject({ ok: false, reason: 'UNREADABLE_MEDIA' });
  });
  it('builds an RFC 5987 Content-Disposition with an ASCII fallback (P19)', () => {
    expect(contentDisposition('spot one.mp4')).toBe(`inline; filename="spot one.mp4"; filename*=UTF-8''spot%20one.mp4`);
    const header = contentDisposition(`it's (a) *özel*.mp4`);
    expect(header).toContain(`filename*=UTF-8''it%27s%20%28a%29%20%2A%C3%B6zel%2A.mp4`);
    expect(header).toContain('filename="it\'s (a) *_zel*.mp4"');
    expect(contentDisposition('a%b"c.mp4')).toContain('filename="a_b_c.mp4"');
    expect(contentDisposition('日本語.png')).not.toMatch(/[^\x20-\x7e]/);
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
    expect(storageConfig({ NODE_ENV: 'development' }).driver).toBe('local');
    // Unset or unknown NODE_ENV must never fall back to ephemeral disk (P5).
    expect(storageConfig({})).toEqual({ driver: 'disabled' });
    expect(storageConfig({ NODE_ENV: 'staging' })).toEqual({ driver: 'disabled' });
    expect(storageConfig({ NODE_ENV: '' })).toEqual({ driver: 'disabled' });
    expect(() => storageConfig({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's', S3_ENDPOINT: 'http://minio:9000' })).toThrow('S3_ENDPOINT');
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
  it('retries S3 puts with a fresh read stream per attempt and gives up after three (P8)', async () => {
    const root = mkdtempSync(join(tmpdir(), 's3retry-'));
    const source = join(root, 'src.bin');
    writeFileSync(source, 'abcdef');
    const bodies: unknown[] = [];
    const client = { send: jest.fn(async (command: { input: { Body: unknown } }) => {
      bodies.push(command.input.Body);
      if (bodies.length < 3) throw new Error('transient');
      return {};
    }) };
    const storage = new S3Storage({ bucket: 'b', region: 'eu', accessKeyId: 'AK', secretAccessKey: 'SK', forcePathStyle: true }, client as never, 1);
    await storage.put(key, source, 'image/png');
    expect(client.send).toHaveBeenCalledTimes(3);
    expect(new Set(bodies).size).toBe(3);
    const failing = { send: jest.fn(async () => { throw new Error('down'); }) };
    await expect(new S3Storage({ bucket: 'b', region: 'eu', accessKeyId: 'AK', secretAccessKey: 'SK', forcePathStyle: true }, failing as never, 1)
      .put(key, source, 'image/png')).rejects.toThrow('down');
    expect(failing.send).toHaveBeenCalledTimes(3);
  });
  it('disables SDK-level retries on the real client (maxAttempts 1)', async () => {
    const storage = new S3Storage({ bucket: 'b', region: 'eu', accessKeyId: 'AK', secretAccessKey: 'SK', forcePathStyle: true });
    const client = (storage as unknown as { client: { config: { maxAttempts: () => Promise<number> } } }).client;
    await expect(client.config.maxAttempts()).resolves.toBe(1);
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

describe('creative upload cleanup (P8) and database-derived ids (P3)', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const probeOk = jest.fn().mockResolvedValue({ streams: [{ codec_type: 'video', codec_name: 'png', width: 10, height: 10 }] });
  const advertiser = '0a1b2c3d-0000-4000-8000-00000000abcd';
  function setup(storage: object, create: jest.Mock = jest.fn()) {
    const dir = mkdtempSync(join(tmpdir(), 'cleanup-'));
    const file = join(dir, 'tmp-upload');
    writeFileSync(file, png);
    const tx = { organization: { findUnique: jest.fn().mockResolvedValue({ id: advertiser, type: 'ADVERTISER', active: true }) },
      creative: { findFirst: jest.fn().mockResolvedValue(null), create } };
    const db = { serializable: (work: (t: unknown) => unknown) => work(tx) };
    const service = new CreativesService(db as never, { append: jest.fn() } as never, { requireAdmin: jest.fn() } as never, storage as never, probeOk);
    return { service, file };
  }
  it('deletes the partial object and the temp file when storage.put fails', async () => {
    const storage = { put: jest.fn().mockRejectedValue(new Error('disk full')), delete: jest.fn().mockResolvedValue(undefined) };
    const { service, file } = setup(storage);
    await expect(service.upload({ user: { id: 'u' } } as never, { path: file, originalname: 'a.png', size: 10 },
      { advertiserId: advertiser.toUpperCase().toLowerCase(), displayDurationSeconds: '5' })).rejects.toThrow('disk full');
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0][0]);
    expect(storage.put.mock.calls[0][0]).toMatch(new RegExp(`^creatives/${advertiser}/[0-9a-f-]{36}$`));
    expect(existsSync(file)).toBe(false);
  });
  it('deletes the stored object when the database write fails', async () => {
    const storage = { put: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
    const { service, file } = setup(storage, jest.fn().mockRejectedValue(new Error('db down')));
    await expect(service.upload({ user: { id: 'u' } } as never, { path: file, originalname: 'a.png', size: 10 },
      { advertiserId: advertiser, displayDurationSeconds: '5' })).rejects.toThrow();
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
});

describe('database check-violation mapping (P18)', () => {
  it('recognizes SQLSTATE 23514 however Prisma surfaces it, and nothing else', () => {
    const unknown = new Prisma.PrismaClientUnknownRequestError('Raw query failed. Code: `23514`. Message: `approved creative is immutable`', { clientVersion: 'x' });
    const known = new Prisma.PrismaClientKnownRequestError('failed', { code: 'P2010', clientVersion: 'x', meta: { code: '23514', message: 'new row violates check constraint' } });
    expect(isCheckViolation(unknown)).toBe(true);
    expect(isCheckViolation(known)).toBe(true);
    expect(isCheckViolation(Object.assign(new Error('x'), { code: '23514' }))).toBe(true);
    expect(isCheckViolation(new Prisma.PrismaClientUnknownRequestError('other failure', { clientVersion: 'x' }))).toBe(false);
    expect(isCheckViolation(new Error('mentions 23514 in text'))).toBe(false);
    expect(isCheckViolation(null)).toBe(false);
  });
  it('maps to a 409 without leaking the database message', async () => {
    const error = new Prisma.PrismaClientUnknownRequestError('Code: `23514`. Message: `secret trigger text`', { clientVersion: 'x' });
    const db = { serializable: () => Promise.reject(error) };
    await expect(inventoryTransaction(db as never, async () => 1)).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE_TRANSITION',
      message: expect.not.stringContaining('secret') });
  });
});
