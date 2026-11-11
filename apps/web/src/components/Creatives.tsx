'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CREATIVE_MAX_BYTES, CREATIVE_MIME_TYPES, CreativeStatus, type CreativeSummary, type OrgRef, type PageResult } from '@protarget/shared';
import type { MessageKey } from '@protarget/i18n';
import { api } from '@/lib/client';
import { uploadCreative, UPLOAD_ABORTED } from '@/lib/upload';
import { RequestError } from '@/lib/client';
import { useText } from './Locale';
import {
  bookingError, ConfirmDialog, CreativeFacts, CreativeStatusBadge, Feedback, ListPager, RejectionReason, Stamp,
} from './campaign-ui';

type Filters = { advertiserId?: string; status?: string; pageSize?: string };
const MIME_BY_EXTENSION: Record<string, string> = { mp4: 'video/mp4', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
function mimeOf(file: File) {
  const byType = (CREATIVE_MIME_TYPES as readonly string[]).includes(file.type) ? file.type : '';
  return byType || MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';
}
const imageDuration = /^[1-9]\d{0,2}(?:\.\d{1,3})?$/;

/** Upload form: client-side pre-checks, then multipart upload with progress. The server stays authoritative. */
export function CreativeUploader({ advertisers, advertiserId, replaces, onDone, onCancel }: {
  advertisers: OrgRef[]; advertiserId?: string; replaces?: CreativeSummary;
  onDone: (creative: CreativeSummary) => void; onCancel?: () => void;
}) {
  const text = useText();
  const fixed = replaces?.advertiserId ?? advertiserId;
  const [selected, setSelected] = useState(fixed ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<MessageKey | ''>('');
  const [result, setResult] = useState<CreativeSummary | null>(null);
  const [formKey, setFormKey] = useState(0);
  const busy = progress !== null;
  const controller = useRef<AbortController | null>(null);
  // Leaving the page aborts a running transfer instead of letting it finish unseen.
  useEffect(() => () => controller.current?.abort(), []);
  const mime = file ? mimeOf(file) : '';
  const isImage = mime === 'image/png' || mime === 'image/jpeg';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(''); setResult(null);
    if (!selected) { setError('creative.error.advertiser'); return; }
    if (!file) { setError('creative.error.file'); return; }
    if (!mime) { setError('creative.error.type'); return; }
    if (file.size > CREATIVE_MAX_BYTES) { setError('creative.error.size'); return; }
    if (file.size === 0) { setError('creative.error.empty'); return; }
    if (isImage && (!imageDuration.test(duration.trim()) || Number(duration) > 300)) { setError('creative.error.duration'); return; }
    const form = new FormData();
    form.set('advertiserId', selected);
    if (isImage) form.set('displayDurationSeconds', duration.trim());
    if (replaces) form.set('replacesId', replaces.id);
    form.set('file', file);
    setProgress(0);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const created = await uploadCreative(form, setProgress, abort.signal);
      setResult(created); setFile(null); setDuration(''); setFormKey(key => key + 1);
      onDone(created);
    } catch (failure) {
      if (abort.signal.aborted || (failure instanceof RequestError && failure.code === UPLOAD_ABORTED)) return;
      setError(bookingError(failure));
    } finally { if (!abort.signal.aborted) setProgress(null); }
  }
  return <form key={formKey} className="form-grid two-columns creative-upload" onSubmit={submit} aria-label={text(replaces ? 'creative.newVersion' : 'creative.upload')}>
    <label>{text('creative.advertiser')}<select name="advertiserId" value={selected} disabled={busy || !!fixed} required onChange={event => setSelected(event.target.value)}>
      <option value="">{text('common.select')}</option>
      {advertisers.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
    </select></label>
    <label>{text('creative.file')}<input name="file" type="file" accept="video/mp4,image/png,image/jpeg,.mp4,.png,.jpg,.jpeg" disabled={busy}
      onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); setResult(null); }} /></label>
    {isImage && <div className="field"><label>{text('creative.displayDuration')}<input name="displayDurationSeconds" inputMode="decimal" value={duration} disabled={busy}
      aria-describedby="duration-hint" onChange={event => setDuration(event.target.value)} /></label>
      <span className="hint" id="duration-hint">{text('creative.displayDurationHint')}</span></div>}
    {file && !isImage && mime && <p className="hint">{text('creative.videoDurationHint')}</p>}
    <p className="hint full">{text('creative.limits')}</p>
    {busy && <div className="full"><progress max={100} value={progress ?? 0} aria-label={text('creative.progress')} />
      <span className="hint"> {text('creative.progressValue', { percent: progress ?? 0 })}</span></div>}
    <Feedback error={error} />
    {result && (result.status === 'REJECTED'
      ? <p role="alert" className="error full">{text('creative.autoRejected')} <RejectionReason reason={result.rejectionReason ?? ''} /></p>
      : <p role="status" className="success full">{text('creative.uploadedValidating', { code: result.code })}</p>)}
    <div className="inventory-actions full">
      <button className="button primary" disabled={busy}>{text(busy ? 'common.working' : replaces ? 'creative.newVersion' : 'creative.upload')}</button>
      {onCancel && <button type="button" className="button quiet" disabled={busy} onClick={onCancel}>{text('common.cancel')}</button>}
    </div>
  </form>;
}

