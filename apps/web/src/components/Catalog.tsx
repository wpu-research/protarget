import Link from 'next/link';
import { t, type Locale } from '@protarget/i18n';
import type { CatalogPage } from '@protarget/shared';
import { formatDecimal } from '@/lib/decimal';

/** Server component: read-only inventory for agencies/brands. No booking action exists here. */
export function CatalogView({ data, venueId, language }: { data: CatalogPage; venueId?: string; language: Locale }) {
  const link = (page: number) => `/portal/catalog?page=${page}${venueId ? `&venueId=${venueId}` : ''}`;
  const hours = (start: string | null, end: string | null) => start && end ? `${start}–${end}` : t('capacity.notComputable', language);
  return <div className="stack">
    <form className="card form-grid capacity-filters" method="get" action="/portal/catalog">
      <label>{t('capacity.venue', language)}<select name="venueId" defaultValue={venueId ?? ''}>
        <option value="">{t('capacity.allVenues', language)}</option>
        {data.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <div><button className="button primary" type="submit">{t('catalog.filter', language)}</button></div>
      <p className="hint full">{t(data.pricesVisible ? 'catalog.pricesVisible' : 'catalog.pricesHidden', language)}</p>
    </form>
    <section className="card table-card" aria-label={t('nav.catalog', language)}>
      {data.items.length === 0 ? <p className="empty-inline">{t('capacity.empty', language)}</p> :
        <div className="table-scroll"><table>
          <thead><tr><th>{t('capacity.screen', language)}</th><th>{t('catalog.specs', language)}</th>
            <th>{t('catalog.loop', language)}</th><th>{t('catalog.hours', language)}</th>
            {data.pricesVisible && <th>{t('sales.dailyRate', language)}</th>}</tr></thead>
          <tbody>{data.items.map(s => <tr key={s.id}>
            <td><strong>{s.code}</strong><small>{s.name} · {s.venue.name}{s.venue.city ? ` · ${s.venue.city}` : ''}</small></td>
            <td>{s.resolutionWidth && s.resolutionHeight ? `${s.resolutionWidth}×${s.resolutionHeight}` : '—'}
              <small>{[s.orientation, s.physicalSize].filter(Boolean).join(' · ') || '—'}</small></td>
            <td>{s.loopLengthSec ?? '—'}s / {s.defaultSlotLengthSec ?? '—'}s</td>
            <td>{hours(s.operatingStart, s.operatingEnd)}<small>{s.timezone}</small></td>
            {data.pricesVisible && <td>{s.listPrice ? `${formatDecimal(s.listPrice.dailyRate, language)} ${s.listPrice.currency}` : t('sales.noPrice', language)}</td>}
          </tr>)}</tbody></table></div>}
      {data.total > data.pageSize && <div className="pager"><span>{t('common.page', language, { page: data.page, total: data.total })}</span><div>
        {data.page > 1 && <Link className="button quiet" href={link(data.page - 1)}>{t('common.previous', language)}</Link>}
        {data.page * data.pageSize < data.total && <Link className="button quiet" href={link(data.page + 1)}>{t('common.next', language)}</Link>}
      </div></div>}
    </section>
    <section className="card"><h2>{t('catalog.requestTitle', language)}</h2><p className="muted">{t('catalog.requestNote', language)}</p></section>
  </div>;
}
