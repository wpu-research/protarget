import type { Prisma } from '@prisma/client';

const secretKey = /password|passwd|secret|token|authorization|cookie|credential|api.?key|smtp|sso|invite.?url/i;

/** Defense in depth. Callers must still use allowlisted snapshots, never raw request bodies. */
export function redact(value: unknown, depth = 0): Prisma.InputJsonValue {
  if (depth > 20) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return '[EMPTY]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, secretKey.test(key) ? '[REDACTED]' : redact(item, depth + 1)]));
  }
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
      .replace(/([?&#](?:token|password|secret|code)=)[^&#\s]*/gi, '$1[REDACTED]');
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}
