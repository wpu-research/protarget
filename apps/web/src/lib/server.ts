import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { homeForRole, type Identity, type Role } from '@protarget/shared';
import type { Locale } from '@protarget/i18n';

export async function locale(): Promise<Locale> {
  return (await cookies()).get('protarget_locale')?.value === 'en' ? 'en' : 'tr';
}
export function apiOrigin() {
  const value = process.env.API_INTERNAL_URL;
  if (!value) throw new Error('API_INTERNAL_URL is required');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== value) {
    throw new Error('Invalid API_INTERNAL_URL');
  }
  return url.origin;
}
async function request(path: string) {
  return fetch(`${apiOrigin()}/api/v1${path}`, {
    headers: { Cookie: (await cookies()).toString() },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
  });
}
export const currentUser = cache(async (): Promise<Identity | null> => {
  const response = await request('/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Identity service unavailable');
  return response.json();
});
export async function requireUser(roles?: Role[]) {
  const user = await currentUser();
  if (!user) {
    const refresh = (await cookies()).has('protarget_refresh');
    redirect(refresh ? '/renew' : '/login');
  }
  if (roles && !roles.includes(user.role)) redirect(homeForRole(user.role));
  return user;
}
export async function serverApi<T>(path: string, notFoundOnMissing = false): Promise<T> {
  const response = await request(path);
  if (response.status === 401) redirect('/renew');
  if (response.status === 403) redirect('/');
  if (response.status === 404 && notFoundOnMissing) notFound();
  if (!response.ok) throw new Error('Service unavailable');
  return response.json();
}
export function pageNumber(raw: string | string[] | undefined) {
  return typeof raw === 'string' && /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : 1;
}
/** For add-on endpoints: null when the module is passive (404 ADDON_DISABLED) or the record is not visible. */
export async function serverApiOptional<T>(path: string): Promise<T | null> {
  const response = await request(path);
  if (response.status === 401) redirect('/renew');
  if (response.status === 403) redirect('/');
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Service unavailable');
  return response.json();
}
