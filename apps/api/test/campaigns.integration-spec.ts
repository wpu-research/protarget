import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from 'bcryptjs';
import request, { Response } from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

const origin = process.env.WEB_ORIGIN!;
const runId = randomUUID();
const password = randomBytes(24).toString('base64url');
const cookieJar = (response: Response) =>
  ((response.headers['set-cookie'] ?? []) as unknown as string[]).map(cookie => cookie.split(';')[0]);
const ffmpeg = (...args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

describe('Campaign booking — isolated real PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let media: Record<'h264' | 'h264b' | 'mpeg4' | 'png' | 'jpg' | 'text', string>;
  const orgs: string[] = [];
  const venues: string[] = [];
  const campaigns: string[] = [];
  const users = {} as Record<Role, string>;
  const jars = {} as Record<Role, string[]>;
  let advertiserId: string;
  let agencyId: string;
  let otherAdvertiserId: string;

  const api = (method: 'get' | 'post' | 'patch', path: string, jar: string[] | undefined = jars.ADMIN) => {
    const call = request(app.getHttpServer())[method](`/api/v1${path}`);
    if (jar) call.set('Cookie', jar);
    if (method !== 'get') call.set('Origin', origin);
    return call;
  };
  const at = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
  async function makeScreen(extra: object = {}, venueExtra: object = {}) {
    const venue = (await api('post', '/venues').send({ name: `ship-${runId}`, city: 'Istanbul', country: 'Turkey',
      timezone: 'Europe/Istanbul', ...venueExtra }).expect(201)).body;
    venues.push(venue.id);
    return (await api('post', '/screens').send({ screenId: `SCR-${randomUUID()}`, name: 'Deck screen', venueId: venue.id,
      timezone: 'Europe/Istanbul', operatingStart: '06:00', operatingEnd: '23:00', loopLengthSec: 120,
      defaultSlotLengthSec: 15, resolutionWidth: 320, resolutionHeight: 180, ...extra }).expect(201)).body;
  }
  async function makeCampaign(extra: object = {}) {
    const response = await api('post', '/campaigns').send({ name: `Booking ${runId}`, advertiserId, agencyId,
      internalOwnerId: users.ADMIN, startAt: at(24), endAt: at(24 * 30), timezone: 'Europe/Istanbul', ...extra }).expect(201);
    campaigns.push(response.body.id);
    return response.body;
  }
  let mediaDir: string;
  /** Unique pixels per call: the same file is a duplicate for an advertiser. */
  function fresh(kind: 'png' | 'jpg' | 'long'): string {
    const color = `0x${randomBytes(3).toString('hex')}`;
    const file = join(mediaDir, `${randomUUID()}.${kind === 'long' ? 'mp4' : kind}`);
    if (kind === 'long') ffmpeg('-f', 'lavfi', '-i', `color=c=${color}:s=320x180:d=20`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file);
    else ffmpeg('-f', 'lavfi', '-i', `color=c=${color}:s=640x360`, '-frames:v', '1', file);
    return file;
  }
  function upload(file: string, fields: Record<string, string> = {}, jar = jars.ADMIN) {
    const call = api('post', '/creatives', jar).field('advertiserId', fields.advertiserId ?? advertiserId);
    for (const [key, value] of Object.entries(fields)) if (key !== 'advertiserId') call.field(key, value);
    return call.attach('file', file);
  }

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'booking-media-'));
    mediaDir = dir;
    media = {
      h264: join(dir, 'spot one.mp4'), h264b: join(dir, 'spot-two.mp4'), mpeg4: join(dir, 'legacy.mp4'),
      png: join(dir, 'still.png'), jpg: join(dir, 'still.jpg'), text: join(dir, 'notes.mp4'),
    };
    ffmpeg('-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', media.h264);
    ffmpeg('-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', media.h264b);
    ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=2', '-c:v', 'mpeg4', media.mpeg4);
    ffmpeg('-f', 'lavfi', '-i', `color=c=0x${randomBytes(3).toString('hex')}:s=640x360`, '-frames:v', '1', media.png);
    ffmpeg('-f', 'lavfi', '-i', 'color=c=green:s=640x360', '-frames:v', '1', media.jpg);
    writeFileSync(media.text, 'not a video');

    app = await createApp();
    db = app.get(PrismaService);
    const [role] = await db.$queryRaw<{ rolsuper: boolean; rolcreaterole: boolean }[]>`
      SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
    if (role.rolsuper || role.rolcreaterole) throw new Error('Booking tests require an unprivileged runtime role');
    const passwordHash = await hash(password, 12);
    for (const role of Object.values(Role)) {
      const org = await db.organization.create({ data: { name: `booking-${runId}`, type: role === 'SUPPORT' ? 'ADMIN' : role } });
      orgs.push(org.id);
      if (role === 'ADVERTISER') advertiserId = org.id;
      if (role === 'AGENCY') agencyId = org.id;
      const user = await db.user.create({ data: { name: `Booking ${role}`, email: `${randomUUID()}@example.test`, orgId: org.id, role, passwordHash } });
      users[role] = user.id;
      jars[role] = cookieJar(await api('post', '/auth/login', []).send({ email: user.email, password }).expect(200));
    }
    const other = await db.organization.create({ data: { name: `other-advertiser-${runId}`, type: 'ADVERTISER' } });
    orgs.push(other.id);
    otherAdvertiserId = other.id;
  });
  afterAll(async () => {
    if (db && orgs.length) {
      // Only this run's fixtures; audit and CMS records stay (append-only).
      await db.$transaction(async tx => {
        await tx.campaign.updateMany({ where: { id: { in: campaigns } }, data: { deletedAt: new Date() } });
        await tx.screen.updateMany({ where: { venueId: { in: venues } }, data: { active: false } });
        await tx.venue.updateMany({ where: { id: { in: venues } }, data: { active: false } });
        await tx.session.updateMany({ where: { user: { orgId: { in: orgs } } }, data: { revokedAt: new Date() } });
        await tx.user.updateMany({ where: { orgId: { in: orgs } }, data: { active: false } });
        await tx.organization.updateMany({ where: { id: { in: orgs } }, data: { active: false } });
      });
    }
    if (app) await app.close();
  });

  it('denies every booking and creative route to anonymous, agency, advertiser and support without side effects', async () => {
    const campaign = await makeCampaign();
    const id = campaign.id;
    const routes: ['get' | 'post' | 'patch', string, object?][] = [
      ['get', '/campaigns'], ['post', '/campaigns', {}], ['get', `/campaigns/${id}`], ['patch', `/campaigns/${id}`, { name: 'x' }],
      ['post', `/campaigns/${id}/archive`], ['get', `/campaigns/${id}/screen-options`], ['post', `/campaigns/${id}/screens`, { screenIds: [randomUUID()] }],
      ['post', `/campaigns/${id}/screens/remove`, { screenIds: [randomUUID()] }], ['post', `/campaigns/${id}/creatives`, { creativeId: randomUUID() }],
      ['post', `/campaigns/${id}/creatives/remove`, { creativeId: randomUUID() }], ['post', `/campaigns/${id}/schedule`, { slots: [] }],
      ['get', `/campaigns/${id}/validation`], ['post', `/campaigns/${id}/transitions`, { to: 'CANCELLED', reason: 'x' }],
      ['get', `/campaigns/${id}/cms-operations`], ['post', `/campaigns/${id}/cms-operations`, {}], ['get', `/campaigns/${id}/activity`],
      ['get', '/creatives'], ['get', `/creatives/${randomUUID()}`], ['get', `/creatives/${randomUUID()}/file`],
      ['post', `/creatives/${randomUUID()}/approve`], ['post', `/creatives/${randomUUID()}/reject`, { reason: 'x' }],
    ];
    const before = { campaign: await db.campaign.findUnique({ where: { id } }), creatives: await db.creative.count(),
      cms: await db.campaignCmsOperation.count(), audits: await db.auditLog.count({ where: { entityType: { in: ['campaign', 'creative'] } } }) };
    for (const [method, path, body] of routes) {
      const anonymous = await api(method, path, []).send(body ?? {});
      expect(anonymous.status).toBe(401);
      for (const role of ['AGENCY', 'ADVERTISER', 'SUPPORT'] as const) {
        const response = await api(method, path, jars[role]).send(body ?? {});
        expect([403]).toContain(response.status);
        expect(JSON.stringify(response.body)).not.toContain(campaign.code);
      }
    }
    for (const role of ['AGENCY', 'ADVERTISER', 'SUPPORT'] as const) {
      await upload(media.h264, {}, jars[role]).expect(403);
    }
    expect({ campaign: await db.campaign.findUnique({ where: { id } }), creatives: await db.creative.count(),
      cms: await db.campaignCmsOperation.count(), audits: await db.auditLog.count({ where: { entityType: { in: ['campaign', 'creative'] } } }) })
      .toEqual(before);
  });

  it('creates drafts with validated references, server codes and audit; concurrent codes stay unique', async () => {
    await api('post', '/campaigns').send({ name: 'ab', advertiserId, internalOwnerId: users.ADMIN, startAt: at(1), endAt: at(2), timezone: 'Europe/Istanbul' }).expect(400);
    await api('post', '/campaigns').send({ name: 'Wrong type', advertiserId: agencyId, internalOwnerId: users.ADMIN, startAt: at(1), endAt: at(2), timezone: 'Europe/Istanbul' }).expect(400);
    await api('post', '/campaigns').send({ name: 'Wrong owner', advertiserId, internalOwnerId: users.AGENCY, startAt: at(1), endAt: at(2), timezone: 'Europe/Istanbul' }).expect(400);
    await api('post', '/campaigns').send({ name: 'Bad flight', advertiserId, internalOwnerId: users.ADMIN, startAt: at(2), endAt: at(1), timezone: 'Europe/Istanbul' }).expect(400);
    await api('post', '/campaigns').send({ name: 'Bad tz', advertiserId, internalOwnerId: users.ADMIN, startAt: at(1), endAt: at(2), timezone: '+03:00' }).expect(400);
    await api('post', '/campaigns').send({ name: 'Offset', advertiserId, internalOwnerId: users.ADMIN, startAt: '2027-01-01T10:00:00+03:00', endAt: at(2), timezone: 'Europe/Istanbul' }).expect(400);
    const created = await makeCampaign({ name: '  Spring ferries  ', notes: '  ' });
    expect(created).toMatchObject({ name: 'Spring ferries', status: 'DRAFT', notes: null, screenCount: 0, primaryGoal: null,
      advertiser: { id: advertiserId }, agency: { id: agencyId }, commercial: { pricingModel: null, currency: 'TRY', overdeliveryTolerancePct: '1.00' } });
    expect(created.code).toMatch(new RegExp(`^CMP-${new Date().getUTCFullYear()}-\\d{4,}$`));
    const audit = await db.auditLog.findFirst({ where: { entityType: 'campaign', entityId: created.id, action: 'CAMPAIGN_CREATED' } });
    expect(audit?.userId).toBe(users.ADMIN);
    const parallel = await Promise.all(Array.from({ length: 5 }, () => api('post', '/campaigns').send({ name: `Parallel ${runId}`, advertiserId,
      internalOwnerId: users.ADMIN, startAt: at(1), endAt: at(2), timezone: 'Europe/Istanbul' })));
    const ok = parallel.filter(response => response.status === 201);
    ok.forEach(response => campaigns.push(response.body.id));
    expect(parallel.every(response => [201, 409].includes(response.status))).toBe(true);
    expect(new Set(ok.map(response => response.body.code)).size).toBe(ok.length);
    expect(ok.length).toBeGreaterThan(0);
  });

  it('uploads, measures, deduplicates, rejects and approves creatives; approved files are immutable', async () => {
    const video = (await upload(media.h264).expect(201)).body;
    expect(video).toMatchObject({ status: 'VALIDATING', kind: 'VIDEO', mime: 'video/mp4', durationSeconds: '2.000', durationManual: false,
      width: 320, height: 180, videoCodec: 'h264', originalFilename: 'spot one.mp4', version: 1 });
    expect(video.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(video).not.toHaveProperty('storageKey');
    expect(video.code).toMatch(/^CR-\d{4}-\d{5}$/);
    const duplicate = await upload(media.h264).expect(409);
    expect(duplicate.body.error).toMatchObject({ code: 'DUPLICATE_CREATIVE', details: { creativeId: video.id } });
    await upload(media.h264, { displayDurationSeconds: '10' }).expect(400);
    await upload(media.png).expect(400);
    await upload(media.png, { displayDurationSeconds: '301' }).expect(400);
    const image = (await upload(media.png, { displayDurationSeconds: '12.5' }).expect(201)).body;
    expect(image).toMatchObject({ kind: 'IMAGE', mime: 'image/png', durationSeconds: '12.500', durationManual: true, width: 640, height: 360, videoCodec: null });
    const jpeg = (await upload(media.jpg, { displayDurationSeconds: '5' }).expect(201)).body;
    expect(jpeg.mime).toBe('image/jpeg');
    const mpeg4 = (await upload(media.mpeg4).expect(201)).body;
    expect(mpeg4).toMatchObject({ status: 'REJECTED', rejectionReason: 'VIDEO_CODEC_NOT_H264' });
    const text = (await upload(media.text).expect(201)).body;
    expect(text).toMatchObject({ status: 'REJECTED', rejectionReason: 'UNSUPPORTED_TYPE', kind: null, mime: 'application/octet-stream' });
    await api('get', `/creatives/${text.id}/file`).expect(404);
    await upload(media.h264, { advertiserId: agencyId }).expect(400);
    await api('post', '/creatives').field('advertiserId', advertiserId).expect(400);
    // Multer temp files (32 hex chars) must not survive a rejected body (Nest FileInterceptor cleanup).
    const temps = () => readdirSync(tmpdir()).filter(name => /^[0-9a-f]{32}$/.test(name)).sort();
    const tempsBefore = temps();
    await upload(media.h264, { advertiserId: 'not-a-uuid' }).expect(400);
    await upload(media.h264, { unexpected: 'field' }).expect(400);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(temps()).toEqual(tempsBefore);

    const file = await api('get', `/creatives/${video.id}/file`).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(file.headers['content-type']).toBe('video/mp4');
    expect(Buffer.compare(file.body as Buffer, readFileSync(media.h264))).toBe(0);

    await api('post', `/creatives/${mpeg4.id}/approve`).expect(409);
    await api('post', `/creatives/${jpeg.id}/reject`).send({ reason: '' }).expect(400);
    expect((await api('post', `/creatives/${jpeg.id}/reject`).send({ reason: 'Brand logo missing' }).expect(200)).body)
      .toMatchObject({ status: 'REJECTED', rejectionReason: 'Brand logo missing' });
    const approved = (await api('post', `/creatives/${video.id}/approve`).expect(200)).body;
    expect(approved).toMatchObject({ status: 'APPROVED', approvedBy: { id: users.ADMIN } });
    await api('post', `/creatives/${video.id}/approve`).expect(409);
    await expect(db.creative.update({ where: { id: video.id }, data: { checksum: 'sha256:tampered' } })).rejects.toThrow();
    await expect(db.creative.update({ where: { id: video.id }, data: { status: 'REJECTED' } })).rejects.toThrow();

    const v2 = (await upload(media.h264b, { replacesId: video.id }).expect(201)).body;
    expect(v2).toMatchObject({ version: 2, replacesId: video.id, durationSeconds: '20.000' });
    await upload(media.h264b, { replacesId: video.id, advertiserId: otherAdvertiserId }).expect(400);
    const listed = (await api('get', `/creatives?advertiserId=${advertiserId}&status=APPROVED`).expect(200)).body;
    expect(listed.items.map((item: { id: string }) => item.id)).toContain(video.id);
    expect(listed.items.every((item: { status: string }) => item.status === 'APPROVED')).toBe(true);
    const actions = (await db.auditLog.findMany({ where: { entityType: 'creative', entityId: { in: [video.id, mpeg4.id, jpeg.id] } } })).map(row => row.action);
    expect(actions).toEqual(expect.arrayContaining(['CREATIVE_UPLOADED', 'CREATIVE_APPROVED', 'CREATIVE_AUTO_REJECTED', 'CREATIVE_REJECTED']));
  });

  it('walks a booking through validation, CMS declarations and the simplified state machine', async () => {
    const screenA = await makeScreen();
    const screenB = await makeScreen();
    const inactive = await makeScreen({ active: false });
    const campaign = await makeCampaign();
    const path = `/campaigns/${campaign.id}`;
    const video = (await upload(fresh('png'), { displayDurationSeconds: '10', advertiserId }).expect(201)).body;
    await api('post', `/creatives/${video.id}/approve`).expect(200);
    const foreign = (await upload(fresh('jpg'), { displayDurationSeconds: '5', advertiserId: otherAdvertiserId }).expect(201)).body;

    const empty = (await api('get', `${path}/validation`).expect(200)).body;
    expect(empty.blockers.map((b: { code: string }) => b.code)).toEqual(expect.arrayContaining(['NO_SCREENS', 'NO_APPROVED_CREATIVE', 'NO_GOAL', 'NO_SCHEDULE']));
    expect(empty.warnings.map((w: { code: string }) => w.code)).toContain('NO_COMMERCIAL_TERMS');
    await api('post', `${path}/transitions`).send({ to: 'READY' }).expect(409).expect(res => expect(res.body.error.code).toBe('CAMPAIGN_NOT_READY'));
    await api('post', `${path}/transitions`).send({ to: 'LIVE' }).expect(409);

    const partial = await api('post', `${path}/screens`).send({ screenIds: [screenA.id, inactive.id] }).expect(409);
    expect(partial.body.error.details.unavailable).toEqual([inactive.id]);
    expect(await db.campaignScreen.count({ where: { campaignId: campaign.id } })).toBe(0);
    await api('post', `${path}/screens`).send({ screenIds: [screenA.id, screenB.id] }).expect(200);
    const options = (await api('get', `${path}/screen-options?search=${screenA.screenId}`).expect(200)).body;
    expect(options.items[0]).toMatchObject({ screenId: screenA.id, selected: true, currentMultiplier: null, cmsUploaded: false });
    await api('post', `${path}/creatives`).send({ creativeId: foreign.id }).expect(400);
    await api('post', `${path}/creatives`).send({ creativeId: video.id }).expect(200);
    await api('post', `${path}/creatives`).send({ creativeId: video.id }).expect(409);
    await expect(db.campaignCreative.create({ data: { campaignId: campaign.id, creativeId: foreign.id } })).rejects.toThrow();

    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' },
      { dayOfWeek: 1, startTime: '11:00', endTime: '13:00' }] }).expect(400);
    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: 7, startTime: '22:00', endTime: '07:00' },
      { dayOfWeek: 1, startTime: '06:00', endTime: '08:00' }] }).expect(400);
    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: 1, startTime: '10:00', endTime: '10:00' }] }).expect(400);
    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: 8, startTime: '10:00', endTime: '11:00' }] }).expect(400);
    const scheduled = (await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' },
      { dayOfWeek: 5, startTime: '22:00', endTime: '02:00' }] }).expect(200)).body;
    expect(scheduled.screens.find((s: { screenId: string }) => s.screenId === screenA.id).weeklyWindowHours).toBe('5.00'); // Mon 4h + Fri 22–23; Sat 00–02 is closed

    await api('patch', path).send({ unitPrice: '1e3' }).expect(400);
    await api('patch', path).send({ unitPrice: '0' }).expect(400);
    await api('patch', path).send({ unitPrice: '1.23456' }).expect(400);
    await api('patch', path).send({ publisherSharePct: '60', protargetSharePct: '30' }).expect(400);
    await api('patch', path).send({ targetPlayouts: '-5' }).expect(400);
    await api('patch', path).send({ pricingModel: 'CPM', primaryGoal: 'IMPRESSIONS', targetImpressions: '50000',
      publisherSharePct: '60', protargetSharePct: '40' }).expect(200);
    const blocked = (await api('get', `${path}/validation`).expect(200)).body;
    const codes = blocked.blockers.map((b: { code: string }) => b.code);
    expect(codes).toEqual(expect.arrayContaining(['MISSING_MULTIPLIER', 'INVALID_COMMERCIAL']));
    expect(blocked.blockers.find((b: { code: string }) => b.code === 'MISSING_MULTIPLIER').screens).toEqual(expect.arrayContaining([screenA.screenId, screenB.screenId]));
    const detail = (await api('patch', path).send({ unitPrice: '125.5', budget: '10000', primaryGoal: 'PLAYOUTS', targetPlayouts: '12000' }).expect(200)).body;
    expect(detail.commercial).toMatchObject({ pricingModel: 'CPM', unitPrice: '125.5000', budget: '10000.0000', publisherSharePct: '60.00' });
    expect(detail.targetPlayouts).toBe('12000');

    const valid = (await api('get', `${path}/validation`).expect(200)).body;
    expect(valid.blockers).toEqual([]);
    expect(valid.missingCmsUpload.sort()).toEqual([screenA.screenId, screenB.screenId].sort());
    expect((await api('post', `${path}/transitions`).send({ to: 'READY' }).expect(200)).body.status).toBe('READY');

    // Any plan change in READY returns the booking to DRAFT; notes do not.
    expect((await api('patch', path).send({ notes: 'Operator note' }).expect(200)).body.status).toBe('READY');
    expect((await api('patch', path).send({ targetPlayouts: '13000' }).expect(200)).body.status).toBe('DRAFT');
    await api('post', `${path}/transitions`).send({ to: 'READY' }).expect(200);

    const live = await api('post', `${path}/transitions`).send({ to: 'LIVE' }).expect(409);
    expect(live.body.error.details.missingCmsUpload.sort()).toEqual([screenA.screenId, screenB.screenId].sort());
    const other = await makeScreen();
    await api('post', `${path}/cms-operations`).send({ screenId: other.id, type: 'CMS_UPLOADED', performedAt: new Date().toISOString() }).expect(400);
    await api('post', `${path}/cms-operations`).send({ screenId: screenA.id, type: 'CMS_UPLOADED', performedAt: at(1) }).expect(400);
    await api('post', `${path}/cms-operations`).send({ screenId: screenA.id, type: 'CMS_UPLOADED', performedAt: '2000-01-01T00:00:00Z' }).expect(400);
    await expect(db.campaignCmsOperation.create({ data: { campaignId: campaign.id, screenId: other.id, type: 'NOTE',
      performedAt: new Date(), actorId: users.ADMIN } })).rejects.toThrow();
    for (const screen of [screenA, screenB]) {
      const op = (await api('post', `${path}/cms-operations`).send({ screenId: screen.id, type: 'CMS_UPLOADED',
        performedAt: new Date().toISOString(), cmsReference: '  playlist-42 ', note: 'Uploaded via remote panel' }).expect(res => { if (res.status !== 201) throw new Error(JSON.stringify(res.body)); })).body;
      expect(op).toMatchObject({ source: 'OPERATOR_DECLARED', cmsReference: 'playlist-42', actor: { id: users.ADMIN }, screenCode: screen.screenId });
    }
    const started = (await api('post', `${path}/transitions`).send({ to: 'LIVE' }).expect(200)).body;
    expect(started.status).toBe('LIVE');
    expect(started.launchedAt).not.toBeNull();
    const liveAudit = await db.auditLog.findFirst({ where: { entityId: campaign.id, action: 'CAMPAIGN_STATUS_CHANGED' }, orderBy: { timestamp: 'desc' } });
    expect(liveAudit?.metadata).toMatchObject({ declaration: 'OPERATOR_DECLARED' });
    expect((liveAudit?.metadata as { screensWithoutMatchingCmsRecord: string[] }).screensWithoutMatchingCmsRecord.sort())
      .toEqual([screenA.screenId, screenB.screenId].sort());

    // LIVE: only notes and a later end.
    await api('patch', path).send({ name: 'Renamed' }).expect(409);
    await api('patch', path).send({ endAt: at(24) }).expect(409);
    await api('post', `${path}/screens/remove`).send({ screenIds: [screenA.id] }).expect(409);
    await api('post', `${path}/schedule`).send({ slots: [] }).expect(409);
    const extended = (await api('patch', path).send({ endAt: at(24 * 60), notes: 'Extended by request' }).expect(200)).body;
    expect(extended.status).toBe('LIVE');
    await api('post', `${path}/archive`).expect(409);

    await api('post', `${path}/transitions`).send({ to: 'PAUSED' }).expect(400);
    await api('post', `${path}/cms-operations`).send({ screenId: screenA.id, type: 'PLAYBACK_PAUSED', performedAt: new Date().toISOString() }).expect(201);
    expect((await api('post', `${path}/transitions`).send({ to: 'PAUSED', reason: 'Client request' }).expect(200)).body.status).toBe('PAUSED');
    const pauseAudit = await db.auditLog.findFirst({ where: { entityId: campaign.id, action: 'CAMPAIGN_STATUS_CHANGED' }, orderBy: { timestamp: 'desc' } });
    expect(pauseAudit?.metadata).toMatchObject({ reason: 'Client request', screensWithoutMatchingCmsRecord: [screenB.screenId] });
    await api('post', `${path}/transitions`).send({ to: 'READY' }).expect(409);
    expect((await api('post', `${path}/transitions`).send({ to: 'LIVE', reason: 'Resumed' }).expect(200)).body.status).toBe('LIVE');
    const done = (await api('post', `${path}/transitions`).send({ to: 'COMPLETED' }).expect(200)).body;
    expect(done.completedAt).not.toBeNull();
    await api('patch', path).send({ notes: 'late' }).expect(409);
    await api('post', `${path}/transitions`).send({ to: 'LIVE' }).expect(409);
    // A stop can still be declared after completion.
    await api('post', `${path}/cms-operations`).send({ screenId: screenB.id, type: 'PLAYBACK_STOPPED', performedAt: new Date().toISOString() }).expect(201);

    const ops = (await api('get', `${path}/cms-operations?screenId=${screenA.id}`).expect(200)).body;
    expect(ops.items.map((op: { type: string }) => op.type)).toEqual(['PLAYBACK_PAUSED', 'CMS_UPLOADED']);
    const opId = ops.items[0].id;
    await expect(db.campaignCmsOperation.update({ where: { id: opId }, data: { note: 'edited' } })).rejects.toThrow();
    await expect(db.campaignCmsOperation.delete({ where: { id: opId } })).rejects.toThrow();
    const activity = (await api('get', `${path}/activity?pageSize=100`).expect(200)).body;
    expect(activity.items.map((item: { action: string }) => item.action)).toEqual(expect.arrayContaining([
      'CAMPAIGN_CREATED', 'CAMPAIGN_SCREENS_ADDED', 'CAMPAIGN_CREATIVE_LINKED', 'CAMPAIGN_SCHEDULE_REPLACED', 'CAMPAIGN_UPDATED',
      'CAMPAIGN_STATUS_CHANGED', 'CAMPAIGN_CMS_OPERATION_RECORDED']));
    const auto = await db.auditLog.findFirst({ where: { entityId: campaign.id, action: 'CAMPAIGN_STATUS_CHANGED', metadata: { path: ['automatic'], equals: true } } });
    expect(auto).not.toBeNull();
  });

  it('flags inactive screens, unknown hours, timezone differences, too-long creatives and approved multipliers', async () => {
    const known = await makeScreen({ defaultSlotLengthSec: 10 });
    const unknown = await makeScreen({ operatingStart: null, operatingEnd: null, defaultSlotLengthSec: null, resolutionWidth: 1080, resolutionHeight: 1920 });
    const elsewhere = await makeScreen({ timezone: 'Europe/Athens' });
    const closed = await makeScreen({ operatingStart: '09:00', operatingEnd: '17:00' });
    const campaign = await makeCampaign();
    const path = `/campaigns/${campaign.id}`;
    const long = (await upload(fresh('long')).expect(201)).body;
    await api('post', `/creatives/${long.id}/approve`).expect(200);
    await api('post', `${path}/screens`).send({ screenIds: [known.id, unknown.id, elsewhere.id, closed.id] }).expect(200);
    await api('post', `${path}/creatives`).send({ creativeId: long.id }).expect(200);
    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: 2, startTime: '18:00', endTime: '20:00' }] }).expect(200);
    const multiplier = (await api('post', `/screens/${known.id}/multipliers`).send({ value: '2.5', sourceRef: 'Survey', changeReason: 'Pilot' }).expect(201)).body;
    await api('post', `/screens/${known.id}/multipliers/${multiplier.id}/approve`).send({}).expect(200);
    await api('patch', path).send({ primaryGoal: 'IMPRESSIONS', targetImpressions: '1000' }).expect(200);
    const result = (await api('get', `${path}/validation`).expect(200)).body;
    const find = (list: { code: string; screens: string[] }[], code: string) => list.find(item => item.code === code)?.screens ?? [];
    expect(find(result.blockers, 'NO_PLAYBACK_WINDOW')).toEqual([closed.screenId]);
    expect(find(result.blockers, 'CREATIVE_TOO_LONG').sort()).toEqual([known.screenId, elsewhere.screenId, closed.screenId].sort());
    expect(find(result.blockers, 'MISSING_MULTIPLIER')).not.toContain(known.screenId);
    expect(find(result.warnings, 'OPERATING_HOURS_UNKNOWN')).toEqual([unknown.screenId]);
    expect(find(result.warnings, 'TIMEZONE_MISMATCH')).toEqual([elsewhere.screenId]);
    expect(find(result.warnings, 'SLOT_LENGTH_UNKNOWN')).toEqual([unknown.screenId]);
    expect(find(result.warnings, 'RESOLUTION_MISMATCH')).toEqual([unknown.screenId]);
    const detail = (await api('get', path).expect(200)).body;
    const rows = Object.fromEntries(detail.screens.map((row: { screenId: string }) => [row.screenId, row]));
    expect(rows[known.id]).toMatchObject({ currentMultiplier: '2.5000', weeklyWindowHours: '2.00' });
    expect(rows[unknown.id].weeklyWindowHours).toBeNull();
    expect(rows[elsewhere.id].weeklyWindowHours).toBeNull();
    await api('patch', `/screens/${known.id}`).send({ active: false }).expect(200);
    const after = (await api('get', `${path}/validation`).expect(200)).body;
    expect(find(after.blockers, 'INACTIVE_SCREENS')).toEqual([known.screenId]);
    expect(after.missingCmsUpload).not.toContain(known.screenId);
  });

  it('keeps advertiser and creatives consistent, archives only drafts and rejects legacy statuses', async () => {
    const campaign = await makeCampaign();
    const path = `/campaigns/${campaign.id}`;
    const image = (await upload(fresh('png'), { displayDurationSeconds: '6' }).expect(201)).body;
    await api('post', `${path}/creatives`).send({ creativeId: image.id }).expect(200);
    await api('patch', path).send({ advertiserId: otherAdvertiserId }).expect(409);
    await api('post', `${path}/creatives/remove`).send({ creativeId: image.id }).expect(200);
    await api('post', `${path}/creatives/remove`).send({ creativeId: image.id }).expect(404);
    expect((await api('patch', path).send({ advertiserId: otherAdvertiserId, agencyId: null }).expect(200)).body)
      .toMatchObject({ advertiser: { id: otherAdvertiserId }, agency: null });
    await api('patch', path).send({}).expect(400);
    await api('patch', path).send({ endAt: campaign.startAt }).expect(400);
    await api('post', `${path}/archive`).expect(204);
    await api('get', path).expect(404);
    const listed = (await api('get', `/campaigns?search=${campaign.code}`).expect(200)).body;
    expect(listed.total).toBe(0);

    const legacy = await db.campaign.create({ data: { code: `LEGACY-${runId}`, name: 'Legacy review', advertiserId, internalOwnerId: users.ADMIN,
      startAt: new Date(Date.now() + 3600_000), endAt: new Date(Date.now() + 7200_000), status: 'READY_FOR_REVIEW' } });
    campaigns.push(legacy.id);
    for (const to of ['READY', 'DRAFT', 'CANCELLED', 'LIVE']) {
      await api('post', `/campaigns/${legacy.id}/transitions`).send({ to, reason: 'x' }).expect(409);
    }
    await api('post', `/campaigns/${legacy.id}/transitions`).send({ to: 'PAUSING' }).expect(400);
    const draft = await makeCampaign();
    await api('post', `/campaigns/${draft.id}/transitions`).send({ to: 'CANCELLED' }).expect(400);
    expect((await api('post', `/campaigns/${draft.id}/transitions`).send({ to: 'CANCELLED', reason: 'Client withdrew' }).expect(200)).body.status).toBe('CANCELLED');
    await api('post', `/campaigns/${draft.id}/screens`).send({ screenIds: [randomUUID()] }).expect(409);
  });

  it('enforces database guards independently of the API', async () => {
    const campaign = await db.campaign.findFirstOrThrow({ where: { id: { in: campaigns } } });
    await expect(db.campaign.update({ where: { id: campaign.id }, data: { targetPlayouts: 0n } })).rejects.toThrow();
    await expect(db.campaign.update({ where: { id: campaign.id }, data: { unitPrice: new Prisma.Decimal('-1') } })).rejects.toThrow();
    await expect(db.schedule.create({ data: { campaignId: campaign.id, dayOfWeek: 9, startTime: '10:00', endTime: '11:00' } })).rejects.toThrow();
    await expect(db.$executeRawUnsafe('TRUNCATE campaign_cms_operations')).rejects.toThrow();
  });
});
