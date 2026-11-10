import type { ReactNode } from 'react';
import { t, type MessageKey } from '@protarget/i18n';
import { locale } from '@/lib/server';
import { LanguageSwitch } from './Locale';
import { Brand } from './Brand';

export async function AuthLayout({ title, children }: { title: MessageKey; children: ReactNode }) {
  const language = await locale();
  return <main className="auth-page"><div className="auth-intro">
    <Brand />
    <p className="eyebrow">{t('foundation.eyebrow', language)}</p>
    <h1>{t('auth.hero', language)}</h1><p>{t('auth.description', language)}</p>
    <span className="phase-chip">{t('foundation.phase', language)}</span>
  </div><section className="auth-card"><div className="auth-heading"><h2>{t(title, language)}</h2><LanguageSwitch /></div>{children}</section></main>;
}
