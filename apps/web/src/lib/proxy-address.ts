import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

/** Railway must be the immediate public ingress (no additional CDN).
 * X-Real-IP is supplied by Railway; client X-Forwarded-For and internal signature
 * headers are never copied. Missing/ambiguous ingress identity fails closed.
 */
export function proxyAddressHeaders(request: Request, path: string, env = process.env): Record<string, string> {
  if (!env.PROXY_SHARED_SECRET) {
    if (env.TRUSTED_INGRESS === 'railway' || env.RAILWAY_ENVIRONMENT_ID) throw new Error('Proxy secret missing');
    return {};
  }
  if (env.TRUSTED_INGRESS !== 'railway' || !env.RAILWAY_ENVIRONMENT_ID ||
      Buffer.byteLength(env.PROXY_SHARED_SECRET) < 32) throw new Error('Invalid ingress configuration');
  const ip = request.headers.get('x-real-ip');
  if (!ip || !isIP(ip)) throw new Error('Missing ingress address');
  const time = String(Date.now());
  const signature = createHmac('sha256', env.PROXY_SHARED_SECRET)
    .update(`${time}\n${ip}\n${request.method}\n${path}`).digest('hex');
  return { 'x-protarget-client-ip': ip, 'x-protarget-proxy-time': time,
    'x-protarget-proxy-signature': signature };
}
