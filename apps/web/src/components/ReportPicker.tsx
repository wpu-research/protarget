import { t } from '@protarget/i18n';
import { locale } from '@/lib/server';

/** Server component: a plain GET form, so the chosen campaign is in the URL and shareable. */
export async function ReportPicker({ campaigns, selected, action }: {
  campaigns: { id: string; label: string }[]; selected?: string; action: string;
}) {
  const language = await locale();
  if (!campaigns.length) return <p className="card empty-inline">{t('report.portalEmpty', language)}</p>;
  return <form className="card form-grid capacity-filters" method="get" action={action}>
    <label>{t('report.chooseCampaign', language)}<select name="campaignId" defaultValue={selected ?? ''} required>
      <option value="" disabled>{t('report.pickHint', language)}</option>
      {campaigns.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    <div><button className="button primary" type="submit">{t('report.show', language)}</button></div>
  </form>;
}
