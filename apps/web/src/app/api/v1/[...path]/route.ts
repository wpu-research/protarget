import { apiOrigin } from '@/lib/server';
import { proxyAddressHeaders } from '@/lib/proxy-address';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const failure = (status: number, code: string) =>
  Response.json({ error: { code, message: 'Request failed', details: {} } }, {
    status, headers: { 'Cache-Control': 'no-store' },
  });

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!path.length || path.some(segment => !/^[a-zA-Z0-9-]+$/.test(segment))) return failure(404, 'NOT_FOUND');
  const mutation = request.method !== 'GET';
  if (mutation && request.headers.get('origin') !== process.env.WEB_ORIGIN) return failure(403, 'FORBIDDEN');
  if (mutation && !request.headers.get('content-type')?.startsWith('application/json')) {
    return failure(415, 'VALIDATION_FAILED');
  }
  try {
    // Bound streamed request bodies too; do not trust Content-Length.
    let body: string | undefined;
    if (mutation && request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 32768) { await reader.cancel(); return failure(413, 'VALIDATION_FAILED'); }
        chunks.push(chunk.value);
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    const headers = new Headers({ Accept: 'application/json' });
    for (const name of ['cookie', 'origin', 'content-type']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Only the documented Railway edge address is signed; user forwarding headers are discarded.
    if (path[0] === 'auth' && ['login', 'refresh', 'accept-invite'].includes(path[1])) {
      for (const [name, value] of Object.entries(proxyAddressHeaders(request, `/api/v1/${path.join('/')}`))) {
        headers.set(name, value);
      }
    }
    const upstream = await fetch(`${apiOrigin()}/api/v1/${path.join('/')}${new URL(request.url).search}`, {
      method: request.method, headers, body, cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    const output = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff' });
    const requestId = upstream.headers.get('x-request-id');
    if (requestId) output.set('X-Request-Id', requestId);
    for (const cookie of upstream.headers.getSetCookie()) output.append('Set-Cookie', cookie);
    return new Response(upstream.body, { status: upstream.status, headers: output });
  } catch {
    return failure(503, 'SERVICE_UNAVAILABLE');
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH };
