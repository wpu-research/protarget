import { notFound } from 'next/navigation';
import { t } from '@protarget/i18n';
import type { CampaignDeliveryReport, OrganizationSummary, PageResult, ReportCampaignListItem } from '@protarget/shared';
import { Placeholder } from '@/components/Shell';
import { PORTAL_NAV, findNavLabel } from '@/lib/nav';
import { locale, requireUser, serverApi, serverApiOptional } from '@/lib/server';
import { DeliveryReportView } from '@/components/Report';
import { ReportPicker } from '@/components/ReportPicker';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function PortalPage({ params, searchParams }: {
  params: Promise<{ slug?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser(['AGENCY', 'ADVERTISER']);
  const language = await locale();
  const { slug = [] } = await params;
  const path = ['/portal', ...slug].join('/');
  const label = findNavLabel(PORTAL_NAV, path);
  if (!label) notFound();
  if (path === '/portal/reports') {
    // Add-on "reporting": passive by default; the API answers 404 and the page stays a placeholder.
    const campaigns = await serverApiOptional<PageResult<ReportCampaignListItem>>('/portal/reports/campaigns?pageSize=100');
    if (!campaigns) return <Placeholder title={t(label, language)} />;
    const search = await searchParams;
    const campaignId = typeof search.campaignId === 'string' && uuid.test(search.campaignId) ? search.campaignId : undefined;
    const report = campaignId ? await serverApiOptional<CampaignDeliveryReport>(`/portal/reports/campaigns/${campaignId}/delivery`) : null;
    if (campaignId && !report) notFound();
    return <><p className="eyebrow">{t('common.readOnly', language)}</p><h1>{t('report.portalTitle', language)}</h1>
      <p className="page-description">{t('report.portalDescription', language)}</p>
      <ReportPicker campaigns={campaigns.items.map(c => ({ id: c.id, label: `${c.code} · ${c.name}` }))} selected={campaignId} action="/portal/reports" />
      {report && <div className="stack report-gap"><DeliveryReportView report={report} /></div>}</>;
  }
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
