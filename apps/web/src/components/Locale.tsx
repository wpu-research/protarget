'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { t, type Locale, type MessageKey } from '@protarget/i18n';
import { RequestError } from '@/lib/client';

const Context = createContext<Locale>('tr');
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <Context.Provider value={locale}>{children}</Context.Provider>;
}
export function useText() {
  const locale = useContext(Context);
  return (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
}
export function useLocale() { return useContext(Context); }
export function LanguageSwitch() {
  const locale = useContext(Context);
  const text = useText();
  const router = useRouter();
  return <button className="button quiet" type="button" aria-label={text('common.language')} onClick={() => {
    document.cookie = `protarget_locale=${locale === 'tr' ? 'en' : 'tr'}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    // Preserve the unkeyed InviteForm's in-memory token and unsaved inputs.
    router.refresh();
  }}>{locale === 'tr' ? 'EN' : 'TR'}</button>;
}
export function errorKey(error: unknown): MessageKey {
  if (!(error instanceof RequestError)) return 'error.unavailable';
  const keys: Record<string, MessageKey> = {
    UNAUTHENTICATED: 'error.authentication', FORBIDDEN: 'error.forbidden', RATE_LIMITED: 'error.rateLimit',
    VALIDATION_FAILED: 'error.validation', INVALID_STATE_TRANSITION: 'error.conflict', NOT_FOUND: 'error.notFound',
    INVITATIONS_DISABLED: 'user.invitesDisabled',
    ADDON_DISABLED: 'error.addonDisabled', ADDON_NOT_AVAILABLE: 'error.addonNotAvailable',
  };
  return keys[error.code] ?? 'error.unavailable';
}
