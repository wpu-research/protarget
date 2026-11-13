'use client';
import type { MessageKey } from '@protarget/i18n';
import {
  DELIVERY_SOURCES, type CampaignDeliveryReport, type DeliveryBreakdownRow, type DeliverySource, type SourceFigures,
} from '@protarget/shared';
import { useLocale, useText } from './Locale';

const sourceKey = (source: DeliverySource) => `delivery.source.${source}` as MessageKey;
const levelKey = (source: DeliverySource) => `report.level.${source}` as MessageKey;

/** Main figure of a source: playouts, or declared impressions for the impression source. */
function mainValue(source: DeliverySource, f: SourceFigures) {
  return source === 'DECLARED_IMPRESSION' ? f.declaredImpressions : f.playouts;
}

function Estimate({ f }: { f: SourceFigures }) {
  const text = useText();
  if (f.estimatedImpressions === null) return null;
  return <small>{text('report.estimated', { value: f.estimatedImpressions })}
    {f.uncoveredPlayouts ? ` · ${text('report.partial', { count: f.uncoveredPlayouts })}` : ''}</small>;
}

/** Text that a spreadsheet would run as a formula is prefixed with ' (numbers are left as they are). */
export function csvCell(value: string | number | null) {
  let textValue = value === null ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(textValue) && !/^-?\d+(\.\d+)?$/.test(textValue)) textValue = `'${textValue}`;
  return /[",\r\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
}

/** Builds the CSV on the client from the same JSON the page shows; empty cell = unknown (never 0). */
function toCsv(report: CampaignDeliveryReport) {
  const header = ['breakdown', 'key', 'label', ...DELIVERY_SOURCES.flatMap(s => [`${s}_playouts`, `${s}_declared_impressions`, `${s}_estimated_impressions`, `${s}_uncovered_playouts`])];
  const line = (kind: string, row: DeliveryBreakdownRow) => [kind, row.key, row.label, ...DELIVERY_SOURCES.flatMap(s => {
    const f = row.figures[s];
    return [f.playouts, f.declaredImpressions, f.estimatedImpressions, f.uncoveredPlayouts];
  })].map(csvCell).join(',');
  return [header.join(','), ...report.byScreen.map(row => line('screen', row)), ...report.byDay.map(row => line('day_utc', row))].join('\n') + '\n';
}

function Breakdown({ title, rows }: { title: string; rows: DeliveryBreakdownRow[] }) {
  const text = useText();
  return <section className="card table-card" aria-label={title}>
    <div className="section-heading capacity-head"><h2>{title}</h2></div>
    {rows.length === 0 ? <p className="empty-inline">{text('report.noData')}</p> :
      <div className="table-scroll"><table>
        <thead><tr><th />{DELIVERY_SOURCES.map(s => <th key={s}>{text(sourceKey(s))}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}>
          <td><strong>{row.label}</strong>{row.detail && <small>{row.detail}</small>}</td>
          {DELIVERY_SOURCES.map(s => <td key={s}>{mainValue(s, row.figures[s]) ?? '—'}<Estimate f={row.figures[s]} /></td>)}
        </tr>)}</tbody></table></div>}
  </section>;
}

export function DeliveryReportView({ report }: { report: CampaignDeliveryReport }) {
  const text = useText();
  const locale = useLocale();
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: report.campaign.timezone }).format(new Date(iso));
  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${report.campaign.code}-delivery.csv`; link.click();
    URL.revokeObjectURL(url);
  };
  const c = report.campaign;
  const target = c.primaryGoal === 'PLAYOUTS' ? c.targetPlayouts : c.primaryGoal === 'IMPRESSIONS' ? c.targetImpressions : null;
  return <div className="stack">
    <section className="card">
      <div className="section-heading"><h2>{c.code} · {c.name}</h2>
        <button type="button" className="button" onClick={download}>{text('report.csv')}</button></div>
      <dl className="identity-grid">
        <dt>{text('report.advertiser')}</dt><dd>{c.advertiser}{c.agency ? ` · ${c.agency}` : ''}</dd>
        <dt>{text('report.flight')}</dt><dd>{date(c.startAt)} → {date(c.endAt)} ({c.timezone})</dd>
        <dt>{text('report.goal')}</dt><dd>{c.primaryGoal ? text(`report.goal.${c.primaryGoal}` as MessageKey, { target: target ?? '—' }) : text('report.noGoal')}</dd>
        <dt>{text('report.elapsed')}</dt><dd>%{report.elapsedPct}</dd>
      </dl>
      <p className="hint">{text('report.rule')}</p>
      {report.voidedRecords > 0 && <p className="hint">{text('report.voided', { count: report.voidedRecords })}</p>}
    </section>
    <div className="addon-grid">{report.sources.map(s => <section key={s.source} className="card">
      <p className="eyebrow">{text(levelKey(s.source))}</p>
      <h2>{text(sourceKey(s.source))}</h2>
      <p className="report-figure">{mainValue(s.source, s) ?? '—'}
        <small>{text(s.source === 'DECLARED_IMPRESSION' ? 'report.unit.impressions' : 'report.unit.playouts')}</small></p>
      <Estimate f={s} />
      <p className="muted">{text('report.delivery')}: {s.deliveryPct === null ? text('capacity.notComputable') : `%${s.deliveryPct}`}
        {' · '}{text('report.pacing')}: {s.pacing === null ? text('capacity.notComputable') : s.pacing}</p>
    </section>)}</div>
    <Breakdown title={text('report.byScreen')} rows={report.byScreen} />
    <Breakdown title={text('report.byDay')} rows={report.byDay} />
    <p className="hint">{text('report.generated', { date: new Date(report.generatedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' })}</p>
  </div>;
}
