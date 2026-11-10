import 'reflect-metadata';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { hash, compare } from 'bcryptjs';
import request, { Response as TestResponse } from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { OrganizationType, Prisma, Role } from '@prisma/client';
import { createApp, generateSwaggerDocument } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { hashToken, ACCESS_COOKIE, REFRESH_COOKIE } from '../src/modules/auth/tokens';
import { RuntimeConfig } from '../src/common/runtime-config';

// Only SMTP is mocked; all repositories, guards, JWTs, bcrypt and transactions are real.
const deliveries = new Map<string, string>();
const mockSendMail = jest.fn(async (message: { to: string; text: string }) => {
  deliveries.set(message.to, message.text);
  return { accepted: [message.to], rejected: [], messageId: 'test-delivery' };
});
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: mockSendMail })) }));

const origin = process.env.WEB_ORIGIN!;
const runId = randomUUID();
const password = randomBytes(24).toString('base64url');
type FixtureUser = { id: string; email: string; orgId: string; role: Role };
type CookieJar = string[];
const cookies = (response: TestResponse): CookieJar =>
  ((response.headers['set-cookie'] ?? []) as unknown as string[]).map(cookie => cookie.split(';')[0]);
const rawCookie = (jar: CookieJar, name: string) => decodeURIComponent(jar.find(value => value.startsWith(`${name}=`))!.slice(name.length + 1));

