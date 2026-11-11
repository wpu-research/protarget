'use client';
import type { CreativeSummary } from '@protarget/shared';
import { renewSession, RequestError } from './client';

/** Multipart upload with progress. XMLHttpRequest is used because fetch exposes no upload progress. */
export function uploadCreative(form: FormData, onProgress: (percent: number) => void): Promise<CreativeSummary> {
  const send = () => new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/v1/creatives');
    request.responseType = 'text';
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = () => reject(new RequestError('SERVICE_UNAVAILABLE', 0));
    request.ontimeout = () => reject(new RequestError('SERVICE_UNAVAILABLE', 0));
    request.onload = () => {
      let body: unknown = {};
      try { body = JSON.parse(request.responseText); } catch { /* non-JSON error body */ }
      resolve({ status: request.status, body });
    };
    request.send(form);
  });
  return (async () => {
    onProgress(0);
    let result = await send();
    if (result.status === 401) {
      try { await renewSession(); onProgress(0); result = await send(); }
      catch { window.location.assign('/login'); throw new RequestError('UNAUTHENTICATED', 401); }
    }
    if (result.status < 200 || result.status >= 300) {
      const error = (result.body as { error?: { code?: string; details?: Record<string, unknown> } }).error;
      throw new RequestError(error?.code ?? (result.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'SERVICE_UNAVAILABLE'), result.status, error?.details ?? {});
    }
    onProgress(100);
    return result.body as CreativeSummary;
  })();
}
