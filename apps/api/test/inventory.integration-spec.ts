import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import request, { Response } from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { createApp, generateSwaggerDocument } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { SessionService } from '../src/modules/auth/session.service';
import { effectiveMultiplierWhere } from '../src/modules/multipliers/multipliers.service';

const origin = process.env.WEB_ORIGIN!;
const runId = randomUUID();
const password = randomBytes(24).toString('base64url');
const cookieJar = (response: Response) =>
  ((response.headers['set-cookie'] ?? []) as unknown as string[]).map(cookie => cookie.split(';')[0]);

describe('Inventory — isolated real PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let audit: AuditService;
  let sessions: SessionService;
  let passwordHash: string;
  const orgs: string[] = [];
  const venues: string[] = [];
  const campaigns: string[] = [];
  const users = {} as Record<Role, string>;
  const jars = {} as Record<Role, string[]>;
  const businessActions = ['VENUE_CREATED', 'VENUE_UPDATED', 'SCREEN_CREATED', 'SCREEN_UPDATED',
    'MULTIPLIER_DRAFT_CREATED', 'MULTIPLIER_APPROVED', 'MULTIPLIER_SUPERSEDED'];
  const api = (method: 'get' | 'post' | 'patch', path: string, jar: string[] | undefined = jars.ADMIN) => {
    const call = request(app.getHttpServer())[method](`/api/v1${path}`);
    if (jar) call.set('Cookie', jar);
    if (method !== 'get') call.set('Origin', origin);
    return call;
  };
  async function makeVenue(extra: object = {}) {
    const response = await api('post', '/venues').send({
      name: `ship-${runId}`, city: 'Istanbul', country: 'Turkey', timezone: 'Europe/Istanbul', ...extra,
    }).expect(201);
    venues.push(response.body.id);
    return response.body;
  }
  async function makeScreen(venueId?: string, extra: object = {}) {
    const venue = venueId ?? (await makeVenue()).id;
    return (await api('post', '/screens').send({
      screenId: `scr-${randomUUID()}`, name: 'Screen', venueId: venue, timezone: 'Europe/Istanbul', ...extra,
    }).expect(201)).body;
  }
  async function draft(screenId: string, extra: object = {}) {
    return (await api('post', `/screens/${screenId}/multipliers`).send({
      value: '1.2500', sourceRef: 'Operator worksheet', changeReason: 'Initial manual estimate', ...extra,
    }).expect(201)).body;
  }
  const approvalPath = (screenId: string, id: string) => `/screens/${screenId}/multipliers/${id}/approve`;
  const later = (seconds = 3600) => new Date(Date.now() + seconds * 1000).toISOString();
  async function snapshot() {
    return {
      venues: await db.venue.findMany({ where: { id: { in: venues } }, orderBy: { id: 'asc' } }),
      screens: await db.screen.findMany({ where: { venueId: { in: venues } }, orderBy: { id: 'asc' } }),
      multipliers: await db.multiplierProfile.findMany({ where: { screen: { venueId: { in: venues } } }, orderBy: { id: 'asc' } }),
      audits: await db.auditLog.findMany({ where: { userId: { in: Object.values(users) }, action: { in: businessActions } }, orderBy: { id: 'asc' } }),
      totals: { venues: await db.venue.count(), screens: await db.screen.count(), multipliers: await db.multiplierProfile.count(),
        businessAudits: await db.auditLog.count({ where: { action: { in: businessActions } } }) },
    };
  }
  function expectSafe(value: unknown) {
    expect(JSON.stringify(value)).not.toMatch(/floorCpm|floorCpp|directRate|revenueShare|ownerOrgId|tokenHash|credential|passwordHash|dealEligible|provisioning/i);
  }

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    audit = app.get(AuditService);
    sessions = app.get(SessionService);
    const [role] = await db.$queryRaw<{ rolsuper: boolean; rolcreaterole: boolean }[]>`
      SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
    if (role.rolsuper || role.rolcreaterole) throw new Error('Inventory tests require an unprivileged runtime role');
    passwordHash = await hash(password, 12);
    for (const role of Object.values(Role)) {
      const org = await db.organization.create({ data: { name: `inventory-${runId}`,
        type: role === 'SUPPORT' ? 'ADMIN' : role } });
      orgs.push(org.id);
      const user = await db.user.create({ data: {
        name: 'Inventory tester', email: `${randomUUID()}@example.test`, orgId: org.id, role, passwordHash,
      } });
      users[role] = user.id;
      jars[role] = cookieJar(await api('post', '/auth/login', []).send({ email: user.email, password }).expect(200));
    }
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (db && orgs.length) {
      // Only this run's fixtures; preserve audit history and all unrelated data.
      await db.$transaction(async tx => {
        await tx.screen.updateMany({ where: { venueId: { in: venues } }, data: { active: false } });
        await tx.venue.updateMany({ where: { id: { in: venues } }, data: { active: false } });
        await tx.campaign.updateMany({ where: { id: { in: campaigns } }, data: { deletedAt: new Date() } });
        await tx.session.updateMany({ where: { user: { orgId: { in: orgs } } }, data: { revokedAt: new Date() } });
        await tx.refreshToken.updateMany({ where: { user: { orgId: { in: orgs } } }, data: { revokedAt: new Date() } });
        await tx.user.updateMany({ where: { orgId: { in: orgs } }, data: { active: false } });
        await tx.organization.updateMany({ where: { id: { in: orgs } }, data: { active: false } });
      });
    }
    if (app) await app.close();
  });

  it('creates, reads, updates and soft-deactivates venues with audited safe metadata', async () => {
    const venue = await makeVenue({ name: '  Bosphorus Ferry  ', notes: '  Manual CMS discovery  ' });
    expect(venue).toMatchObject({ name: 'Bosphorus Ferry', notes: 'Manual CMS discovery', type: 'ferry', active: true });
    expect((await api('get', `/venues/${venue.id}`).expect(200)).body).toEqual(venue);
    await api('patch', `/venues/${venue.id}`).send({ city: 'Izmir', notes: null, active: false }).expect(200);
    const page = (await api('get', '/venues?active=false&page=1&pageSize=100').expect(200)).body;
    expect(page.items.some((item: { id: string }) => item.id === venue.id)).toBe(true);
    expectSafe(page);
    expect((await db.auditLog.findMany({ where: { entityId: venue.id }, orderBy: { timestamp: 'asc' } })).map(row => row.action))
      .toEqual(['VENUE_CREATED', 'VENUE_UPDATED']);
    await api('patch', `/venues/${venue.id}`).send({}).expect(400);
    await api('get', '/venues/not-a-uuid').expect(400);
    await api('get', `/venues/${randomUUID()}`).expect(404);
  });

  it('persists unknown equipment as null and round-trips metadata without commercial/player fields', async () => {
    const screen = await makeScreen();
    for (const key of ['resolutionWidth', 'resolutionHeight', 'orientation', 'os', 'cmsName', 'cmsVersion',
      'cmsReference', 'loopLengthSec', 'defaultSlotLengthSec', 'operatingStart', 'operatingEnd', 'notes']) expect(screen[key]).toBeNull();
    expect(screen).toMatchObject({ connectionStatus: 'NOT_CONNECTED', screenIdLocked: false });
    const stored = await db.screen.findUniqueOrThrow({ where: { id: screen.id } });
    expect(stored).toMatchObject({ playerType: 'EXTERNAL_SIGNAGE', dealEligible: false });
    await db.screen.update({ where: { id: screen.id }, data: { floorCpm: '99.5', directRate: '42.5', owner: 'private owner' } });
    await db.player.create({ data: { screenId: screen.id, tokenHash: 'private-player-credential' } });
    const metadata = { cmsName: 'Existing CMS', cmsVersion: 'v1', cmsReference: 'Manual inventory worksheet',
      os: 'Unknown OS vendor', resolutionWidth: 1920, resolutionHeight: 1080, orientation: 'LANDSCAPE',
      loopLengthSec: 120, defaultSlotLengthSec: 10, operatingStart: '22:00', operatingEnd: '06:00',
      physicalSize: '55 inch', locationLabel: 'Lower deck', notes: 'Check onboard' };
    await api('patch', `/screens/${screen.id}`).send(metadata).expect(200);
    const detail = (await api('get', `/screens/${screen.id}`).expect(200)).body;
    expect(detail).toMatchObject(metadata);
    expectSafe(detail);
    const page = (await api('get', `/screens?venueId=${screen.venueId}&active=true&pageSize=1`).expect(200)).body;
    expect(page).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(page.items[0].id).toBe(screen.id);
    expectSafe(page);
    await api('patch', `/screens/${screen.id}`).send({ cmsName: null }).expect(200);
    expect((await api('get', `/screens/${screen.id}`).expect(200)).body.cmsName).toBeNull();
  });

  it('enforces canonical identity uniqueness, including legacy spelling, and locked edits without audit residue', async () => {
    const screen = await makeScreen(undefined, { screenId: ` unique-${runId} ` });
    expect(screen.screenId).toBe(`UNIQUE-${runId.toUpperCase()}`);
    const before = await snapshot();
    await api('post', '/screens').send({ screenId: screen.screenId.toLowerCase(), name: 'Duplicate', venueId: screen.venueId, timezone: 'UTC' }).expect(409);
    expect(await snapshot()).toEqual(before);
    await db.screen.update({ where: { id: screen.id }, data: { screenIdLocked: true } });
    const locked = await snapshot();
    await api('patch', `/screens/${screen.id}`).send({ screenId: 'REPLACEMENT' }).expect(409);
    expect(await snapshot()).toEqual(locked);
    await api('patch', `/screens/${screen.id}`).send({ screenId: screen.screenId, name: 'Allowed metadata edit' }).expect(200);
    const legacy = await makeScreen();
    await db.screen.update({ where: { id: legacy.id }, data: { screenId: ` legacy-${runId} ` } });
    await api('post', '/screens').send({ screenId: `LEGACY-${runId}`, name: 'Duplicate legacy', venueId: legacy.venueId, timezone: 'UTC' }).expect(409);
  });

  it('matches JavaScript edge whitespace for legacy canonical codes without rewriting their spelling', async () => {
    const whitespaceGroups = [
      '\t\n\v\f\r ',
      '\u00a0',
      '\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff',
    ];
    for (const whitespace of whitespaceGroups) {
      const legacy = await makeScreen();
      const code = `trim-${randomUUID()}`;
      const spelling = `${whitespace}${code}${whitespace}`;
      await db.screen.update({ where: { id: legacy.id }, data: { screenId: spelling } });
      const before = await snapshot();
      await api('post', '/screens').send({
        screenId: spelling.trim().toUpperCase(), name: 'Canonical duplicate', venueId: legacy.venueId, timezone: 'UTC',
      }).expect(409);
      expect(await snapshot()).toEqual(before);
      expect((await api('get', `/screens/${legacy.id}`).expect(200)).body.screenId).toBe(spelling);
    }
  });

  it('enforces inactive parent rules, while allowing deactivation inside an inactive venue', async () => {
    const screen = await makeScreen();
    await api('patch', `/venues/${screen.venueId}`).send({ active: false }).expect(409);
    await api('patch', `/screens/${screen.id}`).send({ active: false }).expect(200);
    await api('patch', `/venues/${screen.venueId}`).send({ active: false }).expect(200);
    await api('patch', `/screens/${screen.id}`).send({ active: true }).expect(409);
    await api('patch', `/screens/${screen.id}`).send({ active: false }).expect(200);
    await api('post', '/screens').send({
      screenId: `new-${randomUUID()}`, name: 'New', venueId: screen.venueId, timezone: 'UTC', active: false,
    }).expect(409);
    const other = await makeScreen();
    await api('patch', `/screens/${other.id}`).send({ venueId: screen.venueId, active: false }).expect(409);
    await db.screen.update({ where: { id: screen.id }, data: { active: true } }); // Legacy inconsistent parent.
    await api('patch', `/screens/${screen.id}`).send({ active: false }).expect(200);
  });

  it('validates merged timing on PATCH, not just the submitted half of a pair', async () => {
    const screen = await makeScreen(undefined, { loopLengthSec: 30, defaultSlotLengthSec: 10, operatingStart: '08:00', operatingEnd: '22:00' });
    for (const data of [{ loopLengthSec: 5 }, { defaultSlotLengthSec: 31 }, { operatingStart: null },
      { operatingStart: '22:00' }, { operatingEnd: '24:00' }, { name: null }, {}]) {
      await api('patch', `/screens/${screen.id}`).send(data).expect(400);
    }
    await api('patch', `/screens/${screen.id}`).send({ name: 'Unrelated edit' }).expect(200);
    expect((await api('get', `/screens/${screen.id}`).expect(200)).body).toMatchObject({ loopLengthSec: 30, defaultSlotLengthSec: 10 });
    await api('patch', `/screens/${screen.id}`).send({ operatingStart: null, operatingEnd: null }).expect(200);
    await api('get', '/screens?active=0').expect(400);
    await api('get', '/screens?venueId=bad').expect(400);
    await api('get', '/screens?pageSize=101').expect(400);
    await api('get', `/screens/${randomUUID()}`).expect(404);
  });

  it('enforces timing on every new database insert and actual timing edit, preserving failed-write state', async () => {
    const venue = await makeVenue();
    const invalidTiming = [
      { loopLengthSec: 10, defaultSlotLengthSec: 20 },
      { operatingStart: '08:00', operatingEnd: '08:00' },
      { operatingStart: '25:00', operatingEnd: '06:00' },
      { operatingStart: '08:00', operatingEnd: null },
      { operatingStart: null, operatingEnd: '20:00' },
    ];
    for (const timing of invalidTiming) {
      await expect(db.screen.create({ data: {
        screenId: `invalid-timing-${randomUUID()}`, name: 'Invalid timing', venueId: venue.id, timezone: 'UTC', ...timing,
      } })).rejects.toThrow();
    }
    expect(await db.screen.count({ where: { venueId: venue.id } })).toBe(0);
    const screen = await makeScreen(venue.id, { loopLengthSec: 30, defaultSlotLengthSec: 10, operatingStart: '22:00', operatingEnd: '06:00' });
    const before = await db.screen.findUniqueOrThrow({ where: { id: screen.id } });
    for (const timing of invalidTiming) {
      await expect(db.screen.update({ where: { id: screen.id }, data: timing })).rejects.toThrow();
      await api('patch', `/screens/${screen.id}`).send(timing).expect(400);
    }
    expect(await db.screen.findUniqueOrThrow({ where: { id: screen.id } })).toEqual(before);
    await api('patch', `/screens/${screen.id}`).send({ operatingStart: null, operatingEnd: null }).expect(200);
    await api('patch', `/screens/${screen.id}`).send({ loopLengthSec: null, defaultSlotLengthSec: null }).expect(200);
    await api('patch', `/screens/${screen.id}`).send({ operatingStart: '22:00', operatingEnd: '06:00' }).expect(200);
  });

  it('runs installed timing trigger functions on pre-trigger legacy fixtures without disabling any trigger', async () => {
    // The runtime role cannot insert invalid timing into public.screens. A transaction-local
    // table lets us seed pre-trigger rows, then attach the actual installed functions.
    // No production-table trigger is altered; ON COMMIT DROP cleans only this fixture.
    await db.$transaction(async tx => {
      await tx.$executeRaw`
        CREATE TEMP TABLE inventory_timing_legacy (
          id INTEGER PRIMARY KEY, "loopLengthSec" INTEGER, "defaultSlotLengthSec" INTEGER,
          "operatingStart" TEXT, "operatingEnd" TEXT, active BOOLEAN DEFAULT true,
          notes TEXT, "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        ) ON COMMIT DROP`;
      await tx.$executeRaw`
        INSERT INTO inventory_timing_legacy (id, "loopLengthSec", "defaultSlotLengthSec", "operatingStart", "operatingEnd")
        VALUES (1, 10, 20, '08:00', '08:00'), (2, 10, 20, '25:00', '06:00')`;
      await tx.$executeRaw`
        CREATE TRIGGER test_legacy_slot BEFORE INSERT OR UPDATE ON inventory_timing_legacy
        FOR EACH ROW EXECUTE FUNCTION public.screens_validate_slot_within_loop()`;
      await tx.$executeRaw`
        CREATE TRIGGER test_legacy_hours BEFORE INSERT OR UPDATE ON inventory_timing_legacy
        FOR EACH ROW EXECUTE FUNCTION public.screens_validate_operating_hours()`;

      type Timing = { id: number; loopLengthSec: number | null; defaultSlotLengthSec: number | null;
        operatingStart: string | null; operatingEnd: string | null };
      const before = await tx.$queryRaw<Timing[]>`
        SELECT id, "loopLengthSec", "defaultSlotLengthSec", "operatingStart", "operatingEnd"
        FROM inventory_timing_legacy ORDER BY id`;
      await tx.$executeRaw`UPDATE inventory_timing_legacy SET active = false, notes = 'Metadata edit'`;
      // Equivalent to the multiplier timeline's no-op row lock, including explicit same timing.
      await tx.$executeRaw`
        UPDATE inventory_timing_legacy SET "updatedAt" = "updatedAt",
          "loopLengthSec" = "loopLengthSec", "defaultSlotLengthSec" = "defaultSlotLengthSec",
          "operatingStart" = "operatingStart", "operatingEnd" = "operatingEnd"`;
      expect(await tx.$queryRaw<Timing[]>`
        SELECT id, "loopLengthSec", "defaultSlotLengthSec", "operatingStart", "operatingEnd"
        FROM inventory_timing_legacy ORDER BY id`).toEqual(before);
      expect(await tx.$queryRaw`SELECT active, notes FROM inventory_timing_legacy`)
        .toEqual([{ active: false, notes: 'Metadata edit' }, { active: false, notes: 'Metadata edit' }]);

      // Correct one group at a time, leaving the other legacy-invalid group untouched.
      await tx.$executeRaw`UPDATE inventory_timing_legacy SET "loopLengthSec" = 30 WHERE id = 1`;
      await tx.$executeRaw`UPDATE inventory_timing_legacy SET "operatingStart" = '22:00' WHERE id = 2`;
      expect(await tx.$queryRaw<Timing[]>`
        SELECT id, "loopLengthSec", "defaultSlotLengthSec", "operatingStart", "operatingEnd"
        FROM inventory_timing_legacy ORDER BY id`).toEqual([
        { ...before[0], loopLengthSec: 30 }, { ...before[1], operatingStart: '22:00' },
      ]);
      for (const statement of [
        Prisma.sql`UPDATE inventory_timing_legacy SET "loopLengthSec" = 15 WHERE id = 1`,
        Prisma.sql`UPDATE inventory_timing_legacy SET "operatingEnd" = NULL WHERE id = 1`,
        Prisma.sql`UPDATE inventory_timing_legacy SET "operatingEnd" = '22:00' WHERE id = 2`,
        Prisma.sql`UPDATE inventory_timing_legacy SET "operatingEnd" = '25:00' WHERE id = 2`,
        Prisma.sql`INSERT INTO inventory_timing_legacy (id, "loopLengthSec", "defaultSlotLengthSec") VALUES (3, 1, 2)`,
        Prisma.sql`INSERT INTO inventory_timing_legacy (id, "operatingStart", "operatingEnd") VALUES (3, '08:00', '08:00')`,
      ]) {
        await tx.$executeRaw`SAVEPOINT invalid_timing_probe`;
        await expect(tx.$executeRaw(statement)).rejects.toMatchObject({ code: 'P2010', meta: { code: '23514' } });
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT invalid_timing_probe`;
        await tx.$executeRaw`RELEASE SAVEPOINT invalid_timing_probe`;
      }
      await tx.$executeRaw`UPDATE inventory_timing_legacy SET "operatingStart" = NULL, "operatingEnd" = NULL WHERE id = 1`;
      await tx.$executeRaw`UPDATE inventory_timing_legacy SET "defaultSlotLengthSec" = NULL WHERE id = 2`;
      await tx.$executeRaw`INSERT INTO inventory_timing_legacy (id) VALUES (3)`;
    });
  });

  it.each([undefined, 'AGENCY', 'ADVERTISER', 'SUPPORT'] as const)(
    'denies every route to %s with persisted-before/after equality', async role => {
      const screen = await makeScreen();
      const profile = await draft(screen.id);
      const routes: ['get' | 'post' | 'patch', string, object?][] = [
        ['get', '/venues'], ['get', `/venues/${screen.venueId}`],
        ['post', '/venues', { name: 'Blocked', country: 'Turkey', city: 'Istanbul', timezone: 'UTC' }],
        ['patch', `/venues/${screen.venueId}`, { name: 'Blocked' }],
        ['get', '/screens'], ['get', `/screens/${screen.id}`],
        ['post', '/screens', { screenId: `blocked-${randomUUID()}`, venueId: screen.venueId, name: 'Blocked', timezone: 'UTC' }],
        ['patch', `/screens/${screen.id}`, { active: false }],
        ['get', `/screens/${screen.id}/multipliers`],
        ['post', `/screens/${screen.id}/multipliers`, { value: '2', sourceRef: 'Blocked', changeReason: 'Blocked' }],
        ['post', approvalPath(screen.id, profile.id), {}],
      ];
      const before = await snapshot();
      for (const [method, path, body] of routes) {
        const response = await api(method, path, role ? jars[role] : []).send(body).expect(role ? 403 : 401);
        expect(Object.keys(response.body)).toEqual(['error']);
      }
      expect(await snapshot()).toEqual(before);
    });

  it('revalidates session authorization inside the business transaction after guard success', async () => {
    const screen = await makeScreen();
    const user = await db.user.findUniqueOrThrow({ where: { id: users.ADMIN } });
    const jar = cookieJar(await api('post', '/auth/login', []).send({ email: user.email, password }).expect(200));
    const before = await snapshot();
    const original = sessions.requireAdmin.bind(sessions);
    const spy = jest.spyOn(sessions, 'requireAdmin').mockImplementationOnce(async (tx, actor) => {
      await db.session.update({ where: { id: actor.sessionId }, data: { revokedAt: new Date() } });
      return original(tx, actor);
    });
    try {
      await api('patch', `/screens/${screen.id}`, jar).send({ name: 'must not persist' }).expect(401);
      expect(await snapshot()).toEqual(before);
    } finally { spy.mockRestore(); }
  });

  it('requires trusted Origin on every inventory mutation', async () => {
    const screen = await makeScreen();
    const profile = await draft(screen.id);
    for (const [method, path] of [
      ['post', '/venues'], ['patch', `/venues/${screen.venueId}`], ['post', '/screens'], ['patch', `/screens/${screen.id}`],
      ['post', `/screens/${screen.id}/multipliers`], ['post', approvalPath(screen.id, profile.id)],
    ] as const) {
      await request(app.getHttpServer())[method](`/api/v1${path}`).set('Cookie', jars.ADMIN).send({}).expect(403);
    }
  });

  it('separates current-by-time from latest-created and paginates history independently', async () => {
    const screen = await makeScreen();
    const empty = (await api('get', `/screens/${screen.id}/multipliers`).expect(200)).body;
    expect(empty).toMatchObject({ items: [], total: 0, current: null, latest: null });
    const first = await draft(screen.id);
    expect(first).toMatchObject({ version: 1, value: '1.2500', sourceType: 'MANUAL', approvalStatus: 'DRAFT', validFrom: null,
      createdBy: users.ADMIN, approvedAt: null, approvedBy: null });
    const approved = (await api('post', approvalPath(screen.id, first.id)).send({}).expect(200)).body;
    expect(approved).toMatchObject({ approvalStatus: 'APPROVED', approvedBy: users.ADMIN });
    const second = await draft(screen.id, { value: '2' });
    const third = await draft(screen.id, { value: '3' });
    const page = (await api('get', `/screens/${screen.id}/multipliers?page=2&pageSize=1`).expect(200)).body;
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 1, current: { id: first.id }, latest: { id: third.id } });
    expect(page.items[0].id).toBe(second.id);
    const event = await db.auditLog.findFirstOrThrow({ where: { entityId: first.id, action: 'MULTIPLIER_APPROVED' } });
    expect(event.after).toMatchObject({ value: '1.2500', sourceType: 'MANUAL' });
    expectSafe(page);
  });

  it('atomically supersedes an explicit open profile without rewriting historical values or calculation references', async () => {
    const screen = await makeScreen();
    const first = await draft(screen.id);
    await api('post', approvalPath(screen.id, first.id)).send({}).expect(200);
    const before = await db.multiplierProfile.findUniqueOrThrow({ where: { id: first.id } });
    // A real historical calculation retains its profile FK and original amount.
    const advertiser = await db.user.findUniqueOrThrow({ where: { id: users.ADVERTISER } });
    const campaign = await db.campaign.create({ data: { code: `history-${randomUUID()}`, name: 'Historical fixture',
      advertiserId: advertiser.orgId, internalOwnerId: users.ADMIN, startAt: new Date(Date.now() - 86400000),
      endAt: new Date(Date.now() + 86400000) } });
    campaigns.push(campaign.id);
    const pop = await db.proofOfPlay.create({ data: { eventId: randomUUID(), campaignId: campaign.id,
      screenId: screen.id, creativeId: randomUUID(), playedAt: new Date(), durationSeconds: '10', result: 'success' } });
    const calculation = await db.impressionEvent.create({ data: {
      popId: pop.id, multiplierProfileId: first.id, estimatedImpressions: '1.2500',
    } });
    const next = await draft(screen.id, { value: '2.125', sourceRef: 'Revised worksheet', changeReason: 'New estimate' });
    const boundary = later();
    await api('post', approvalPath(screen.id, next.id)).send({ validFrom: boundary, supersedesId: first.id }).expect(200);
    const after = await db.multiplierProfile.findUniqueOrThrow({ where: { id: first.id } });
    expect({ ...after, validTo: null }).toEqual(before);
    expect(after.validTo?.toISOString()).toBe(boundary);
    expect(await db.impressionEvent.findUniqueOrThrow({ where: { id: calculation.id } })).toEqual(calculation);
    const history = (await api('get', `/screens/${screen.id}/multipliers`).expect(200)).body;
    expect(history.current.id).toBe(first.id);
    expect(history.latest.id).toBe(next.id);
    for (const [instant, expected] of [
      [new Date(new Date(boundary).getTime() - 1), first.id], [new Date(boundary), next.id],
    ] as const) {
      const current = await db.multiplierProfile.findMany({ where: effectiveMultiplierWhere(screen.id, instant) });
      expect(current.map(row => row.id)).toEqual([expected]);
    }
    expect(await db.auditLog.count({ where: { entityId: first.id, action: 'MULTIPLIER_SUPERSEDED' } })).toBe(1);
    await api('post', approvalPath(screen.id, first.id)).send({}).expect(409);
    await request(app.getHttpServer()).patch(`/api/v1/screens/${screen.id}/multipliers/${first.id}`)
      .set('Cookie', jars.ADMIN).set('Origin', origin).send({ value: '999' }).expect(404);
    await request(app.getHttpServer()).delete(`/api/v1/screens/${screen.id}/multipliers/${first.id}`)
      .set('Cookie', jars.ADMIN).set('Origin', origin).expect(404);
  });

  it('rejects overlaps, backdating, stale/wrong-screen predecessors and invalid end times without partial audit', async () => {
    const screen = await makeScreen();
    const first = await draft(screen.id);
    await api('post', approvalPath(screen.id, first.id)).send({}).expect(200);
    const second = await draft(screen.id);
    const foreign = await draft((await makeScreen()).id);
    const before = await snapshot();
    for (const [body, status] of [
      [{}, 409], [{ validFrom: '2000-01-01T00:00:00Z', supersedesId: first.id }, 409],
      [{ validFrom: later(), supersedesId: randomUUID() }, 409],
      [{ validFrom: later(), supersedesId: foreign.id }, 409],
      [{ validFrom: later(), supersedesId: second.id }, 409],
      [{ validFrom: later(), validTo: later(-100), supersedesId: first.id }, 400],
    ] as [object, number][]) {
      await api('post', approvalPath(screen.id, second.id)).send(body).expect(status);
    }
    expect(await snapshot()).toEqual(before);
    await api('post', approvalPath(screen.id, second.id)).send({ validFrom: later(), supersedesId: first.id }).expect(200);
    const third = await draft(screen.id);
    await api('post', approvalPath(screen.id, third.id)).send({ validFrom: later(7200), supersedesId: first.id }).expect(409);
    await api('post', approvalPath(screen.id, foreign.id)).send({}).expect(404);
  });

  it('uses half-open finite intervals, accepts adjacency, and does not call a future approval current', async () => {
    const screen = await makeScreen();
    const first = await draft(screen.id);
    const start = later();
    const end = later(7200);
    await api('post', approvalPath(screen.id, first.id)).send({ validFrom: start, validTo: end }).expect(200);
    const second = await draft(screen.id);
    await api('post', approvalPath(screen.id, second.id)).send({ validFrom: end }).expect(200);
    expect((await api('get', `/screens/${screen.id}/multipliers`).expect(200)).body.current).toBeNull();
    expect(await db.multiplierProfile.count({ where: effectiveMultiplierWhere(screen.id, new Date(start)) })).toBe(1);
    expect((await db.multiplierProfile.findFirstOrThrow({ where: effectiveMultiplierWhere(screen.id, new Date(end)) })).id).toBe(second.id);
  });

  it('defines latest by creation time even for legacy versions imported out of order', async () => {
    const screen = await makeScreen();
    const common = { screenId: screen.id, value: '1', sourceType: 'MANUAL_VERIFIED' as const,
      sourceRef: 'Historical import', validFrom: new Date('2020-01-01T00:00:00Z'), weekdays: [], createdBy: users.ADMIN };
    const newest = await db.multiplierProfile.create({ data: {
      ...common, version: 1, createdAt: new Date('2022-01-01T00:00:00Z'),
    } });
    await db.multiplierProfile.create({ data: { ...common, version: 2, createdAt: new Date('2021-01-01T00:00:00Z') } });
    const history = (await api('get', `/screens/${screen.id}/multipliers`).expect(200)).body;
    expect(history.latest.id).toBe(newest.id);
    expect(history.current).toBeNull();
  });

  it('rejects overlaps against legacy dayparts and preserves MANUAL_VERIFIED labels', async () => {
    const screen = await makeScreen();
    const legacy = await db.multiplierProfile.create({ data: { screenId: screen.id, value: '8', sourceType: 'MANUAL_VERIFIED',
      sourceRef: 'Historical source', validFrom: new Date(Date.now() - 1000), daypartStart: '08:00', daypartEnd: '12:00',
      weekdays: [1], specificityKey: '08:00-12:00:1', approvalStatus: 'APPROVED', version: 1, createdBy: users.ADMIN,
      approvedBy: users.ADMIN, approvedAt: new Date() } });
    const profile = await draft(screen.id);
    await api('post', approvalPath(screen.id, profile.id)).send({}).expect(409);
    await api('post', approvalPath(screen.id, profile.id)).send({ supersedesId: legacy.id }).expect(409);
    const history = (await api('get', `/screens/${screen.id}/multipliers`).expect(200)).body;
    expect(history.items.find((item: { id: string }) => item.id === legacy.id).sourceType).toBe('MANUAL_VERIFIED');
    expect(history.current).toBeNull(); // A daypart must not masquerade as a whole-screen assumption.
    expect((await db.multiplierProfile.findUniqueOrThrow({ where: { id: legacy.id } })).value.toString()).toBe('8');
  });

  it('rejects nonmanual/daypart/actor input and malformed values before persistence', async () => {
    const screen = await makeScreen();
    const before = await snapshot();
    for (const body of [
      { value: '0' }, { value: '1e2' }, { value: '1.12345' }, { value: '100000000' }, { sourceRef: ' ' },
      { changeReason: null }, { sourceType: 'MANUAL' }, { daypartStart: '08:00' }, { weekdays: [1] },
      { createdBy: users.SUPPORT }, { version: 999 },
    ]) await api('post', `/screens/${screen.id}/multipliers`).send({ value: '1', sourceRef: 'ref', changeReason: 'reason', ...body }).expect(400);
    expect(await snapshot()).toEqual(before);
    await api('get', `/screens/${randomUUID()}/multipliers`).expect(404);
    await api('get', `/screens/${screen.id}/multipliers?page=0`).expect(400);
  });

  it('allocates unique versions for concurrent drafts with no failed-attempt audits', async () => {
    const screen = await makeScreen();
    const results = await Promise.all([1, 2, 3].map(value =>
      api('post', `/screens/${screen.id}/multipliers`).send({ value: String(value), sourceRef: 'Concurrent', changeReason: 'Race' })));
    expect(results.map(row => row.status)).toEqual([201, 201, 201]);
    expect(results.map(row => row.body.version).sort()).toEqual([1, 2, 3]);
    const ids = results.map(row => row.body.id);
    expect(await db.auditLog.count({ where: { entityId: { in: ids }, action: 'MULTIPLIER_DRAFT_CREATED' } })).toBe(3);
  });

  it('allows only one racing screen creation for a canonical physical code', async () => {
    const venue = await makeVenue();
    const code = `race-${randomUUID()}`;
    const results = await Promise.all([code, ` ${code.toUpperCase()} `].map(screenId =>
      api('post', '/screens').send({ screenId, venueId: venue.id, name: 'Racing screen', timezone: 'UTC' })));
    expect(results.map(row => row.status).sort()).toEqual([201, 409]);
    const winner = results.find(row => row.status === 201)!.body;
    expect(await db.screen.count({ where: { venueId: venue.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: winner.id, action: 'SCREEN_CREATED' } })).toBe(1);
  });

  it('serializes simultaneous first approvals and duplicate approvals', async () => {
    const screen = await makeScreen();
    const a = await draft(screen.id);
    const b = await draft(screen.id);
    const results = await Promise.all([a, b].map(row => api('post', approvalPath(screen.id, row.id)).send({})));
    expect(results.map(row => row.status).sort()).toEqual([200, 409]);
    const winner = results.find(row => row.status === 200)!.body;
    const duplicate = await Promise.all([1, 2].map(() => api('post', approvalPath(screen.id, winner.id)).send({})));
    expect(duplicate.map(row => row.status)).toEqual([409, 409]);
    expect(await db.multiplierProfile.count({ where: { screenId: screen.id, approvalStatus: 'APPROVED' } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: winner.id, action: 'MULTIPLIER_APPROVED' } })).toBe(1);
  });

  it('lets only one racing replacement close the explicit predecessor', async () => {
    const screen = await makeScreen();
    const first = await draft(screen.id);
    await api('post', approvalPath(screen.id, first.id)).send({}).expect(200);
    const a = await draft(screen.id);
    const b = await draft(screen.id);
    const start = later();
    const results = await Promise.all([a, b].map(row =>
      api('post', approvalPath(screen.id, row.id)).send({ validFrom: start, supersedesId: first.id })));
    expect(results.map(row => row.status).sort()).toEqual([200, 409]);
    expect(await db.multiplierProfile.count({ where: effectiveMultiplierWhere(screen.id, new Date(start)) })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: first.id, action: 'MULTIPLIER_SUPERSEDED' } })).toBe(1);
    expect(await db.multiplierProfile.count({ where: { screenId: screen.id, approvalStatus: 'DRAFT' } })).toBe(1);
  });

  it('serializes venue deactivation against screen activation without an active child under an inactive venue', async () => {
    const screen = await makeScreen(undefined, { active: false });
    const results = await Promise.all([
      api('patch', `/venues/${screen.venueId}`).send({ active: false }),
      api('patch', `/screens/${screen.id}`).send({ active: true }),
    ]);
    expect(results.map(row => row.status).sort()).toEqual([200, 409]);
    const row = await db.screen.findUniqueOrThrow({ where: { id: screen.id }, include: { venue: true } });
    expect(row.active && !row.venue.active).toBe(false);
  });

  it('rolls back venue/screen/draft writes and predecessor closure when audit insertion fails', async () => {
    const screen = await makeScreen();
    const first = await draft(screen.id);
    await api('post', approvalPath(screen.id, first.id)).send({}).expect(200);
    const next = await draft(screen.id);
    const before = await snapshot();
    const original = audit.append.bind(audit);
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const spy = jest.spyOn(audit, 'append').mockRejectedValue(new Error('Injected audit failure'));
    try {
      await api('patch', `/venues/${screen.venueId}`).send({ name: 'Rollback' }).expect(500);
      await api('patch', `/screens/${screen.id}`).send({ name: 'Rollback' }).expect(500);
      await api('post', `/screens/${screen.id}/multipliers`).send({ value: '2', sourceRef: 'ref', changeReason: 'reason' }).expect(500);
      const code = `rollback-${randomUUID()}`.toUpperCase();
      await api('post', '/screens').send({ screenId: code, venueId: screen.venueId, name: 'Rollback', timezone: 'UTC' }).expect(500);
      expect(await db.screen.count({ where: { screenId: code } })).toBe(0);
      const name = `rollback-${randomUUID()}`;
      await api('post', '/venues').send({ name, city: 'Istanbul', country: 'Turkey', timezone: 'UTC' }).expect(500);
      expect(await db.venue.count({ where: { name } })).toBe(0);
      // Allow predecessor audit, then fail the second audit: both writes and that first audit must roll back.
      spy.mockImplementation((tx, entry) => {
        if (entry.action === 'MULTIPLIER_APPROVED') throw new Error('Injected approval audit failure');
        return original(tx, entry);
      });
      await api('post', approvalPath(screen.id, next.id)).send({ validFrom: later(), supersedesId: first.id }).expect(500);
      expect(await snapshot()).toEqual(before);
    } finally { spy.mockRestore(); log.mockRestore(); }
  });

  it('keeps deleted screens inaccessible, including their multiplier history', async () => {
    const screen = await makeScreen();
    const profile = await draft(screen.id);
    await db.screen.update({ where: { id: screen.id }, data: { active: false, deletedAt: new Date() } });
    await api('get', `/screens/${screen.id}`).expect(404);
    await api('patch', `/screens/${screen.id}`).send({ active: true }).expect(404);
    await api('get', `/screens/${screen.id}/multipliers`).expect(404);
    await api('post', approvalPath(screen.id, profile.id)).send({}).expect(404);
    const page = (await api('get', `/screens?venueId=${screen.venueId}`).expect(200)).body;
    expect(page.total).toBe(0);
  });

  it('applies nullable schema/default changes while retaining constraints and legacy source enum', async () => {
    const columns = await db.$queryRaw<{ column_name: string; is_nullable: string; column_default: string | null }[]>`
      SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'screens'`;
    for (const name of ['resolutionWidth', 'resolutionHeight', 'orientation', 'loopLengthSec', 'defaultSlotLengthSec',
      'operatingStart', 'operatingEnd', 'cmsName', 'cmsVersion', 'cmsReference', 'notes']) {
      expect(columns.find(row => row.column_name === name)).toMatchObject({ is_nullable: 'YES', column_default: null });
    }
    const constraints = await db.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE conrelid IN ('screens'::regclass, 'multiplier_profiles'::regclass)`;
    expect(constraints.map(row => row.conname)).toEqual(expect.arrayContaining([
      'screens_dimensions_positive',
      'multiplier_value_positive', 'multiplier_validity_valid', 'multiplier_no_approved_overlap', 'multiplier_manual_whole_screen',
    ]));
    expect(constraints.map(row => row.conname)).not.toEqual(expect.arrayContaining(['screens_slot_within_loop']));
    expect(constraints.map(row => row.conname)).not.toEqual(expect.arrayContaining(['screens_operating_hours_valid']));
    const triggers = await db.$queryRaw<{ tgname: string; tgenabled: string; tgtype: number; proname: string }[]>`
      SELECT t.tgname, t.tgenabled, t.tgtype::integer, p.proname
      FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = 'screens'::regclass AND NOT t.tgisinternal`;
    expect(triggers).toEqual(expect.arrayContaining([
      { tgname: 'screens_slot_within_loop_on_edit', tgenabled: 'O', tgtype: 23, proname: 'screens_validate_slot_within_loop' },
      { tgname: 'screens_operating_hours_valid_on_edit', tgenabled: 'O', tgtype: 23, proname: 'screens_validate_operating_hours' },
    ]));
    const values = await db.$queryRaw<{ enumlabel: string }[]>`
      SELECT enumlabel FROM pg_enum WHERE enumtypid = '"MultiplierSourceType"'::regtype`;
    expect(values.map(row => row.enumlabel)).toEqual(expect.arrayContaining(['MANUAL', 'MANUAL_VERIFIED']));
    const screen = await makeScreen();
    await expect(db.screen.update({ where: { id: screen.id }, data: { resolutionWidth: 0 } })).rejects.toThrow();
    await expect(db.screen.update({ where: { id: screen.id }, data: { loopLengthSec: 5, defaultSlotLengthSec: 6 } })).rejects.toThrow();
  });

  it('publishes typed allowlisted OpenAPI response schemas for every inventory operation', () => {
    const document = generateSwaggerDocument(app);
    for (const [path, method, status, schema] of [
      ['/venues', 'get', '200', 'VenuePageDto'], ['/venues', 'post', '201', 'VenueResponseDto'],
      ['/venues/{id}', 'get', '200', 'VenueResponseDto'], ['/venues/{id}', 'patch', '200', 'VenueResponseDto'],
      ['/screens', 'get', '200', 'ScreenPageDto'], ['/screens', 'post', '201', 'ScreenResponseDto'],
      ['/screens/{id}', 'get', '200', 'ScreenResponseDto'], ['/screens/{id}', 'patch', '200', 'ScreenResponseDto'],
      ['/screens/{screenId}/multipliers', 'get', '200', 'MultiplierHistoryDto'],
      ['/screens/{screenId}/multipliers', 'post', '201', 'MultiplierResponseDto'],
      ['/screens/{screenId}/multipliers/{id}/approve', 'post', '200', 'MultiplierResponseDto'],
    ] as const) {
      expect(document.paths[`/api/v1${path}`]?.[method]?.responses?.[status]).toMatchObject({
        content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
      });
    }
    for (const key of ['VenueResponseDto', 'ScreenResponseDto', 'MultiplierResponseDto']) expectSafe(document.components?.schemas?.[key]);
  });
});
