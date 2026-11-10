import { t } from '@protarget/i18n';
import { Shell } from '@/components/Shell';
import { SUPPORT_NAV } from '@/lib/nav';
import { locale, requireUser, serverApi } from '@/lib/server';
export default async function SupportPage() {
  const user = await requireUser(['SUPPORT']);
  const language = await locale();
  const health = await serverApi<{ status: string }>('/health');
  return <Shell nav={SUPPORT_NAV} user={user}><p className="eyebrow">{t('role.SUPPORT', language)}</p><h1>{t('nav.support', language)}</h1>
    <p className="page-description">{t('support.description', language)}</p><section className="card">
      <h2>{user.name}</h2><p>{user.email}</p><span className="badge good">{t(health.status === 'ok' ? 'support.healthy' : 'error.unavailable', language)}</span>
    </section></Shell>;
}
