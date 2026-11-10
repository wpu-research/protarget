import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sign, verify, JwtPayload } from 'jsonwebtoken';
import type { Response, Request } from 'express';
import type { RuntimeConfig } from '../../common/runtime-config';

export const ACCESS_COOKIE = 'protarget_access';
export const REFRESH_COOKIE = 'protarget_refresh';
export const ACCESS_SECONDS = 15 * 60;
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const opaqueToken = () => randomBytes(32).toString('base64url');
export const validOpaque = (token: unknown): token is string =>
  typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);

export function issueAccess(secret: string, userId: string, sessionId: string) {
  return sign({ sid: sessionId, type: 'access' }, secret, {
    algorithm: 'HS256', expiresIn: ACCESS_SECONDS, issuer: 'protarget-api',
    audience: 'protarget-web', subject: userId, jwtid: randomUUID(),
  });
}

export function verifyAccess(secret: string, token: string): JwtPayload & { sid: string; sub: string } {
  const claims = verify(token, secret, {
    algorithms: ['HS256'], issuer: 'protarget-api', audience: 'protarget-web',
    maxAge: ACCESS_SECONDS,
  });
  if (typeof claims === 'string' || claims.type !== 'access' ||
      typeof claims.sid !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.sid) ||
      typeof claims.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.sub) ||
      typeof claims.exp !== 'number' || typeof claims.jti !== 'string') {
    throw new Error('Invalid access claims');
  }
  return claims as JwtPayload & { sid: string; sub: string };
}

/** Reject duplicates and malformed encoding rather than choosing an ambiguous credential. */
export function readCookie(req: Pick<Request, 'headers'>, name: string): string | undefined {
  const matches = (req.headers.cookie ?? '').split(';')
    .map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  try {
    const result = decodeURIComponent(matches[0].slice(name.length + 1));
    return result.length <= 4096 ? result : undefined;
  } catch { return undefined; }
}

const cookieOptions = (config: RuntimeConfig) => ({
  httpOnly: true, secure: config.values.secureCookies, sameSite: 'strict' as const, path: '/',
});

export function setAuthCookies(res: Response, config: RuntimeConfig,
  tokens: { access: string; refresh: string; expiresAt: Date }): void {
  res.cookie(ACCESS_COOKIE, tokens.access, { ...cookieOptions(config), maxAge: ACCESS_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, tokens.refresh, {
    ...cookieOptions(config), maxAge: Math.max(0, tokens.expiresAt.getTime() - Date.now()),
  });
}

export function clearAuthCookies(res: Response, config: RuntimeConfig): void {
  res.clearCookie(ACCESS_COOKIE, cookieOptions(config));
  res.clearCookie(REFRESH_COOKIE, cookieOptions(config));
}
