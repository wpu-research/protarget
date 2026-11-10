import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';
import { ApiError } from './api-error';

/** Only the web service can authenticate Railway's ingress address to the private API.
 * Never enable Express trust-proxy or trust arbitrary X-Forwarded-For.
 */
export function clientAddress(req: Pick<Request, 'headers' | 'ip' | 'method' | 'path'>, secret?: string): string {
  if (!secret) return req.ip ?? 'unknown'; // Direct local development only.
  const ip = req.headers['x-protarget-client-ip'];
  const time = req.headers['x-protarget-proxy-time'];
  const signature = req.headers['x-protarget-proxy-signature'];
  if (typeof ip !== 'string' || !isIP(ip) || typeof time !== 'string' || !/^\d{13}$/.test(time) ||
      Math.abs(Date.now() - Number(time)) > 60000 ||
      typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) {
    throw new ApiError(403, 'FORBIDDEN', 'Trusted proxy required');
  }
  const expected = createHmac('sha256', secret)
    .update(`${time}\n${ip}\n${req.method}\n${req.path}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
    throw new ApiError(403, 'FORBIDDEN', 'Trusted proxy required');
  }
  // Canonicalize equivalent IPv6 strings before hashing a rate-limit key.
  return isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip;
}
