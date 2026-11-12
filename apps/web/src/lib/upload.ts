'use client';
import type { CreativeSummary } from '@protarget/shared';
import { renewSession, RequestError } from './client';

/** Files above this size renew the session first: a 401 after sending hundreds of MB would waste the whole transfer. */
const RENEW_BEFORE_BYTES = 1024 * 1024;
export const UPLOAD_ABORTED = 'UPLOAD_ABORTED';

function isCreative(value: unknown): value is CreativeSummary {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && typeof item.code === 'string' && typeof item.status === 'string';
}

/**
 * Multipart upload with progress. XMLHttpRequest is used because fetch exposes no upload progress.
 * `signal` aborts the transfer (component unmount); an aborted upload rejects with code UPLOAD_ABORTED.
 */
export function uploadCreative(form: FormData, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<CreativeSummary> {
  const send = () => new Promise<{ status: number; body: unknown; sent: boolean }>((resolve, reject) => {
    if (signal?.aborted) { reject(new RequestError(UPLOAD_ABORTED, 0)); return; }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const done = () => { signal?.removeEventListener('abort', abort); clearTimeout(responseTimer); };
    request.open('POST', '/api/v1/creatives');
    request.responseType = 'text';
    // No total timeout: a slow uplink may legitimately need longer than any fixed bound. Only the wait for the response
    // after the whole body is out is bounded (longer than the proxy's own 10 minute cap), so it cannot spin forever.
    let responseTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    // Once the whole body is out, a lost response may hide a created record: that is "unconfirmed", not "unavailable".
    let sent = false;
    request.upload.onload = () => { sent = true; responseTimer = setTimeout(() => { timedOut = true; request.abort(); }, 12 * 60 * 1000); };
    const lost = () => new RequestError(sent ? 'UPLOAD_UNCONFIRMED' : 'SERVICE_UNAVAILABLE', 0);
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = () => { done(); reject(lost()); };
    request.ontimeout = () => { done(); reject(lost()); };
    request.onabort = () => { done(); reject(timedOut ? lost() : new RequestError(UPLOAD_ABORTED, 0)); };
    request.onload = () => {
      done();
      let body: unknown = {};
      try { body = JSON.parse(request.responseText); } catch { /* non-JSON error body */ }
      resolve({ status: request.status, body, sent });
    };
    request.send(form);
  });
  return (async () => {
    onProgress(0);
    const file = form.get('file');
    if (file instanceof File && file.size > RENEW_BEFORE_BYTES) {
      try { await renewSession(); }
      catch (failure) {
        if (failure instanceof RequestError && failure.code === 'UNAUTHENTICATED') { window.location.assign('/login'); throw failure; }
        throw new RequestError('SERVICE_UNAVAILABLE', 0);
      }
    }
    let result = await send();
    if (result.status === 401) {
      try { await renewSession(); }
      catch { window.location.assign('/login'); throw new RequestError('UNAUTHENTICATED', 401); }
      onProgress(0);
      result = await send();
    }
    if (result.status < 200 || result.status >= 300) {
      const error = (result.body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
      // A code-less 5xx after the full body was sent (proxy 502/504) may still have stored the record.
      const fallback = result.status === 413 ? 'PAYLOAD_TOO_LARGE' : result.status >= 500 && result.sent ? 'UPLOAD_UNCONFIRMED' : 'SERVICE_UNAVAILABLE';
      throw new RequestError(error?.code ?? fallback, result.status, error?.details ?? {}, error?.message ?? '');
    }
    // 2xx but unreadable body: the record may exist, so do not invite a blind retry.
    if (!isCreative(result.body)) throw new RequestError('UPLOAD_UNCONFIRMED', result.status);
    onProgress(100);
    return result.body;
  })();
}
