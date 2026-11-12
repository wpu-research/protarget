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
import { UPLOAD_DIR, UPLOAD_LIMIT } from '../src/modules/creatives/upload-guard';
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
  const declare = (path: string, screenId: string, type = 'CMS_UPLOADED', extra: object = {}) =>
    api('post', `${path}/cms-operations`).send({ screenId, type, performedAt: new Date().toISOString(), ...extra });
  /** One screen, one approved creative, a Monday daypart and a playout goal: a booking that validates and is READY. */
  async function readyCampaign(options: { creative?: string; file?: string } = {}) {
    const screen = await makeScreen();
    const campaign = await makeCampaign();
    const path = `/campaigns/${campaign.id}`;
    const file = options.file ?? fresh('png');
    let creativeId = options.creative;
    if (!creativeId) {
      creativeId = (await upload(file, { displayDurationSeconds: '10' }).expect(201)).body.id as string;
      await api('post', `/creatives/${creativeId}/approve`).expect(200);
    }
    await api('post', `${path}/screens`).send({ screenIds: [screen.id] }).expect(200);
    await api('post', `${path}/creatives`).send({ creativeId }).expect(200);
    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }] }).expect(200);
    await api('patch', path).send({ primaryGoal: 'PLAYOUTS', targetPlayouts: '1000' }).expect(200);
    await api('post', `${path}/transitions`).send({ to: 'READY' }).expect(200);
    return { screen, campaign, path, creativeId, file };
  }
  const auditCount = (entityId: string) => db.auditLog.count({ where: { entityId } });
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
      ['post', `/creatives/${randomUUID()}/revoke`, { reason: 'x' }],
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
    // Multer temp files must not survive a rejected body (Nest FileInterceptor cleanup); they live in the dedicated upload dir (D6).
    const temps = () => readdirSync(UPLOAD_DIR).sort();
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
    // Extending the end changed the plan after the uploads were recorded: the proof is stale until it is declared again (G1).
    const stale = await api('post', `${path}/transitions`).send({ to: 'LIVE', reason: 'Resumed' }).expect(409);
    expect(stale.body.error.details.missingCmsUpload.sort()).toEqual([screenA.screenId, screenB.screenId].sort());
    expect((await api('get', path).expect(200)).body.screens.every((row: { cmsUploaded: boolean; cmsUploadStale: boolean }) => !row.cmsUploaded && row.cmsUploadStale)).toBe(true);
    for (const screen of [screenA, screenB]) {
      await api('post', `${path}/cms-operations`).send({ screenId: screen.id, type: 'CMS_UPLOADED', performedAt: new Date().toISOString() }).expect(201);
    }
    expect((await api('post', `${path}/transitions`).send({ to: 'LIVE', reason: 'Resumed' }).expect(200)).body.status).toBe('LIVE');
    const done = (await api('post', `${path}/transitions`).send({ to: 'COMPLETED' }).expect(200)).body;
    expect(done.completedAt).not.toBeNull();
    await api('patch', path).send({ notes: 'late' }).expect(409);
    await api('post', `${path}/transitions`).send({ to: 'LIVE' }).expect(409);
    // CMS declarations are closed once the booking is COMPLETED (P2).
    await api('post', `${path}/cms-operations`).send({ screenId: screenB.id, type: 'PLAYBACK_STOPPED', performedAt: new Date().toISOString() }).expect(409);
    await api('post', `${path}/cms-operations`).send({ screenId: screenB.id, type: 'NOTE', note: 'late', performedAt: new Date().toISOString() }).expect(409);

    const ops = (await api('get', `${path}/cms-operations?screenId=${screenA.id}`).expect(200)).body;
    expect(ops.items.map((op: { type: string }) => op.type)).toEqual(['CMS_UPLOADED', 'PLAYBACK_PAUSED', 'CMS_UPLOADED']);
    const opId = ops.items[1].id;
    await expect(db.campaignCmsOperation.update({ where: { id: opId }, data: { note: 'edited' } })).rejects.toThrow();
    await expect(db.campaignCmsOperation.delete({ where: { id: opId } })).rejects.toThrow();
    const activity = (await api('get', `${path}/activity?pageSize=100`).expect(200)).body;
    expect(activity.items.map((item: { action: string }) => item.action)).toEqual(expect.arrayContaining([
      'CAMPAIGN_CREATED', 'CAMPAIGN_SCREENS_ADDED', 'CAMPAIGN_CREATIVE_LINKED', 'CAMPAIGN_SCHEDULE_REPLACED', 'CAMPAIGN_UPDATED',
      'CAMPAIGN_STATUS_CHANGED', 'CAMPAIGN_CMS_OPERATION_RECORDED']));
    const auto = await db.auditLog.findFirst({ where: { entityId: campaign.id, action: 'CAMPAIGN_STATUS_CHANGED', metadata: { path: ['automatic'], equals: true } } });
    expect(auto).not.toBeNull();
  });

  it('only counts CMS uploads recorded after the last effective plan change and closes CMS writes outside READY/LIVE/PAUSED (G1, P2)', async () => {
    const draft = await makeCampaign();
    const screen = await makeScreen();
    await api('post', `/campaigns/${draft.id}/screens`).send({ screenIds: [screen.id] }).expect(200);
    // DRAFT accepts notes only, and a note needs text.
    await declare(`/campaigns/${draft.id}`, screen.id, 'CMS_UPLOADED').expect(409);
    await declare(`/campaigns/${draft.id}`, screen.id, 'NOTE').expect(400);
    await declare(`/campaigns/${draft.id}`, screen.id, 'NOTE', { note: '   ' }).expect(400);
    await declare(`/campaigns/${draft.id}`, screen.id, 'NOTE', { note: 'Panel access pending' }).expect(201);

    const { path, screen: ready } = await readyCampaign();
    const noNote = await declare(path, ready.id, 'NOTE').expect(400);
    expect(noNote.body.error.details).toMatchObject({ reason: 'NOTE_REQUIRED' });
    const planned = (await api('get', path).expect(200)).body;
    expect(planned.planChangedAt).toMatch(/Z$/);
    expect(planned.screens[0]).toMatchObject({ cmsUploaded: false, cmsUploadStale: false });
    // performedAt can be backdated; only the server-side recordedAt decides freshness.
    await declare(path, ready.id, 'CMS_UPLOADED', { performedAt: planned.createdAt }).expect(201);
    expect((await api('get', path).expect(200)).body.screens[0]).toMatchObject({ cmsUploaded: true, cmsUploadStale: false });
    expect((await api('get', `${path}/validation`).expect(200)).body.missingCmsUpload).toEqual([]);

    // A no-op does not age the proof; a real plan change does and returns the booking to DRAFT.
    await api('patch', path).send({ targetPlayouts: '1000' }).expect(200);
    expect((await api('get', path).expect(200)).body.screens[0].cmsUploaded).toBe(true);
    const edited = (await api('patch', path).send({ targetPlayouts: '2000' }).expect(200)).body;
    expect(edited.status).toBe('DRAFT');
    expect(edited.planChangedAt > planned.planChangedAt).toBe(true);
    expect(edited.screens[0]).toMatchObject({ cmsUploaded: false, cmsUploadStale: true });
    await api('post', `${path}/transitions`).send({ to: 'READY' }).expect(200);
    const refused = await api('post', `${path}/transitions`).send({ to: 'LIVE' }).expect(409);
    expect(refused.body.error.details.missingCmsUpload).toEqual([ready.screenId]);
    expect((await api('get', `${path}/validation`).expect(200)).body.missingCmsUpload).toEqual([ready.screenId]);
    await declare(path, ready.id, 'CMS_UPLOADED', { performedAt: planned.createdAt }).expect(201);
    expect((await api('post', `${path}/transitions`).send({ to: 'LIVE' }).expect(200)).body.status).toBe('LIVE');

    // Terminal states take no CMS declarations at all.
    expect((await api('post', `${path}/transitions`).send({ to: 'COMPLETED' }).expect(200)).body.status).toBe('COMPLETED');
    expect((await declare(path, ready.id, 'PLAYBACK_STOPPED').expect(409)).body.error.details).toMatchObject({ reason: 'CMS_STATUS_NOT_ALLOWED' });
    expect((await declare(path, ready.id, 'CMS_UPLOADED', { performedAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(409)).body.error.code).toBeDefined();
    const cancelled = await makeCampaign();
    await api('post', `/campaigns/${cancelled.id}/screens`).send({ screenIds: [screen.id] }).expect(200);
    await api('post', `/campaigns/${cancelled.id}/transitions`).send({ to: 'CANCELLED', reason: 'Withdrawn' }).expect(200);
    await declare(`/campaigns/${cancelled.id}`, screen.id, 'NOTE', { note: 'x' }).expect(409);
  });

  it('revokes approved creatives with a reason: READY drops to DRAFT, LIVE stays with a warning, revoked ones cannot be linked (G2)', async () => {
    const first = await readyCampaign();
    const second = await readyCampaign({ creative: first.creativeId });
    await declare(second.path, second.screen.id).expect(201);
    await api('post', `${second.path}/transitions`).send({ to: 'LIVE' }).expect(200);
    const pending = (await upload(fresh('png'), { displayDurationSeconds: '5' }).expect(201)).body;
    await api('post', `/creatives/${pending.id}/revoke`).send({ reason: 'Not approved yet' }).expect(409);
    await api('post', `/creatives/${first.creativeId}/revoke`).send({ reason: '' }).expect(400);
    await api('post', `/creatives/${first.creativeId}/revoke`).send({}).expect(400);
    await api('post', `/creatives/${first.creativeId}/revoke`).send({ reason: 'x'.repeat(1001) }).expect(400);
    const planBefore = (await api('get', first.path).expect(200)).body.planChangedAt;

    const revoked = (await api('post', `/creatives/${first.creativeId}/revoke`).send({ reason: '  Licence expired  ' }).expect(200)).body;
    expect(revoked).toMatchObject({ status: 'REVOKED', revocationReason: 'Licence expired', revokedBy: { id: users.ADMIN } });
    expect(revoked.revokedAt).toMatch(/Z$/);
    await api('post', `/creatives/${first.creativeId}/revoke`).send({ reason: 'again' }).expect(409);
    await api('post', `/creatives/${first.creativeId}/approve`).expect(409);
    expect((await api('get', `/creatives?status=REVOKED&advertiserId=${advertiserId}`).expect(200)).body.items.map((item: { id: string }) => item.id))
      .toContain(first.creativeId);

    const one = (await api('get', first.path).expect(200)).body;
    expect(one.status).toBe('DRAFT');
    expect(one.planChangedAt > planBefore).toBe(true);
    expect(one.screens[0]).toMatchObject({ cmsUploaded: false });
    expect(one.creatives[0]).toMatchObject({ status: 'REVOKED', revocationReason: 'Licence expired' });
    const automatic = await db.auditLog.findFirst({ where: { entityId: first.campaign.id, action: 'CAMPAIGN_STATUS_CHANGED' }, orderBy: { timestamp: 'desc' } });
    expect(automatic?.metadata).toMatchObject({ automatic: true, reason: 'CREATIVE_REVOKED', creativeId: first.creativeId });
    expect(await db.auditLog.count({ where: { entityId: first.campaign.id, action: 'CAMPAIGN_CREATIVE_REVOKED' } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: first.creativeId, action: 'CREATIVE_REVOKED' } })).toBe(1);

    // LIVE is a declaration and stays LIVE, but the booking now reports the revoked creative and stale proof.
    const two = (await api('get', second.path).expect(200)).body;
    expect(two.status).toBe('LIVE');
    expect(two.screens[0]).toMatchObject({ cmsUploaded: false, cmsUploadStale: true });
    const validation = (await api('get', `${second.path}/validation`).expect(200)).body;
    expect(validation.warnings.map((w: { code: string }) => w.code)).toContain('REVOKED_CREATIVE');
    expect(validation.blockers.map((b: { code: string }) => b.code)).toContain('NO_APPROVED_CREATIVE');

    // Revoked creatives cannot be linked, may leave a LIVE booking (the only exception to the plan lock), and count as duplicates.
    const other = await makeCampaign();
    await api('post', `/campaigns/${other.id}/creatives`).send({ creativeId: first.creativeId }).expect(409);
    await api('post', `${second.path}/screens/remove`).send({ screenIds: [second.screen.id] }).expect(409);
    const unlinked = (await api('post', `${second.path}/creatives/remove`).send({ creativeId: first.creativeId }).expect(200)).body;
    expect(unlinked).toMatchObject({ status: 'LIVE', creatives: [] });
    const duplicate = await upload(first.file, { displayDurationSeconds: '10' }).expect(409);
    expect(duplicate.body.error).toMatchObject({ code: 'DUPLICATE_CREATIVE', details: { creativeId: first.creativeId, status: 'REVOKED' } });
    expect(duplicate.body.error.message).toMatch(/revoked/);

    // The immutability trigger allows exactly APPROVED -> REVOKED with a reason, and freezes the result.
    await expect(db.creative.update({ where: { id: first.creativeId }, data: { status: 'APPROVED' } })).rejects.toThrow();
    await expect(db.creative.update({ where: { id: first.creativeId }, data: { revocationReason: 'edited' } })).rejects.toThrow();
    await api('post', `/creatives/${pending.id}/approve`).expect(200);
    await expect(db.creative.update({ where: { id: pending.id }, data: { status: 'REVOKED' } })).rejects.toThrow();
    await expect(db.creative.update({ where: { id: pending.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: users.ADMIN,
      revocationReason: 'direct', width: 1 } })).rejects.toThrow();
  });

  it('accepts uppercase UUIDs everywhere, builds storage keys from database ids and prevents version-chain forks (P3, P12)', async () => {
    const v1 = (await upload(fresh('png'), { displayDurationSeconds: '5', advertiserId: advertiserId.toUpperCase() }).expect(201)).body;
    expect(v1.advertiserId).toBe(advertiserId);
    const v2 = (await upload(fresh('png'), { displayDurationSeconds: '5', replacesId: v1.id.toUpperCase() }).expect(201)).body;
    expect(v2).toMatchObject({ version: 2, replacesId: v1.id });
    expect((await db.creative.findUniqueOrThrow({ where: { id: v2.id } })).storageKey)
      .toMatch(new RegExp(`^creatives/${advertiserId}/[0-9a-f-]{36}$`));
    const fork = await upload(fresh('png'), { displayDurationSeconds: '5', replacesId: v1.id }).expect(409);
    expect(fork.body.error.code).toBe('INVALID_STATE_TRANSITION');
    await api('get', `/creatives/${v1.id.toUpperCase()}`).expect(200);
    await api('post', `/creatives/${v2.id.toUpperCase()}/reject`).send({ reason: 'Wrong cut' }).expect(200);
    // Rejecting the child frees the slot for another replacement.
    const v3 = (await upload(fresh('png'), { displayDurationSeconds: '5', replacesId: v1.id }).expect(201)).body;

    const screen = await makeScreen();
    const campaign = await makeCampaign({ advertiserId: advertiserId.toUpperCase(), agencyId: agencyId.toUpperCase() });
    expect(campaign.advertiser.id).toBe(advertiserId);
    const path = `/campaigns/${campaign.id.toUpperCase()}`;
    await api('post', `${path}/screens`).send({ screenIds: [screen.id.toUpperCase(), screen.id] }).expect(400);
    const added = (await api('post', `${path}/screens`).send({ screenIds: [screen.id.toUpperCase()] }).expect(200)).body;
    expect(added.screens.map((row: { screenId: string }) => row.screenId)).toEqual([screen.id]);
    expect((await api('post', `${path}/creatives`).send({ creativeId: v3.id.toUpperCase() }).expect(200)).body.creatives).toHaveLength(1);
    await api('patch', path).send({ advertiserId: otherAdvertiserId.toUpperCase() }).expect(409);
    await declare(path, screen.id.toUpperCase(), 'NOTE', { note: 'uppercase ok' }).expect(201);
    await api('get', `${path}/cms-operations?screenId=${screen.id.toUpperCase()}`).expect(200);
  });

  it('treats unchanged edits as no-ops: no audit, no READY revert, no planChangedAt movement (P9)', async () => {
    const { path, campaign, screen } = await readyCampaign();
    await api('patch', path).send({ pricingModel: 'CPM', unitPrice: '125.5', budget: '10000', publisherSharePct: '60', protargetSharePct: '40' }).expect(200);
    await api('post', `${path}/transitions`).send({ to: 'READY' }).expect(200);
    const detail = (await api('get', path).expect(200)).body;
    const audits = await auditCount(campaign.id);
    const resend = (await api('patch', path).send({ name: detail.name, advertiserId: advertiserId.toUpperCase(), agencyId, internalOwnerId: users.ADMIN,
      startAt: detail.startAt, endAt: detail.endAt, timezone: detail.timezone, notes: null, primaryGoal: 'PLAYOUTS', targetPlayouts: '1000',
      targetImpressions: null, pricingModel: 'CPM', currency: 'TRY', unitPrice: '125.50', budget: '10000.0000', contractedAmount: null,
      overdeliveryTolerancePct: '1', pgBillingBasis: 'CONTRACTED', publisherSharePct: '60.00', protargetSharePct: '40' }).expect(200)).body;
    expect(resend).toMatchObject({ status: 'READY', planChangedAt: detail.planChangedAt, updatedAt: detail.updatedAt });
    expect(await auditCount(campaign.id)).toBe(audits);
    const noops = [
      await api('post', `${path}/screens`).send({ screenIds: [screen.id] }).expect(200),
      await api('post', `${path}/screens/remove`).send({ screenIds: [randomUUID()] }).expect(200),
      await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }] }).expect(200),
    ];
    for (const response of noops) expect(response.body).toMatchObject({ status: 'READY', planChangedAt: detail.planChangedAt });
    // The tolerance column is NOT NULL: the DTO refuses null, so it can never stamp a plan change (CR-2).
    await api('patch', path).send({ overdeliveryTolerancePct: null }).expect(400);
    expect(await auditCount(campaign.id)).toBe(audits);
    // A real change still reverts and audits only what changed.
    const changed = (await api('patch', path).send({ name: detail.name, budget: '20000' }).expect(200)).body;
    expect(changed.status).toBe('DRAFT');
    const update = await db.auditLog.findFirst({ where: { entityId: campaign.id, action: 'CAMPAIGN_UPDATED' }, orderBy: { timestamp: 'desc' } });
    expect(update?.metadata).toEqual({ fields: ['budget'] });
    // Unchanged fields never trip the LIVE restriction either.
    await api('post', `${path}/transitions`).send({ to: 'READY' }).expect(200);
    await declare(path, screen.id).expect(201);
    await api('post', `${path}/transitions`).send({ to: 'LIVE' }).expect(200);
    expect((await api('patch', path).send({ name: detail.name, notes: 'Only a note' }).expect(200)).body).toMatchObject({ status: 'LIVE', notes: 'Only a note' });
  });

  it('replaces only campaign-wide dayparts and keeps legacy per-screen schedule rows (P4)', async () => {
    const screen = await makeScreen();
    const campaign = await makeCampaign();
    const path = `/campaigns/${campaign.id}`;
    await db.schedule.create({ data: { campaignId: campaign.id, screenId: screen.id, dayOfWeek: 3, startTime: '10:00', endTime: '11:00' } });
    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }] }).expect(200);
    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: 2, startTime: '08:00', endTime: '12:00' }] }).expect(200);
    await api('post', `${path}/schedule`).send({ slots: [] }).expect(200);
    expect(await db.schedule.count({ where: { campaignId: campaign.id, screenId: screen.id } })).toBe(1);
    expect(await db.schedule.count({ where: { campaignId: campaign.id, screenId: null } })).toBe(0);
  });

  it('blocks going LIVE from PAUSED once the flight has ended and warns while a READY flight has not started (P10)', async () => {
    const { path, campaign, screen } = await readyCampaign();
    expect((await api('get', `${path}/validation`).expect(200)).body.warnings.map((w: { code: string }) => w.code)).toContain('FLIGHT_NOT_STARTED');
    await declare(path, screen.id).expect(201);
    await api('post', `${path}/transitions`).send({ to: 'LIVE' }).expect(200);
    await api('post', `${path}/transitions`).send({ to: 'PAUSED', reason: 'Holiday' }).expect(200);
    await declare(path, screen.id).expect(201);
    await db.campaign.update({ where: { id: campaign.id }, data: { startAt: new Date(Date.now() - 48 * 3600_000), endAt: new Date(Date.now() - 3600_000) } });
    const refused = await api('post', `${path}/transitions`).send({ to: 'LIVE', reason: 'Resume' }).expect(409);
    expect(refused.body.error).toMatchObject({ code: 'CAMPAIGN_NOT_READY' });
    expect(refused.body.error.details.blockers.map((b: { code: string }) => b.code)).toContain('INVALID_FLIGHT');
    expect((await api('get', path).expect(200)).body.status).toBe('PAUSED');
    await api('post', `${path}/transitions`).send({ to: 'COMPLETED' }).expect(200);
  });

  it('validates dayparts against the flight, not only the abstract week (P1)', async () => {
    const screen = await makeScreen();
    const base = new Date(); base.setUTCDate(base.getUTCDate() + 3); base.setUTCHours(7, 0, 0, 0); // 10:00 Istanbul
    const flight = { startAt: base.toISOString(), endAt: new Date(base.getTime() + 2 * 3600_000).toISOString() }; // 10:00–12:00 local
    const weekday = new Date(base.getTime() + 3 * 3600_000).getUTCDay() || 7; // ISO weekday of the flight (UTC+3)
    const campaign = await makeCampaign(flight);
    const path = `/campaigns/${campaign.id}`;
    await api('post', `${path}/screens`).send({ screenIds: [screen.id] }).expect(200);
    const blockers = async () => (await api('get', `${path}/validation`).expect(200)).body.blockers as { code: string; screens: string[] }[];
    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: (weekday % 7) + 1, startTime: '10:00', endTime: '12:00' }] }).expect(200);
    expect((await blockers()).find(item => item.code === 'NO_PLAYBACK_WINDOW')?.screens).toEqual([screen.screenId]);
    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: weekday, startTime: '13:00', endTime: '15:00' }] }).expect(200);
    expect((await blockers()).map(item => item.code)).toContain('NO_PLAYBACK_WINDOW');
    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: weekday, startTime: '11:00', endTime: '13:00' }] }).expect(200);
    expect((await blockers()).map(item => item.code)).not.toContain('NO_PLAYBACK_WINDOW');
    // The plain weekly figure in the screen row is unaffected by the flight.
    expect((await api('get', path).expect(200)).body.screens[0].weeklyWindowHours).toBe('2.00');
  });

  it('keeps already-selected screens visible after they are deleted or deactivated (P17)', async () => {
    const screen = await makeScreen();
    const campaign = await makeCampaign();
    const path = `/campaigns/${campaign.id}`;
    await api('post', `${path}/screens`).send({ screenIds: [screen.id] }).expect(200);
    await db.screen.update({ where: { id: screen.id }, data: { deletedAt: new Date(), active: false } });
    const selected = (await api('get', `${path}/screen-options?selected=true`).expect(200)).body;
    expect(selected.items).toHaveLength(1);
    expect(selected.items[0]).toMatchObject({ screenId: screen.id, selected: true, active: false });
    const options = (await api('get', `${path}/screen-options?search=${screen.screenId}`).expect(200)).body;
    expect(options.items).toHaveLength(0);
  });

  it('rejects QuickTime containers and oversized images at upload (P6)', async () => {
    const mov = join(mediaDir, `${randomUUID()}.mp4`);
    ffmpeg('-f', 'lavfi', '-i', `color=c=0x${randomBytes(3).toString('hex')}:s=320x180:d=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'mov', mov);
    expect((await upload(mov).expect(201)).body).toMatchObject({ status: 'REJECTED', rejectionReason: 'NOT_MP4_CONTAINER' });
    const wide = join(mediaDir, `${randomUUID()}.png`);
    ffmpeg('-f', 'lavfi', '-i', `color=c=0x${randomBytes(3).toString('hex')}:s=8200x16`, '-frames:v', '1', wide);
    expect((await upload(wide, { displayDurationSeconds: '5' }).expect(201)).body).toMatchObject({ status: 'REJECTED', rejectionReason: 'DIMENSIONS_TOO_LARGE' });
  });

  it('serves a safe Content-Disposition for awkward filenames (P19)', async () => {
    const file = join(mediaDir, "it's (a) *özel*.png");
    ffmpeg('-f', 'lavfi', '-i', `color=c=0x${randomBytes(3).toString('hex')}:s=64x64`, '-frames:v', '1', file);
    const created = (await upload(file, { displayDurationSeconds: '5' }).expect(201)).body;
    const header = (await api('get', `/creatives/${created.id}/file`).expect(200)).headers['content-disposition'];
    expect(header).toContain(`filename*=UTF-8''it%27s%20%28a%29%20%2A%C3%B6zel%2A.png`);
    expect(header).toContain('filename="it\'s (a) *_zel*.png"');
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

  it('leaves finished bookings alone when a creative is revoked, and lets NOTE entries never hide the last playback declaration (CR-2)', async () => {
    const done = await readyCampaign();
    await declare(done.path, done.screen.id).expect(201);
    await api('post', `${done.path}/transitions`).send({ to: 'LIVE' }).expect(200);
    await api('post', `${done.path}/transitions`).send({ to: 'COMPLETED' }).expect(200);
    const before = (await api('get', done.path).expect(200)).body;
    const auditsBefore = await auditCount(done.campaign.id);
    await api('post', `/creatives/${done.creativeId}/revoke`).send({ reason: 'Rights withdrawn' }).expect(200);
    const after = (await api('get', done.path).expect(200)).body;
    expect(after).toMatchObject({ status: 'COMPLETED', planChangedAt: before.planChangedAt });
    expect(await auditCount(done.campaign.id)).toBe(auditsBefore);

    const live = await readyCampaign();
    await declare(live.path, live.screen.id).expect(201);
    await api('post', `${live.path}/transitions`).send({ to: 'LIVE' }).expect(200);
    await declare(live.path, live.screen.id, 'PLAYBACK_PAUSED').expect(201);
    await declare(live.path, live.screen.id, 'NOTE', { note: 'Operator remark' }).expect(201);
    expect((await api('get', live.path).expect(200)).body.screens[0].lastCmsOperation).toMatchObject({ type: 'PLAYBACK_PAUSED' });
  });

  it('maps a concurrent upload of the same file to DUPLICATE_CREATIVE instead of a generic conflict (CR-3)', async () => {
    const file = fresh('png');
    const results = await Promise.all([upload(file, { displayDurationSeconds: '10' }), upload(file, { displayDurationSeconds: '10' })]);
    const statuses = results.map(response => response.status).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = results.find(response => response.status === 409)!;
    expect(loser.body.error).toMatchObject({ code: 'DUPLICATE_CREATIVE', details: { creativeId: results.find(response => response.status === 201)!.body.id } });
  });

  it('reports CMS declaration problems with machine-readable reasons, and a revoked creative leaves a PAUSED booking paused (CR-4)', async () => {
    const { path, screen } = await readyCampaign();
    const reason = async (response: { body: { error: { details: { reason: string } } } }) => response.body.error.details.reason;
    expect(await reason(await declare(path, screen.id, 'CMS_UPLOADED', { performedAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(400)))
      .toBe('PERFORMED_IN_FUTURE');
    expect(await reason(await declare(path, screen.id, 'CMS_UPLOADED', { performedAt: '2000-01-01T00:00:00.000Z' }).expect(400)))
      .toBe('PERFORMED_BEFORE_BOOKING');
    const stranger = await makeScreen();
    expect(await reason(await declare(path, stranger.id).expect(400))).toBe('SCREEN_NOT_IN_BOOKING');

    await declare(path, screen.id).expect(201);
    await api('post', `${path}/transitions`).send({ to: 'LIVE' }).expect(200);
    await api('post', `${path}/transitions`).send({ to: 'PAUSED', reason: 'Client request' }).expect(200);
    const creativeId = (await api('get', path).expect(200)).body.creatives[0].id as string;
    await api('post', `/creatives/${creativeId}/revoke`).send({ reason: 'Rights withdrawn' }).expect(200);
    expect((await api('get', path).expect(200)).body.status).toBe('PAUSED');
    const warnings = (await api('get', `${path}/validation`).expect(200)).body.warnings.map((w: { code: string }) => w.code);
    expect(warnings).toContain('REVOKED_CREATIVE');
  });

  it('resolves an exhausted serialization conflict on a same-file upload to DUPLICATE_CREATIVE, and leaves other conflicts generic (CR-5)', async () => {
    const file = fresh('png');
    const first = (await upload(file, { displayDurationSeconds: '10' }).expect(201)).body;
    const exhausted = () => new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: 'test' });
    // upload() first resolves the advertiser in its own transaction: only the insert transaction (the second) is exhausted.
    const real = db.serializable.bind(db);
    let calls = 0;
    const spy = jest.spyOn(db, 'serializable').mockImplementation(((work: never) => (++calls === 2 ? Promise.reject(exhausted()) : real(work))) as never);
    try {
      const duplicate = await upload(file, { displayDurationSeconds: '10' }).expect(409);
      expect(duplicate.body.error).toMatchObject({ code: 'DUPLICATE_CREATIVE', details: { creativeId: first.id } });
      calls = 0;
      const unrelated = await upload(fresh('png'), { displayDurationSeconds: '10' }).expect(409);
      expect(unrelated.body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    } finally { spy.mockRestore(); }
  });

  it('enforces database guards independently of the API', async () => {
    const campaign = await db.campaign.findFirstOrThrow({ where: { id: { in: campaigns } } });
    await expect(db.campaign.update({ where: { id: campaign.id }, data: { targetPlayouts: 0n } })).rejects.toThrow();
    await expect(db.campaign.update({ where: { id: campaign.id }, data: { unitPrice: new Prisma.Decimal('-1') } })).rejects.toThrow();
    await expect(db.schedule.create({ data: { campaignId: campaign.id, dayOfWeek: 9, startTime: '10:00', endTime: '11:00' } })).rejects.toThrow();
    await expect(db.$executeRawUnsafe('TRUNCATE campaign_cms_operations')).rejects.toThrow();
  });

  it('enforces content uniqueness and version-chain integrity in the database (P12)', async () => {
    const row = (extra: object = {}) => ({ advertiserId, storageKey: 'db-guard', originalFilename: 'guard.png', mime: 'image/png', sizeBytes: 5n,
      code: `DB-${randomUUID()}`, checksum: `sha256:${randomBytes(32).toString('hex')}`, status: 'VALIDATING' as const, ...extra });
    const first = row();
    await db.creative.create({ data: first });
    await expect(db.creative.create({ data: row({ checksum: first.checksum }) })).rejects.toThrow();
    await expect(db.creative.create({ data: row({ checksum: first.checksum, advertiserId: otherAdvertiserId }) })).resolves.toBeDefined();
    await expect(db.creative.create({ data: row({ checksum: first.checksum, status: 'REJECTED' }) })).resolves.toBeDefined();
    const parent = await db.creative.create({ data: row() });
    await db.creative.create({ data: row({ replacesId: parent.id }) });
    await expect(db.creative.create({ data: row({ replacesId: parent.id }) })).rejects.toThrow();
    await expect(db.creative.create({ data: row({ replacesId: parent.id, status: 'REJECTED' }) })).resolves.toBeDefined();
  });
  it('keeps legacy per-screen schedule rows out of the detail, weeklyWindowHours and validation (D12)', async () => {
    const screen = await makeScreen();
    const campaign = await makeCampaign();
    const path = `/campaigns/${campaign.id}`;
    await api('post', `${path}/screens`).send({ screenIds: [screen.id] }).expect(200);
    await db.schedule.create({ data: { campaignId: campaign.id, screenId: screen.id, dayOfWeek: 3, startTime: '06:00', endTime: '23:00' } });
    // Only a legacy row exists: the booking has no campaign-wide dayparts at all.
    const bare = (await api('get', path).expect(200)).body;
    expect(bare.schedule).toEqual([]);
    expect(bare.screens[0].weeklyWindowHours).toBeNull();
    expect((await api('get', `${path}/validation`).expect(200)).body.blockers.map((b: { code: string }) => b.code)).toContain('NO_SCHEDULE');
    // With a campaign-wide daypart the hours come from that daypart alone (08:00–12:00 = 4 h, not +17 h from the legacy row).
    await api('post', `${path}/schedule`).send({ slots: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }] }).expect(200);
    const detail = (await api('get', path).expect(200)).body;
    expect(detail.schedule).toHaveLength(1);
    expect(detail.screens[0].weeklyWindowHours).toBe('4.00');
  });

  it('maps real Prisma errors for CHECK/trigger violations to 409 and nothing else (D11)', async () => {
    const campaign = await db.campaign.findFirstOrThrow({ where: { id: { in: campaigns } } });
    const approved = await db.creative.findFirstOrThrow({ where: { status: 'APPROVED' } });
    const caught = async (work: () => Promise<unknown>) => work().then(() => { throw new Error('expected a database error'); }, (error: unknown) => error);
    const { isCheckViolation, inventoryTransaction } = await import('../src/common/inventory-validation');
    // Model API (CHECK): PrismaClientUnknownRequestError carrying the engine's PostgresError text.
    const model = await caught(() => db.schedule.create({ data: { campaignId: campaign.id, dayOfWeek: 9, startTime: '10:00', endTime: '11:00' } }));
    expect(model).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
    expect(isCheckViolation(model)).toBe(true);
    // Model API (trigger RAISE ... ERRCODE 23514).
    const trigger = await caught(() => db.creative.update({ where: { id: approved.id }, data: { width: 1 } }));
    expect(isCheckViolation(trigger)).toBe(true);
    // Raw query: PrismaClientKnownRequestError P2010 with meta.code.
    const raw = await caught(() => db.$executeRawUnsafe('UPDATE campaigns SET "targetPlayouts" = 0 WHERE id = $1::uuid', campaign.id));
    expect(raw).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(isCheckViolation(raw)).toBe(true);
    // Other database errors are not check violations, even when the failing text contains 23514.
    const unique = await caught(() => db.organization.create({ data: { id: advertiserId, name: 'dup 23514', type: 'ADVERTISER' } }));
    expect(isCheckViolation(unique)).toBe(false);
    const foreignKey = await caught(() => db.schedule.create({ data: { campaignId: randomUUID(), dayOfWeek: 1, startTime: '10:00', endTime: '11:00' } }));
    expect(isCheckViolation(foreignKey)).toBe(false);

    // Through the transaction helper: 409 without database text, and the whole transaction rolled back.
    const before = await db.schedule.count({ where: { campaignId: campaign.id } });
    await expect(inventoryTransaction(db, async tx => {
      await tx.schedule.create({ data: { campaignId: campaign.id, dayOfWeek: 2, startTime: '10:00', endTime: '11:00' } });
      await tx.schedule.create({ data: { campaignId: campaign.id, dayOfWeek: 9, startTime: '10:00', endTime: '11:00' } });
    })).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE_TRANSITION', message: expect.not.stringContaining('schedules_') });
    expect(await db.schedule.count({ where: { campaignId: campaign.id } })).toBe(before);
  });

  it('answers a revoke of a creative linked to many campaigns with one consistent batch (D10)', async () => {
    const first = await readyCampaign();
    const ready = [first];
    for (let i = 0; i < 3; i++) ready.push(await readyCampaign({ creative: first.creativeId }));
    const live = await readyCampaign({ creative: first.creativeId });
    await declare(live.path, live.screen.id).expect(201);
    await api('post', `${live.path}/transitions`).send({ to: 'LIVE' }).expect(200);
    const draft = await makeCampaign();
    await api('post', `/campaigns/${draft.id}/creatives`).send({ creativeId: first.creativeId }).expect(200);
    const all = [...ready, live].map(c => c.campaign.id as string).concat(draft.id);
    const stamp = await db.campaign.findMany({ where: { id: { in: all } }, select: { id: true, planChangedAt: true } });
    const before = new Map(stamp.map(row => [row.id, row.planChangedAt.getTime()]));

    await api('post', `/creatives/${first.creativeId}/revoke`).send({ reason: 'Fan-out' }).expect(200);

    const after = await db.campaign.findMany({ where: { id: { in: all } }, select: { id: true, status: true, planChangedAt: true } });
    for (const row of after) {
      expect(row.planChangedAt.getTime()).toBeGreaterThan(before.get(row.id)!);
      expect(row.status).toBe(row.id === live.campaign.id ? 'LIVE' : 'DRAFT');
    }
    for (const id of all) {
      expect(await db.auditLog.count({ where: { entityId: id, action: 'CAMPAIGN_CREATIVE_REVOKED' } })).toBe(1);
      expect(await db.auditLog.count({ where: { entityId: id, action: 'CAMPAIGN_STATUS_CHANGED', metadata: { path: ['reason'], equals: 'CREATIVE_REVOKED' } } }))
        .toBe(ready.some(c => c.campaign.id === id) ? 1 : 0);
    }
  });

  it('resolves REVOKED and replacesId upload races to the right answer (D19)', async () => {
    // A REVOKED child still occupies the version slot of its parent.
    const v1 = (await upload(fresh('png'), { displayDurationSeconds: '5' }).expect(201)).body;
    const v2 = (await upload(fresh('png'), { displayDurationSeconds: '5', replacesId: v1.id }).expect(201)).body;
    await api('post', `/creatives/${v2.id}/approve`).expect(200);
    await api('post', `/creatives/${v2.id}/revoke`).send({ reason: 'Rights withdrawn' }).expect(200);
    const blocked = await upload(fresh('png'), { displayDurationSeconds: '5', replacesId: v1.id }).expect(409);
    expect(blocked.body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', message: expect.stringMatching(/newer version/) });
    // A revoked creative can itself be replaced.
    const v3 = (await upload(fresh('png'), { displayDurationSeconds: '5', replacesId: v2.id }).expect(201)).body;
    expect(v3).toMatchObject({ version: 3, replacesId: v2.id });

    // Two concurrent replacements of the same creative: exactly one wins; the loser is a conflict, never a 500.
    const parent = (await upload(fresh('png'), { displayDurationSeconds: '5' }).expect(201)).body;
    const results = await Promise.all([
      upload(fresh('png'), { displayDurationSeconds: '5', replacesId: parent.id }),
      upload(fresh('png'), { displayDurationSeconds: '5', replacesId: parent.id }),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(results.find(r => r.status === 409)!.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(await db.creative.count({ where: { replacesId: parent.id, status: { not: 'REJECTED' } } })).toBe(1);

    // A same-file race that lost on an exhausted serialization conflict reports the REVOKED duplicate, not a generic conflict.
    const file = fresh('png');
    const original = (await upload(file, { displayDurationSeconds: '5' }).expect(201)).body;
    await api('post', `/creatives/${original.id}/approve`).expect(200);
    await api('post', `/creatives/${original.id}/revoke`).send({ reason: 'Expired' }).expect(200);
    const real = db.serializable.bind(db);
    let calls = 0;
    const spy = jest.spyOn(db, 'serializable').mockImplementation(((work: never) => (++calls === 2
      ? Promise.reject(new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: 'test' })) : real(work))) as never);
    try {
      const lost = await upload(file, { displayDurationSeconds: '5' }).expect(409);
      expect(lost.body.error).toMatchObject({ code: 'DUPLICATE_CREATIVE', details: { creativeId: original.id, status: 'REVOKED' } });
      expect(lost.body.error.message).toMatch(/revoked/);
      // With replacesId and no matching duplicate, the exhausted conflict stays generic.
      calls = 0;
      const generic = await upload(fresh('png'), { displayDurationSeconds: '5', replacesId: parent.id }).expect(409);
      expect(generic.body.error.code).toBe('INVALID_STATE_TRANSITION');
    } finally { spy.mockRestore(); }
  });
  it('writes no upload temp file for denied callers and rate-limits uploads per admin (D6)', async () => {
    const temps = () => readdirSync(UPLOAD_DIR).sort();
    const before = temps();
    await upload(media.png, { displayDurationSeconds: '5' }, []).expect(401);
    await upload(media.png, { displayDurationSeconds: '5' }, jars.AGENCY).expect(403);
    await upload(media.png, { displayDurationSeconds: '5' }, jars.ADVERTISER).expect(403);
    await upload(media.png, { displayDurationSeconds: '5' }, jars.SUPPORT).expect(403);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(temps()).toEqual(before);

    // A dedicated admin so the budget of the shared suite admin is untouched.
    const admin = await db.user.findUniqueOrThrow({ where: { id: users.ADMIN } });
    const email = `${randomUUID()}@example.test`;
    await db.user.create({ data: { name: 'Booking limited admin', email, orgId: admin.orgId, role: 'ADMIN', passwordHash: admin.passwordHash } });
    const jar = cookieJar(await api('post', '/auth/login', []).send({ email, password }).expect(200));
    for (let i = 0; i < UPLOAD_LIMIT; i++) await api('post', '/creatives', jar).field('advertiserId', advertiserId).expect(400);
    const limited = await api('post', '/creatives', jar).field('advertiserId', advertiserId).attach('file', media.png).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(temps()).toEqual(before);
    await api('get', '/creatives', jar).expect(200);
  });
});