export function CreativePreview({ creative }: { creative: CreativeSummary }) {
  const text = useText();
  const src = `/api/v1/creatives/${creative.id}/file`;
  if (creative.kind === 'VIDEO') return <video className="creative-preview" src={src} controls preload="metadata" aria-label={text('creative.preview')} />;
  if (creative.kind === 'IMAGE') return <img className="creative-preview" src={src} alt={`${text('creative.preview')} ${creative.code}`} />;
  return <p className="hint">{text('creative.noPreview')}</p>;
}

/** Approve / reject panel for a VALIDATING creative; revoke (with a reason dialog) for an APPROVED one. */
export function ReviewActions({ creative, onChange }: { creative: CreativeSummary; onChange: (creative: CreativeSummary) => void }) {
  const text = useText();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<MessageKey | ''>('');
  async function run(path: string, body?: unknown) {
    if (busy) return;
    setBusy(true); setError('');
    try { onChange(await api<CreativeSummary>(`/creatives/${creative.id}/${path}`, { method: 'POST', body })); setRejecting(false); setRevoking(false); setReason(''); }
    catch (failure) { setError(bookingError(failure)); } finally { setBusy(false); }
  }
  function revoke() {
    const value = reason.trim();
    if (!value || value.length > 1000) { setError('creative.error.revokeReason'); return; }
    void run('revoke', { reason: value });
  }
  if (creative.status === CreativeStatus.APPROVED) {
    return <div className="stack-small">
      <div className="inventory-actions"><button type="button" className="button quiet" disabled={busy}
        aria-label={`${text('creative.revoke')} ${creative.code}`} onClick={() => { setError(''); setReason(''); setRevoking(true); }}>{text('creative.revoke')}</button></div>
      {!revoking && <Feedback error={error} />}
      {revoking && <ConfirmDialog title="creative.revokeTitle" confirmLabel="creative.revokeConfirm" busy={busy} error={error}
        onConfirm={revoke} onCancel={() => { setRevoking(false); setError(''); }}>
        <p className="hint">{text('creative.revokeHint')}</p>
        <div className="form-grid"><label>{text('creative.revokeReason')}<textarea name="reason" rows={3} maxLength={1000} autoFocus value={reason}
          onChange={event => setReason(event.target.value)} /></label></div>
      </ConfirmDialog>}
    </div>;
  }
  if (creative.status !== CreativeStatus.VALIDATING) return null;
  return <div className="stack-small">
    <div className="inventory-actions">
      <button type="button" className="button primary" disabled={busy} onClick={() => run('approve')}>{text('creative.approve')}</button>
      <button type="button" className="button quiet" disabled={busy} onClick={() => setRejecting(value => !value)}>{text('creative.reject')}</button>
    </div>
    {rejecting && <form className="form-grid" onSubmit={event => { event.preventDefault(); if (!reason.trim()) { setError('creative.error.reason'); return; } void run('reject', { reason: reason.trim() }); }}>
      <label>{text('creative.rejectReason')}<textarea name="reason" rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div><button className="button primary" disabled={busy}>{text('creative.rejectConfirm')}</button></div>
    </form>}
    <Feedback error={error} />
  </div>;
}

export function Creatives({ data, advertisers, uploadAdvertisers, filters, truncated = false }: {
  data: PageResult<CreativeSummary>; advertisers: OrgRef[]; uploadAdvertisers: OrgRef[]; filters: Filters; truncated?: boolean;
}) {
  const text = useText();
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, CreativeSummary>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [versionFor, setVersionFor] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const names = new Map(advertisers.map(org => [org.id, org.name]));
  const items = data.items.map(item => overrides[item.id] ?? item);
  const open = items.find(item => item.id === openId);
  // Fresh server data supersedes local copies.
  useEffect(() => { setOverrides({}); }, [data]);
  function changed(creative: CreativeSummary) { setOverrides(previous => ({ ...previous, [creative.id]: creative })); router.refresh(); }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = new URLSearchParams({ page: '1' });
    for (const key of ['advertiserId', 'status']) { const value = String(form.get(key) ?? ''); if (value) values.set(key, value); }
    if (filters.pageSize) values.set('pageSize', filters.pageSize);
    router.push(`/admin/creatives?${values}`);
  }
  return <div className="stack inventory creatives">
    {truncated && <p className="notice full" role="note">{text('booking.listTruncated')}</p>}
    <section className="card">
      <div className="section-heading"><h2>{text('creative.upload')}</h2>
        <button type="button" className="button quiet" aria-expanded={showUpload} onClick={() => setShowUpload(value => !value)}>{text(showUpload ? 'common.cancel' : 'creative.upload')}</button></div>
      {showUpload && <CreativeUploader advertisers={uploadAdvertisers} onDone={() => router.refresh()} />}
    </section>
    <form className="card form-grid two-columns inventory-filters" onSubmit={filter} aria-label={text('creative.filters')}>
      <label>{text('creative.advertiser')}<select name="advertiserId" defaultValue={filters.advertiserId ?? ''}>
        <option value="">{text('inventory.all')}</option>
        {advertisers.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
      </select></label>
      <label>{text('field.status')}<select name="status" defaultValue={filters.status ?? ''}>
        <option value="">{text('inventory.all')}</option>
        {Object.values(CreativeStatus).map(status => <option key={status} value={status}>{text(`creative.status.${status}`)}</option>)}
      </select></label>
      <div className="full"><button className="button quiet">{text('inventory.filter')}</button></div>
    </form>
    <section className="card table-card"><div className="table-scroll"><table>
      <caption className="visually-hidden">{text('nav.campaigns.creatives')}</caption>
      <thead><tr><th>{text('creative.code')}</th><th>{text('creative.advertiser')}</th><th>{text('creative.kind')}</th><th>{text('field.status')}</th><th>{text('creative.version')}</th><th>{text('common.actions')}</th></tr></thead>
      <tbody>{items.map(creative => <tr key={creative.id}>
        <td><strong>{creative.code}</strong><small>{creative.originalFilename}</small></td>
        <td>{names.get(creative.advertiserId) ?? creative.advertiserId}</td>
        <td>{creative.kind ? text(`creative.kind.${creative.kind}`) : text('booking.unknown')}
          <small>{creative.width && creative.height ? `${creative.width}×${creative.height}` : text('booking.unknown')}</small></td>
        <td><CreativeStatusBadge status={creative.status} />{creative.rejectionReason && <small><RejectionReason reason={creative.rejectionReason} /></small>}</td>
        <td>v{creative.version}</td>
        <td><button type="button" className="button quiet" aria-expanded={openId === creative.id}
          aria-label={`${text('common.details')} ${creative.code}`} onClick={() => { setOpenId(openId === creative.id ? null : creative.id); setVersionFor(null); }}>{text('common.details')}</button></td>
      </tr>)}</tbody>
    </table></div>{!items.length && <p className="empty-inline">{text('creative.empty')}</p>}
      <ListPager data={data} href="/admin/creatives" filters={filters} />
    </section>
    {open && <section className="card" aria-label={`${text('creative.detail')} ${open.code}`}>
      <div className="section-heading"><h2>{open.code} · v{open.version}</h2><CreativeStatusBadge status={open.status} /></div>
      {open.status !== 'REJECTED' && <CreativePreview creative={open} />}
      <CreativeFacts creative={open} />
      <dl className="inventory-facts">
        <div><dt>{text('creative.uploadedBy')}</dt><dd>{open.uploadedBy?.name ?? text('booking.unknown')}<small> <Stamp value={open.createdAt} zone="UTC" /></small></dd></div>
        {open.approvedBy && open.approvedAt && <div><dt>{text('creative.approvedBy')}</dt><dd>{open.approvedBy.name}<small> <Stamp value={open.approvedAt} zone="UTC" /></small></dd></div>}
      </dl>
      <ReviewActions creative={open} onChange={changed} />
      <div className="inventory-actions">
        <button type="button" className="button quiet" onClick={() => setVersionFor(versionFor === open.id ? null : open.id)}>{text('creative.newVersion')}</button>
      </div>
      {versionFor === open.id && <CreativeUploader advertisers={uploadAdvertisers} replaces={open} onDone={() => router.refresh()} onCancel={() => setVersionFor(null)} />}
    </section>}
  </div>;
}
