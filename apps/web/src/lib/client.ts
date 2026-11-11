'use client';
import type { Identity } from '@protarget/shared';

export class RequestError extends Error {
  constructor(public code: string, public status: number, public details: Record<string, unknown> = {}, public serverMessage = '') { super(code); }
}
let refreshPromise: Promise<Identity> | undefined;
export function renewSession(): Promise<Identity> {
  if (refreshPromise) return refreshPromise;
  const renew = async () => {
    // Another tab may already have rotated the cookie while we waited for the lock.
    const me = await fetch('/api/v1/me', { cache: 'no-store' });
    if (me.ok) return me.json() as Promise<Identity>;
    if (me.status !== 401) throw new RequestError('SERVICE_UNAVAILABLE', me.status);
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!response.ok) throw new RequestError('UNAUTHENTICATED', response.status);
    return ((await response.json()) as { user: Identity }).user;
  };
  const perform = async (): Promise<Identity> => 'locks' in navigator
    ? await navigator.locks.request('protarget-session-refresh', renew) : await renew();
  refreshPromise = perform().finally(() => { refreshPromise = undefined; });
  return refreshPromise;
}
export async function api<T>(path: string, options: { method?: 'POST' | 'PATCH'; body?: unknown } = {}): Promise<T> {
  const send = () => fetch(`/api/v1${path}`, {
    method: options.method ?? 'GET', cache: 'no-store',
    ...(options.method ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body ?? {}) } : {}),
  });
  let response = await send();
  if (response.status === 401 && !path.startsWith('/auth/')) {
    try { await renewSession(); response = await send(); }
    catch { window.location.assign('/login'); throw new RequestError('UNAUTHENTICATED', 401); }
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new RequestError(data.error?.code ?? 'SERVICE_UNAVAILABLE', response.status, data.error?.details ?? {}, typeof data.error?.message === 'string' ? data.error.message : '');
  }
  if (response.status === 204) return undefined as T; // no body (e.g. archive)
  return response.json();
}
