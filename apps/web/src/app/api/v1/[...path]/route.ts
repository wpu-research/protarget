import { apiOrigin } from '@/lib/server';
import { CREATIVE_MAX_BYTES } from '@protarget/shared';
import { proxyAddressHeaders } from '@/lib/proxy-address';

/** Multipart envelope allowance on top of the file limit (the API enforces the exact file limit). */
const UPLOAD_LIMIT = CREATIVE_MAX_BYTES + 1024 * 1024;

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
  // Only creative upload is multipart and streamed; every other mutation stays small JSON.
  const upload = request.method === 'POST' && path.length === 1 && path[0] === 'creatives';
  // Creative file preview is the only binary response.
  const fileDownload = request.method === 'GET' && path.length === 3 && path[0] === 'creatives' && path[2] === 'file';
  if (mutation && request.headers.get('origin') !== process.env.WEB_ORIGIN) return failure(403, 'FORBIDDEN');
  if (mutation && !request.headers.get('content-type')?.startsWith(upload ? 'multipart/form-data' : 'application/json')) {
    return failure(415, 'VALIDATION_FAILED');
  }
  let tooLarge = false;
  try {
    let body: string | ReadableStream<Uint8Array> | undefined;
    if (upload && request.body) {
      const declared = Number(request.headers.get('content-length') ?? 0);
      if (declared > UPLOAD_LIMIT) return failure(413, 'PAYLOAD_TOO_LARGE');
      // Count streamed bytes as well; do not trust Content-Length.
      let size = 0;
      body = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          size += chunk.byteLength;
          if (size > UPLOAD_LIMIT) { tooLarge = true; controller.error(new Error('too large')); return; }
          controller.enqueue(chunk);
        },
      }));
    } else if (mutation && request.body) {
      // Bound streamed request bodies too; do not trust Content-Length.
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
    const headers = new Headers({ Accept: fileDownload ? '*/*' : 'application/json' });
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
      signal: AbortSignal.timeout(upload || fileDownload ? 600000 : 30000),
      ...(upload ? { duplex: 'half' } : {}),
    } as RequestInit);
    const binary = fileDownload && upstream.ok;
    const output = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': binary
      ? upstream.headers.get('content-type') ?? 'application/octet-stream' : 'application/json',
      'X-Content-Type-Options': 'nosniff' });
    if (binary) {
      for (const name of ['content-disposition', 'content-length', 'content-security-policy']) {
        const value = upstream.headers.get(name);
        if (value) output.set(name, value);
      }
    }
    const requestId = upstream.headers.get('x-request-id');
    if (requestId) output.set('X-Request-Id', requestId);
    for (const cookie of upstream.headers.getSetCookie()) output.append('Set-Cookie', cookie);
    return new Response(upstream.body, { status: upstream.status, headers: output });
  } catch {
    if (tooLarge) return failure(413, 'PAYLOAD_TOO_LARGE');
    return failure(503, 'SERVICE_UNAVAILABLE');
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH };
