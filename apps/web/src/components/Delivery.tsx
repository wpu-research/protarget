'use client';
import { useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MessageKey } from '@protarget/i18n';
import {
  DELIVERY_CSV_COLUMNS, DELIVERY_MAX_CSV_CHARS, DELIVERY_SOURCES,
  type DeliveryBatchView, type DeliveryPreview, type DeliveryRecordView, type DeliverySource, type PageResult,
} from '@protarget/shared';
import { api, RequestError } from '@/lib/client';
import { errorKey, useLocale, useText } from './Locale';

function useUtc() {
  const locale = useLocale();
  return (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso)) + ' UTC';
}
const sourceKey = (source: DeliverySource) => `delivery.source.${source}` as MessageKey;
const rowErrorKey = (code: string) => `delivery.rowError.${code}` as MessageKey;

export function DeliveryView({ batches, records, href }: {
  batches: PageResult<DeliveryBatchView>; records: PageResult<DeliveryRecordView>;
  href: { recordsPrev: string; recordsNext: string; batchesPrev: string; batchesNext: string; voided: string; showVoided: boolean };
}) {
  return <div className="stack">
    <ImportForm />
    <Batches batches={batches} prev={href.batchesPrev} next={href.batchesNext} />
    <Records records={records} prev={href.recordsPrev} next={href.recordsNext} voided={href.voided} showVoided={href.showVoided} />
  </div>;
}

function ImportForm() {
  const text = useText();
  const router = useRouter();
  const [source, setSource] = useState<DeliverySource>('CMS_VERIFIED');
  const [filename, setFilename] = useState('');
  const [csv, setCsv] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<DeliveryPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);
  const body = () => ({ source, filename: filename || 'pasted.csv', csv, note: note || null });
  const reset = () => { setPreview(null); setDone(false); setError(null); };
  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    reset();
    if (!file) return;
    if (file.size > DELIVERY_MAX_CSV_CHARS * 4) { setError('delivery.tooLarge'); return; }
    const content = await file.text();
    if (content.length > DELIVERY_MAX_CSV_CHARS) { setError('delivery.tooLarge'); return; }
    setFilename(file.name.slice(0, 200)); setCsv(content);
  };
  const run = async (commit: boolean) => {
    if (!csv.trim()) { setError('delivery.noFile'); return; }
    setBusy(true); setError(null);
    try {
      if (!commit) { setPreview(await api<DeliveryPreview>('/delivery/imports/preview', { method: 'POST', body: body() })); return; }
      await api('/delivery/imports', { method: 'POST', body: body() });
      setDone(true); setPreview(null); setCsv(''); setFilename(''); setNote(''); router.refresh();
    } catch (e) {
      if (e instanceof RequestError && e.code === 'VALIDATION_FAILED' && Array.isArray(e.details.errors)) setError('delivery.fixLines');
      else setError(errorKey(e));
    } finally { setBusy(false); }
  };
  return <section className="card" aria-labelledby="delivery-import">
    <h2 id="delivery-import">{text('delivery.import')}</h2>
    <p className="muted">{text('delivery.importDescription')}</p>
    <p className="hint">{text('delivery.columns', { columns: DELIVERY_CSV_COLUMNS.join(', ') })}</p>
    <div className="form-grid two-columns">
      <label>{text('delivery.sourceLabel')}<select value={source} onChange={event => { setSource(event.target.value as DeliverySource); reset(); }}>
        {DELIVERY_SOURCES.map(item => <option key={item} value={item}>{text(sourceKey(item))}</option>)}</select></label>
      <label>{text('delivery.file')}<input type="file" accept=".csv,text/csv" onChange={pick} /></label>
      <label className="full">{text('delivery.paste')}<textarea rows={6} value={csv} maxLength={DELIVERY_MAX_CSV_CHARS}
        onChange={event => { setCsv(event.target.value); reset(); }} /></label>
      <label className="full">{text('delivery.note')}<input value={note} maxLength={1000} onChange={event => setNote(event.target.value)} /></label>
      <p className="hint full">{text(`delivery.sourceHint.${source}` as MessageKey)}</p>
      <div className="full addon-actions">
        <button type="button" className="button" disabled={busy} onClick={() => run(false)}>{text('delivery.preview')}</button>
        <button type="button" className="button primary" disabled={busy || !preview || preview.errors.length > 0 || preview.accepted === 0}
          onClick={() => run(true)}>{text('delivery.commit')}</button>
      </div>
    </div>
    {error && <p className="error" role="alert">{text(error)}</p>}
    {done && <p className="success" role="status">{text('delivery.imported')}</p>}
    {preview && <div role="status" className="delivery-preview">
      <p><strong>{text('delivery.previewSummary', { rows: preview.rowCount, accepted: preview.accepted, duplicates: preview.duplicates, errors: preview.errors.length })}</strong></p>
      <p className="muted">{preview.playouts !== null && text('delivery.previewPlayouts', { value: preview.playouts })}
        {preview.impressions !== null && text('delivery.previewImpressions', { value: preview.impressions })}</p>
      {preview.errors.length > 0 && <ul className="delivery-errors">{preview.errors.map((item, index) =>
        <li key={`${item.line}-${item.code}-${index}`}>{text('delivery.lineError', { line: item.line, column: item.column ?? '—' })} {text(rowErrorKey(item.code))}</li>)}</ul>}
    </div>}
  </section>;
}

function PageLinks({ data, prev, next }: { data: PageResult<unknown>; prev: string; next: string }) {
  const text = useText();
  if (data.total <= data.pageSize) return null;
  return <div className="pager"><span>{text('common.page', { page: data.page, total: data.total })}</span><div>
    {data.page > 1 && <Link className="button quiet" href={prev}>{text('common.previous')}</Link>}
    {data.page * data.pageSize < data.total && <Link className="button quiet" href={next}>{text('common.next')}</Link>}
  </div></div>;
}

function Batches({ batches, prev, next }: { batches: PageResult<DeliveryBatchView>; prev: string; next: string }) {
  const text = useText();
  const utc = useUtc();
  return <section className="card table-card" aria-labelledby="delivery-batches">
    <div className="section-heading capacity-head"><h2 id="delivery-batches">{text('delivery.batches')}</h2></div>
    {batches.items.length === 0 ? <p className="empty-inline">{text('delivery.noBatches')}</p> :
      <div className="table-scroll"><table>
        <thead><tr><th>{text('delivery.when')}</th><th>{text('delivery.sourceLabel')}</th><th>{text('delivery.file')}</th>
          <th>{text('delivery.rows')}</th><th>{text('delivery.accepted')}</th><th>{text('delivery.duplicates')}</th></tr></thead>
        <tbody>{batches.items.map(batch => <tr key={batch.id}>
          <td>{utc(batch.createdAt)}<small>{batch.createdBy.name}</small></td>
          <td><span className="badge">{text(sourceKey(batch.source))}</span></td>
          <td>{batch.filename}{batch.note && <small>{batch.note}</small>}</td>
          <td>{batch.rowCount}</td><td>{batch.acceptedCount}</td><td>{batch.duplicateCount}</td>
        </tr>)}</tbody></table></div>}
    <PageLinks data={batches} prev={prev} next={next} />
  </section>;
}

function Records({ records, prev, next, voided, showVoided }: {
  records: PageResult<DeliveryRecordView>; prev: string; next: string; voided: string; showVoided: boolean;
}) {
  const text = useText();
  const utc = useUtc();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const cancel = async (record: DeliveryRecordView) => {
    const reason = window.prompt(text('delivery.voidReason'));
    if (!reason || reason.trim().length < 3) return;
    setBusy(true); setError(null);
    try { await api(`/delivery/records/${record.id}/void`, { method: 'POST', body: { reason: reason.trim() } }); router.refresh(); }
    catch (e) { setError(errorKey(e)); } finally { setBusy(false); }
  };
  return <section className="card table-card" aria-labelledby="delivery-records">
    <div className="section-heading capacity-head"><h2 id="delivery-records">{text('delivery.records')}</h2>
      <Link className="button quiet" href={voided}>{text(showVoided ? 'delivery.hideVoided' : 'delivery.showVoided')}</Link></div>
    {error && <p className="error" role="alert">{text(error)}</p>}
    {records.items.length === 0 ? <p className="empty-inline">{text('delivery.noRecords')}</p> :
      <div className="table-scroll"><table>
        <thead><tr><th>{text('delivery.playedAt')}</th><th>{text('delivery.sourceLabel')}</th><th>{text('capacity.screen')}</th>
          <th>{text('delivery.campaign')}</th><th>{text('delivery.value')}</th><th /></tr></thead>
        <tbody>{records.items.map(record => <tr key={record.id}>
          <td>{utc(record.playedAt)}{record.externalId && <small>{record.externalId}</small>}</td>
          <td><span className="badge">{text(sourceKey(record.source))}</span>
            {record.voidedAt && <><span className="badge status-cancelled">{text('delivery.voided')}</span><small>{record.voidReason}</small></>}</td>
          <td>{record.screen.code}</td>
          <td>{record.campaign.code}{record.creative && <small>{record.creative.code}</small>}</td>
          <td>{record.impressions !== null ? text('delivery.impressionValue', { value: record.impressions })
            : text('delivery.playoutValue', { value: record.count })}{record.durationSeconds && <small>{record.durationSeconds}s</small>}</td>
          <td>{!record.voidedAt && <button type="button" className="button quiet" disabled={busy} onClick={() => cancel(record)}>{text('delivery.void')}</button>}</td>
        </tr>)}</tbody></table></div>}
    <PageLinks data={records} prev={prev} next={next} />
  </section>;
}
