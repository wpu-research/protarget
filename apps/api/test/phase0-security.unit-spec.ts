import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrganizationType, Role } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { compatibleRole } from '../src/common/identity';
import { redact } from '../src/common/redact';
import { validateEnvironment } from '../src/common/runtime-config';
import { AcceptInviteDto, LoginDto } from '../src/modules/auth/auth.dto';
import { readCookie, issueAccess, verifyAccess, hashToken } from '../src/modules/auth/tokens';
import { UpdateUserDto } from '../src/modules/users/users.dto';
import { AuthGuard } from '../src/modules/auth/auth.guard';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { PUBLIC_ROUTE } from '../src/modules/auth/auth.policy';
import type { RuntimeConfig } from '../src/common/runtime-config';
import type { SessionService } from '../src/modules/auth/session.service';
import type { AuditService } from '../src/modules/audit/audit.service';

describe('Phase 0 security primitives', () => {
  const secret = randomBytes(48).toString('base64url');
  it('recursively redacts secret keys, bearer values, JWTs and URL tokens', () => {
    const access = issueAccess(secret, randomUUID(), randomUUID());
    const value = redact({ nested: [{ passwordHash: 'hash', mfaSecret: 'secret', refreshToken: 'raw' }],
      url: 'https://example.test/accept-invite#token=raw', value: `Bearer ${access}` });
    expect(JSON.stringify(value)).not.toContain('raw');
    expect(JSON.stringify(value)).not.toContain(access);
    expect(value).toMatchObject({ nested: [{ passwordHash: '[REDACTED]', mfaSecret: '[REDACTED]', refreshToken: '[REDACTED]' }] });
  });

  it('has a complete explicit organization-role compatibility matrix', () => {
    for (const role of Object.values(Role)) for (const type of Object.values(OrganizationType)) {
      expect(compatibleRole(role, type)).toBe(
        (role === Role.ADMIN || role === Role.SUPPORT) ? type === OrganizationType.ADMIN :
          (role === Role.AGENCY ? type === OrganizationType.AGENCY : type === OrganizationType.ADVERTISER));
    }
  });

  it('normalizes email and rejects passwords exceeding bcrypt UTF-8 bytes', async () => {
    const dto = plainToInstance(LoginDto, { email: '  USER@EXAMPLE.TEST ', password: 'short' });
    expect(dto.email).toBe('user@example.test');
    expect(await validate(dto)).toHaveLength(0);
    const invite = plainToInstance(AcceptInviteDto, { token: randomBytes(32).toString('base64url'), password: 'ü'.repeat(37) });
    expect((await validate(invite)).map(error => error.property)).toContain('password');
  });

  it('does not treat null as an omitted PATCH field', async () => {
    expect((await validate(plainToInstance(UpdateUserDto, { active: null, role: null }))).length).toBe(2);
  });

  it('rejects weak secrets and insecure production origins', () => {
    const env = { JWT_ACCESS_SECRET: secret, WEB_ORIGIN: 'http://localhost:3100', NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost/test', SMTP_HOST: 'localhost', SMTP_FROM: 'app@example.test' };
    expect(validateEnvironment(env).webOrigin).toBe(env.WEB_ORIGIN);
    expect(() => validateEnvironment({ ...env, JWT_ACCESS_SECRET: 'x'.repeat(48) })).toThrow('JWT_ACCESS_SECRET');
    expect(() => validateEnvironment({ ...env, NODE_ENV: 'production' })).toThrow('WEB_ORIGIN');
    expect(() => validateEnvironment({ ...env, WEB_ORIGIN: 'https://example.test/path' })).toThrow('WEB_ORIGIN');
  });

  it('rejects ambiguous cookies and verifies signed token purpose', () => {
    expect(readCookie({ headers: { cookie: 'protarget_access=a; protarget_access=b' } }, 'protarget_access')).toBeUndefined();
    expect(readCookie({ headers: { cookie: 'protarget_access=%zz' } }, 'protarget_access')).toBeUndefined();
    const access = issueAccess(secret, randomUUID(), randomUUID());
    expect(verifyAccess(secret, access).type).toBe('access');
    expect(() => verifyAccess(randomBytes(48).toString('hex'), access)).toThrow();
    expect(hashToken(access)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('denies unannotated handlers and applies Origin checks before public bypass', async () => {
    const reflector = new Reflector();
    const config = { values: { webOrigin: 'http://localhost:3100' } } as RuntimeConfig;
    const sessions = { authenticate: jest.fn().mockResolvedValue({ user: { role: Role.ADMIN } }) } as unknown as SessionService;
    const audit = { recordSecurity: jest.fn() } as unknown as AuditService;
    const guard = new AuthGuard(reflector, config, sessions, audit);
    const handler = () => undefined;
    const req = { method: 'GET', headers: {}, path: '/api/v1/unannotated' };
    const context = {
      getHandler: () => handler, getClass: () => Object,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    Reflect.defineMetadata(PUBLIC_ROUTE, true, handler);
    req.method = 'POST';
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    req.headers = { origin: config.values.webOrigin };
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