describe('Phase 0 foundation — dedicated real PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let audit: AuditService;
  let passwordHash: string;
  const orgs: Partial<Record<'admin' | 'agencyA' | 'agencyB' | 'advertiser', string>> = {};
  const ownedOrgs: string[] = [];
  const users = {} as Record<'admin' | 'agencyA' | 'agencyB' | 'advertiser' | 'support', FixtureUser>;
  const jars = {} as Record<keyof typeof users, CookieJar>;
  const prefix = '/api/v1';

  async function makeOrg(type: OrganizationType) {
    const org = await db.organization.create({ data: { name: `integration-${runId}`, type } });
    ownedOrgs.push(org.id);
    return org.id;
  }
  async function makeUser(role: Role, extra: Partial<Prisma.UserUncheckedCreateInput> = {}): Promise<FixtureUser> {
    const orgId = role === Role.AGENCY ? orgs.agencyA! :
      role === Role.ADVERTISER ? orgs.advertiser! : orgs.admin!;
    return db.user.create({ data: {
      name: 'Integration User', email: `${randomUUID()}@example.test`, role, orgId, passwordHash, ...extra,
    } });
  }
  function post(path: string, jar?: CookieJar) {
    const test = request(app.getHttpServer()).post(`${prefix}${path}`).set('Origin', origin);
    return jar ? test.set('Cookie', jar) : test;
  }
  function get(path: string, jar?: CookieJar) {
    const test = request(app.getHttpServer()).get(`${prefix}${path}`);
    return jar ? test.set('Cookie', jar) : test;
  }
  function patch(path: string, jar: CookieJar) {
    return request(app.getHttpServer()).patch(`${prefix}${path}`).set('Origin', origin).set('Cookie', jar);
  }
  async function login(user: FixtureUser) {
    return post('/auth/login').send({ email: user.email, password }).expect(200);
  }
  async function invite() {
    const email = `${randomUUID()}@example.test`;
    const response = await post('/users/invite', jars.admin).send({
      name: 'Invited User', email: ` ${email.toUpperCase()} `, orgId: orgs.agencyA, role: Role.AGENCY,
    }).expect(201);
    const text = deliveries.get(email);
    if (!text) throw new Error('Test transport did not capture invitation');
    const url = new URL(text.split('\n').find(line => line.startsWith(origin))!);
    const token = new URLSearchParams(url.hash.slice(1)).get('token')!;
    if (!token) throw new Error('Invitation fragment missing');
    return { email, token, response };
  }
  function expectSafe(value: unknown) {
    const json = JSON.stringify(value);
    expect(/passwordHash|mfaSecret|ssoId|tokenHash|accessToken|refreshToken/i.test(json)).toBe(false);
    expect(json.includes(password)).toBe(false);
    expect(json.includes(passwordHash)).toBe(false);
  }

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    audit = app.get(AuditService);
    const roles = await db.$queryRaw<{ rolsuper: boolean; rolcreaterole: boolean }[]>`
      SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
    if (roles[0].rolsuper || roles[0].rolcreaterole) throw new Error('Integration runtime role must not be privileged');
    passwordHash = await hash(password, 12);
    orgs.admin = await makeOrg(OrganizationType.ADMIN);
    orgs.agencyA = await makeOrg(OrganizationType.AGENCY);
    orgs.agencyB = await makeOrg(OrganizationType.AGENCY);
    orgs.advertiser = await makeOrg(OrganizationType.ADVERTISER);
    users.admin = await makeUser(Role.ADMIN);
    users.agencyA = await makeUser(Role.AGENCY);
    users.agencyB = await makeUser(Role.AGENCY, { orgId: orgs.agencyB });
    users.advertiser = await makeUser(Role.ADVERTISER);
    users.support = await makeUser(Role.SUPPORT);
    for (const key of Object.keys(users) as (keyof typeof users)[]) jars[key] = cookies(await login(users[key]));
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    // Only deactivate this run's random fixtures; retain append-only audit history/FKs.
    // No database reset, DELETE of unrelated rows, TRUNCATE cleanup or disabled triggers.
    if (db && ownedOrgs.length) {
      await db.$transaction(async tx => {
        await tx.refreshToken.updateMany({ where: { user: { orgId: { in: ownedOrgs } } }, data: { revokedAt: new Date() } });
        await tx.session.updateMany({ where: { user: { orgId: { in: ownedOrgs } } }, data: { revokedAt: new Date() } });
        await tx.invitation.updateMany({ where: { user: { orgId: { in: ownedOrgs } } }, data: { revokedAt: new Date() } });
        await tx.user.updateMany({ where: { orgId: { in: ownedOrgs } }, data: { active: false } });
        await tx.organization.updateMany({ where: { id: { in: ownedOrgs } }, data: { active: false } });
      });
    }
    if (app) await app.close();
    deliveries.clear();
  });

  it('exposes public health and generates OpenAPI without opening a listener on import', async () => {
    await get('/health').expect(200).expect(({ body }) => expect(body.database).toBe('up'));
    const document = generateSwaggerDocument(app);
    expect(document.paths['/api/v1/auth/login']).toBeDefined();
    expect(document.paths['/api/v1/users/invite']).toBeDefined();
    expect(document.components?.securitySchemes?.protarget_access).toMatchObject({ in: 'cookie' });
  });

  it('sets both HttpOnly Path=/ cookies and returns the exact safe user shape', async () => {
    const response = await login(users.admin);
    expect(Object.keys(response.body)).toEqual(['user']);
    expect(Object.keys(response.body.user).sort()).toEqual(['email', 'id', 'name', 'orgId', 'organization', 'role']);
    for (const cookie of response.headers['set-cookie'] as unknown as string[]) {
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('SameSite=Strict');
    }
    expectSafe(response.body);
    const me = await get('/me', cookies(response)).expect(200);
    expect(me.body).toEqual(response.body.user);
    expect(me.body.user).toBeUndefined();
    const session = await db.session.findUnique({ where: { accessTokenHash: hashToken(rawCookie(cookies(response), ACCESS_COOKIE)) } });
    expect(session).not.toBeNull();
    expect(await db.refreshToken.count({ where: { tokenHash: hashToken(rawCookie(cookies(response), REFRESH_COOKIE)) } })).toBe(1);
  });

  it('normalizes login email', async () => {
    await post('/auth/login').send({ email: ` ${users.agencyA.email.toUpperCase()} `, password }).expect(200);
  });

  it('returns the same generic login error for unknown, incorrect, inactive and MFA-enabled users', async () => {
    const inactive = await makeUser(Role.AGENCY, { active: false });
    const mfa = await makeUser(Role.ADMIN, { mfaEnabled: true, mfaSecret: 'test-only-mfa-secret' });
    const disabledOrg = await makeOrg(OrganizationType.AGENCY);
    await db.organization.update({ where: { id: disabledOrg }, data: { active: false } });
    const orgUser = await makeUser(Role.AGENCY, { orgId: disabledOrg });
    const inputs = [
      { email: `${randomUUID()}@example.test`, password },
      { email: users.agencyA.email, password: randomBytes(20).toString('hex') },
      { email: inactive.email, password }, { email: mfa.email, password }, { email: orgUser.email, password },
    ];
    const responses = [];
    for (const input of inputs) responses.push(await post('/auth/login').send(input).expect(401));
    for (const response of responses) {
      expect(response.body).toEqual(responses[0].body);
      expect(response.body.error.message).toBe('Invalid email or password');
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('rejects forged and duplicated access credentials and enforces default authentication', async () => {
    await get('/me').expect(401);
    await get('/me', [`${ACCESS_COOKIE}=invalid`]).expect(401);
    await get('/me', [jars.admin[0], jars.admin[0]]).expect(401);
    await get('/organizations').expect(401);
    await get('/users').expect(401);
    await get('/audit-logs').expect(401);
    await request(app.getHttpServer()).post(`${prefix}/organizations`).set('Origin', origin)
      .send({ name: 'Unauthorized', type: 'AGENCY' }).expect(401);
  });

  it.each(['/auth/login', '/auth/refresh', '/auth/logout', '/auth/accept-invite'])(
    'requires trusted Origin on public mutation %s', async path => {
      for (const badOrigin of [undefined, 'null', 'https://evil.example', `${origin}.evil.example`]) {
        const test = request(app.getHttpServer()).post(`${prefix}${path}`);
        if (badOrigin) test.set('Origin', badOrigin);
        await test.send({}).expect(403);
      }
    });

  it('requires trusted Origin on every business mutation, even with valid cookies', async () => {
    const operations = [
      () => request(app.getHttpServer()).post(`${prefix}/organizations`),
      () => request(app.getHttpServer()).patch(`${prefix}/organizations/${orgs.agencyA}`),
      () => request(app.getHttpServer()).patch(`${prefix}/users/${users.agencyA.id}`),
      () => request(app.getHttpServer()).post(`${prefix}/users/invite`),
    ];
    for (const operation of operations) {
      await operation().set('Cookie', jars.admin).send({}).expect(403);
      await operation().set('Cookie', jars.admin).set('Origin', 'https://evil.example').send({}).expect(403);
    }
  });

  it('rotates once, invalidates old access, and commits replay revocation of the full family', async () => {
    const user = await makeUser(Role.AGENCY);
    const original = cookies(await login(user));
    const rotated = cookies(await post('/auth/refresh', original).expect(200));
    expect(rawCookie(original, REFRESH_COOKIE) === rawCookie(rotated, REFRESH_COOKIE)).toBe(false);
    await get('/me', original).expect(401);
    await get('/me', rotated).expect(200);
    await post('/auth/refresh', original).expect(401);
    await get('/me', rotated).expect(401);
    await post('/auth/refresh', rotated).expect(401);
    // Replay remains identifiable after it has already revoked the family.
    await post('/auth/refresh', original).expect(401);
    const tokens = await db.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(2);
    expect(tokens.every(token => token.revokedAt !== null)).toBe(true);
    expect(tokens.some(token => token.usedAt !== null)).toBe(true);
    expect(await db.auditLog.count({ where: { userId: user.id, action: 'AUTH_REFRESH_REPLAY' } })).toBe(2);
  });

  it('serializes concurrent refreshes and revokes the winning child on replay', async () => {
    const user = await makeUser(Role.AGENCY);
    const original = cookies(await login(user));
    const responses = await Promise.all([post('/auth/refresh', original), post('/auth/refresh', original)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 401]);
    const winner = responses.find(response => response.status === 200)!;
    await get('/me', cookies(winner)).expect(401);
    expect(await db.refreshToken.count({ where: { userId: user.id } })).toBe(2);
  });

  it('rejects expired refresh tokens and revokes remaining access', async () => {
    const user = await makeUser(Role.AGENCY);
    const jar = cookies(await login(user));
    await db.refreshToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
    await post('/auth/refresh', jar).expect(401);
    await get('/me', jar).expect(401);
  });

  it.each(['agencyA', 'advertiser', 'support'] as const)(
    '%s can refresh/logout but cannot perform any business write', async key => {
      const user = await makeUser(users[key].role);
      const jar = cookies(await login(user));
      const rotated = cookies(await post('/auth/refresh', jar).expect(200));
      await post('/organizations', rotated).send({ name: 'Blocked', type: 'AGENCY' }).expect(403);
      await patch(`/organizations/${orgs.agencyA}`, rotated).send({ name: 'Blocked' }).expect(403);
      await patch(`/users/${users.agencyA.id}`, rotated).send({ name: 'Blocked' }).expect(403);
      await post('/users/invite', rotated).send({
        email: `${randomUUID()}@example.test`, name: 'Blocked', role: 'AGENCY', orgId: orgs.agencyA,
      }).expect(403);
      await get('/users', rotated).expect(403);
      await get('/audit-logs', rotated).expect(403);
      await post('/auth/logout', rotated).expect(200, { ok: true });
      await get('/me', rotated).expect(401);
      await post('/auth/refresh', rotated).expect(401);
      await post('/auth/logout', rotated).expect(200, { ok: true });
    });

  it('logout with access alone revokes refresh; logout with no credentials is safe', async () => {
    const user = await makeUser(Role.AGENCY);
    const jar = cookies(await login(user));
    const response = await post('/auth/logout', jar.filter(item => item.startsWith(`${ACCESS_COOKIE}=`))).expect(200);
    expect((response.headers['set-cookie'] as unknown as string[]).every(item => item.includes('Expires=Thu, 01 Jan 1970'))).toBe(true);
    await post('/auth/refresh', jar).expect(401);
    await post('/auth/logout').expect(200, { ok: true });
    await get('/me', jars.admin).expect(200);
  });

  it('scopes agency and advertiser organization lists and detail queries', async () => {
    for (const key of ['agencyA', 'agencyB', 'advertiser'] as const) {
      const list = await get('/organizations?page=1&pageSize=5', jars[key]).expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([users[key].orgId]);
      const own = await get(`/portal/organizations/${users[key].orgId}`, jars[key]).expect(200);
      expect(Object.keys(own.body).sort()).toEqual(['active', 'brandName', 'id', 'name', 'type']);
      await get(`/organizations/${users[key].orgId}`, jars[key]).expect(200);
      await get(`/portal/organizations/${orgs.admin}`, jars[key]).expect(403);
      await get(`/organizations/${orgs.admin}`, jars[key]).expect(403);
      expect(await db.auditLog.count({
        where: { userId: users[key].id, action: 'UNAUTHORIZED_PORTAL_ACCESS', entityId: orgs.admin },
      })).toBe(2);
    }
    await get(`/portal/organizations/${orgs.agencyB}`, jars.agencyA).expect(403);
  });

  it('support has only /me and health among reads', async () => {
    await get('/me', jars.support).expect(200);
    await get('/health', jars.support).expect(200);
    for (const path of ['/organizations', `/organizations/${orgs.admin}`, `/portal/organizations/${orgs.admin}`, '/users', '/audit-logs']) {
      await get(path, jars.support).expect(403);
    }
  });

  it('immediately enforces administrator user disable and permanently revokes the old session', async () => {
    const user = await makeUser(Role.AGENCY);
    const jar = cookies(await login(user));
    await patch(`/users/${user.id}`, jars.admin).send({ active: false }).expect(200);
    await get('/me', jar).expect(401);
    await post('/auth/refresh', jar).expect(401);
    await patch(`/users/${user.id}`, jars.admin).send({ active: true }).expect(200);
    await get('/me', jar).expect(401);
  });

  it('immediately enforces role changes rather than trusting JWT role claims', async () => {
    const user = await makeUser(Role.ADMIN);
    const jar = cookies(await login(user));
    await patch(`/users/${user.id}`, jars.admin).send({ role: Role.SUPPORT }).expect(200);
    await get('/users', jar).expect(401);
    await post('/auth/refresh', jar).expect(401);
    const newJar = cookies(await login({ ...user, role: Role.SUPPORT }));
    await get('/users', newJar).expect(403);
    await get('/me', newJar).expect(200);
  });

  it('rejects direct database disable, role change and MFA activation on the next request', async () => {
    for (const update of [{ active: false }, { mfaEnabled: true }, { role: Role.SUPPORT }]) {
      const user = await makeUser(Role.ADMIN);
      const jar = cookies(await login(user));
      await db.user.update({ where: { id: user.id }, data: update });
      await get('/me', jar).expect(401);
    }
  });

  it('organization disable immediately blocks both existing access and refresh', async () => {
    const orgId = await makeOrg(OrganizationType.AGENCY);
    const user = await makeUser(Role.AGENCY, { orgId });
    const jar = cookies(await login(user));
    await patch(`/organizations/${orgId}`, jars.admin).send({ active: false }).expect(200);
    await get('/me', jar).expect(401);
    await post('/auth/refresh', jar).expect(401);
    await patch(`/organizations/${orgId}`, jars.admin).send({ active: true }).expect(200);
    await get('/me', jar).expect(401);
  });

  it('clearly rejects self-demotion/deactivation and own administrator organization disable', async () => {
    for (const data of [{ active: false }, { role: Role.SUPPORT }]) {
      const response = await patch(`/users/${users.admin.id}`, jars.admin).send(data).expect(400);
      expect(response.body.error.message).toContain('own administrator');
    }
    await patch(`/organizations/${orgs.admin}`, jars.admin).send({ active: false }).expect(400);
    await get('/me', jars.admin).expect(200);
  });

  it('validates organization-role compatibility on invitations, user moves and organization type changes', async () => {
    for (const role of Object.values(Role)) {
      const incompatible = role === Role.AGENCY ? orgs.admin : orgs.agencyA;
      await post('/users/invite', jars.admin).send({
        email: `${randomUUID()}@example.test`, name: 'Incompatible', orgId: incompatible, role,
      }).expect(400);
    }
    await patch(`/users/${users.agencyA.id}`, jars.admin).send({ role: Role.ADMIN }).expect(400);
    await patch(`/organizations/${orgs.agencyA}`, jars.admin).send({ type: OrganizationType.ADVERTISER }).expect(400);
  });

  it('paginates all admin lists with strict numeric limits and safe user serialization', async () => {
    for (const path of ['/users', '/organizations', '/audit-logs']) {
      const response = await get(`${path}?page=1&pageSize=2`, jars.admin).expect(200);
      expect(response.body.items.length).toBeLessThanOrEqual(2);
      expect(response.body).toMatchObject({ page: 1, pageSize: 2, total: expect.any(Number) });
      await get(`${path}?page=0`, jars.admin).expect(400);
      await get(`${path}?pageSize=101`, jars.admin).expect(400);
      await get(`${path}?page=NaN`, jars.admin).expect(400);
    }
    expectSafe((await get('/users', jars.admin)).body);
    await patch(`/users/${users.agencyA.id}`, jars.admin).send({ passwordHash: 'injected' }).expect(400);
    await patch(`/users/${users.agencyA.id}`, jars.admin).send({ active: null }).expect(400);
    await post('/organizations', jars.admin).send({ name: '   ', type: 'AGENCY' }).expect(400);
  });

  it('creates and updates organizations and users with transactional audit snapshots', async () => {
    const created = await post('/organizations', jars.admin).send({ name: `created-${runId}`, type: 'AGENCY' }).expect(201);
    ownedOrgs.push(created.body.id);
    await patch(`/organizations/${created.body.id}`, jars.admin).send({ name: `updated-${runId}` }).expect(200);
    const target = await makeUser(Role.AGENCY);
    await patch(`/users/${target.id}`, jars.admin).send({ name: 'Updated User' }).expect(200);
    const events = await db.auditLog.findMany({ where: { entityId: created.body.id } });
    expect(events.map(event => event.action).sort()).toEqual(['ORGANIZATION_CREATED', 'ORGANIZATION_UPDATED']);
    const userEvent = await db.auditLog.findFirst({ where: { entityId: target.id, action: 'USER_UPDATED' } });
    expectSafe(userEvent);
  });

  it('rolls business changes back if audit insertion fails', async () => {
    const target = await makeUser(Role.AGENCY);
    const beforeOrg = await db.organization.findUniqueOrThrow({ where: { id: orgs.agencyA } });
    const beforeUser = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    const spy = jest.spyOn(audit, 'append').mockRejectedValue(new Error('injected audit failure'));
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await patch(`/organizations/${orgs.agencyA}`, jars.admin).send({ name: 'must-rollback' }).expect(500);
      await patch(`/users/${target.id}`, jars.admin).send({ name: 'must-rollback' }).expect(500);
      const email = `${randomUUID()}@example.test`;
      await post('/users/invite', jars.admin).send({ email, name: 'Rollback', role: 'AGENCY', orgId: orgs.agencyA }).expect(500);
      expect(await db.user.count({ where: { email } })).toBe(0);
      expect((await db.organization.findUniqueOrThrow({ where: { id: orgs.agencyA } })).name).toBe(beforeOrg.name);
      expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).name).toBe(beforeUser.name);
    } finally { spy.mockRestore(); stderr.mockRestore(); }
  });

  it('rolls a prior audit insert back if the subsequent business write fails', async () => {
    const entityId = randomUUID();
    await expect(db.$transaction(async tx => {
      await audit.append(tx, { action: 'ROLLBACK_TEST', entityType: 'test', entityId });
      await tx.organization.create({ data: { id: orgs.agencyA, name: 'duplicate', type: 'AGENCY' } });
    })).rejects.toThrow();
    expect(await db.auditLog.count({ where: { entityId } })).toBe(0);
  });

  it('keeps audit logs immutable against UPDATE, DELETE and TRUNCATE with the restricted runtime role', async () => {
    const triggers = await db.$queryRaw<{ tgname: string; tgenabled: string }[]>`
      SELECT tgname, tgenabled FROM pg_trigger
      WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal`;
    for (const name of ['audit_logs_no_update_delete', 'audit_logs_no_truncate']) {
      expect(triggers.some(trigger => trigger.tgname === name && trigger.tgenabled !== 'D')).toBe(true);
    }
    const event = await db.auditLog.findFirstOrThrow({ where: { userId: users.admin.id } });
    const probes = [
      (tx: Prisma.TransactionClient) => tx.$executeRaw`UPDATE "audit_logs" SET "action" = 'tampered' WHERE "id" = ${event.id}::uuid`,
      (tx: Prisma.TransactionClient) => tx.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${event.id}::uuid`,
      (tx: Prisma.TransactionClient) => tx.$executeRaw`TRUNCATE TABLE "audit_logs"`,
    ];
    for (const probe of probes) {
      let blocked = false;
      try {
        await db.$transaction(async tx => {
          await probe(tx);
          // Even a broken permission configuration cannot commit the destructive probe.
          throw new Error('UNEXPECTEDLY_ALLOWED');
        });
      } catch (error) { blocked = error instanceof Error && error.message !== 'UNEXPECTEDLY_ALLOWED'; }
      expect(blocked).toBe(true);
    }
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: event.id } })).action).toBe(event.action);
  });

  it('stores only an invitation hash, sends a fragment URL, and accepts it exactly once', async () => {
    const { email, token, response } = await invite();
    expect(response.body.invitation.status).toBe('sent');
    expect(response.body.user.email).toBe(email);
    expectSafe(response.body);
    expect(JSON.stringify(response.body).includes(token)).toBe(false);
    const stored = await db.invitation.findUniqueOrThrow({ where: { id: response.body.invitation.id } });
    expect(stored.tokenHash === hashToken(token)).toBe(true);
    const invitePassword = randomBytes(24).toString('base64url');
    await post('/auth/accept-invite').send({ token, password: invitePassword }).expect(200, { ok: true });
    await post('/auth/accept-invite').send({ token, password: invitePassword }).expect(400);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.active).toBe(true);
    expect(await compare(invitePassword, user.passwordHash!)).toBe(true);
    await post('/auth/login').send({ email, password: invitePassword }).expect(200);
    const events = await db.auditLog.findMany({ where: { entityId: user.id } });
    expect(JSON.stringify(events).includes(token)).toBe(false);
    expect(JSON.stringify(events).includes(invitePassword)).toBe(false);
  });

  it('rejects expired, revoked and superseded invitations without changing the password', async () => {
    for (const kind of ['expired', 'revoked', 'superseded']) {
      const { token, email, response } = await invite();
      if (kind === 'superseded') {
        await post('/users/invite', jars.admin).send({
          email, name: 'Reinvited', role: 'AGENCY', orgId: orgs.agencyA,
        }).expect(201);
      } else {
        await db.invitation.update({ where: { id: response.body.invitation.id },
          data: kind === 'expired' ? { expiresAt: new Date(0) } : { revokedAt: new Date() } });
      }
      await post('/auth/accept-invite').send({ token, password }).expect(400);
      expect((await db.user.findUniqueOrThrow({ where: { email } })).passwordHash).toBeNull();
    }
  });

  it('accepts at most one concurrent invitation submission', async () => {
    const { token } = await invite();
    const responses = await Promise.all([
      post('/auth/accept-invite').send({ token, password }),
      post('/auth/accept-invite').send({ token, password }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
  });

  it('blocks account takeover through re-inviting an existing credentialed user', async () => {
    await post('/users/invite', jars.admin).send({
      email: users.agencyA.email, name: 'Takeover', orgId: orgs.agencyA, role: 'AGENCY',
    }).expect(409);
  });

  it('revokes failed deliveries and never logs SMTP secrets', async () => {
    const smtpSecret = randomBytes(32).toString('hex');
    mockSendMail.mockRejectedValueOnce(new Error(`SMTP AUTH ${smtpSecret}`));
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await post('/users/invite', jars.admin).send({
        email: `${randomUUID()}@example.test`, name: 'Delivery failure', orgId: orgs.agencyA, role: 'AGENCY',
      }).expect(201);
      expect(response.body.invitation.status).toBe('failed');
      expect(JSON.stringify(response.body).includes(smtpSecret)).toBe(false);
      expect(JSON.stringify(log.mock.calls).includes(smtpSecret)).toBe(false);
      expect((await db.invitation.findUniqueOrThrow({ where: { id: response.body.invitation.id } })).revokedAt).not.toBeNull();
    } finally { log.mockRestore(); }
  });

  it('rate-limits repeated login failures using the shared database limiter', async () => {
    const email = `${randomUUID()}@example.test`;
    for (let attempt = 0; attempt < 10; attempt++) await post('/auth/login').send({ email, password }).expect(401);
    await post('/auth/login').send({ email, password }).expect(429);
  });

  it('keeps unrelated signed client buckets independent and rejects spoofed proxy headers', async () => {
    const config = app.get(RuntimeConfig).values;
    const before = config.proxySecret;
    const secret = randomBytes(48).toString('base64url');
    config.proxySecret = secret;
    const ip = '198.51.100.19';
    const secondIp = '198.51.100.20';
    const key = createHmac('sha256', config.secret).update(`login:ip:${ip}`).digest('hex');
    const key2 = createHmac('sha256', config.secret).update(`login:ip:${secondIp}`).digest('hex');
    const signed = (address: string) => {
      const time = String(Date.now());
      return post('/auth/login').set({
        'x-protarget-client-ip': address, 'x-protarget-proxy-time': time,
        'x-protarget-proxy-signature': createHmac('sha256', secret)
          .update(`${time}\n${address}\nPOST\n/api/v1/auth/login`).digest('hex'),
      });
    };
    try {
      await db.authRateLimit.upsert({ where: { key }, update: { count: 100, startedAt: new Date() },
        create: { key, count: 100, startedAt: new Date() } });
      await db.authRateLimit.deleteMany({ where: { key: key2 } });
      await signed(ip).send({ email: `${randomUUID()}@example.test`, password }).expect(429);
      await signed(secondIp).send({ email: `${randomUUID()}@example.test`, password }).expect(401);
      await post('/auth/login').set('x-forwarded-for', secondIp)
        .send({ email: `${randomUUID()}@example.test`, password }).expect(403);
    } finally {
      config.proxySecret = before;
      await db.authRateLimit.deleteMany({ where: { key: { in: [key, key2] } } });
    }
  });

  it('disables invitations before persistence when no mail provider is configured', async () => {
    const config = app.get(RuntimeConfig).values;
    const before = config.invitationsEnabled;
    config.invitationsEnabled = false;
    const email = `${randomUUID()}@example.test`;
    try {
      await get('/users/capabilities', jars.admin).expect(200, { invitationsEnabled: false });
      await post('/users/invite', jars.admin).send({
        name: 'Not created', email, role: 'AGENCY', orgId: orgs.agencyA,
      }).expect(503);
      expect(await db.user.findUnique({ where: { email } })).toBeNull();
    } finally { config.invitationsEnabled = before; }
  });

  it('allows deactivation inside an inactive organization without allowing reactivation', async () => {
    const orgId = await makeOrg('AGENCY');
    const user = await makeUser('AGENCY', { orgId });
    await db.organization.update({ where: { id: orgId }, data: { active: false } });
    await patch(`/users/${user.id}`, jars.admin).send({ active: false }).expect(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).active).toBe(false);
    await patch(`/users/${user.id}`, jars.admin).send({ active: true }).expect(400);
  });

  it('preserves an accepted invitation when SMTP delivery succeeded but acknowledgement timed out', async () => {
    mockSendMail.mockImplementationOnce(async (message: { to: string; text: string }) => {
      const url = new URL(message.text.split('\n').find(line => line.startsWith(origin))!);
      const token = new URLSearchParams(url.hash.slice(1)).get('token')!;
      await post('/auth/accept-invite').send({ token, password }).expect(200);
      throw new Error('Simulated late SMTP ACK timeout');
    });
    const response = await post('/users/invite', jars.admin).send({
      email: `${randomUUID()}@example.test`, name: 'Accepted before ACK', orgId: orgs.agencyA, role: 'AGENCY',
    }).expect(201);
    expect(response.body.invitation.status).toBe('sent');
    const stored = await db.invitation.findUniqueOrThrow({ where: { id: response.body.invitation.id } });
    expect(stored.acceptedAt).not.toBeNull();
    expect(stored.revokedAt).toBeNull();
    expect(stored.deliveryStatus).toBe('sent');
  });
});
