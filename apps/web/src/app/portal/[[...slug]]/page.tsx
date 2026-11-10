import { notFound } from 'next/navigation';
import { t } from '@protarget/i18n';
import type { OrganizationSummary } from '@protarget/shared';
import { Placeholder } from '@/components/Shell';
import { PORTAL_NAV, findNavLabel } from '@/lib/nav';
import { locale, requireUser, serverApi } from '@/lib/server';
export default async function PortalPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const user = await requireUser(['AGENCY', 'ADVERTISER']);
  const language = await locale();
  const { slug = [] } = await params;
  const path = ['/portal', ...slug].join('/');
  const label = findNavLabel(PORTAL_NAV, path);
  if (!label) notFound();
  if (slug.length) return <Placeholder title={t(label, language)} />;
  const organization = await serverApi<OrganizationSummary>(`/portal/organizations/${user.orgId}`);
  return <><p className="eyebrow">{t('common.readOnly', language)}</p><h1>{organization.name}</h1>
    <p className="page-description">{t('portal.description', language)}</p>
    <section className="card"><h2>{t('portal.identity', language)}</h2><dl className="identity-grid">
      <dt>{t('field.name', language)}</dt><dd>{user.name}</dd>
      <dt>{t('field.email', language)}</dt><dd>{user.email}</dd>
      <dt>{t('field.role', language)}</dt><dd>{t(`role.${user.role}`, language)}</dd>
      <dt>{t('field.organization', language)}</dt><dd>{organization.name}</dd>
    </dl></section><section className="card empty-state"><h2>{t('portal.emptyTitle', language)}</h2><p>{t('portal.emptyDescription', language)}</p></section></>;
}
