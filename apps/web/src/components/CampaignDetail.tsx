'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BOOKING_PLAN_EDITABLE, BOOKING_REASON_REQUIRED, BOOKING_TRANSITIONS, CmsOperationType, isBookingStatus,
  type BookingStatus, type CampaignDetail, type CampaignValidation, type CreativeSummary, type CmsOperation, type CmsOperationPage, type PageResult,
} from '@protarget/shared';
import type { MessageKey } from '@protarget/i18n';
import { api, RequestError } from '@/lib/client';
import { localInputToUtc, minuteOf, nowLocalInput, utcToLocalInput } from '@/lib/zone';
import { useText } from './Locale';
import {
  bookingError, BookingStatusBadge, ButtonPager, CmsStateBadge, ConfirmDialog, CreativeFacts, CreativeStatusBadge, Feedback, OperatorNote,
  ScreenCells, ScreenHeadCells, Stamp, Unknown,
} from './campaign-ui';
import { campaignBase, ScheduleTable, ValidationPanel } from './Campaigns';
import { CreativePreview } from './Creatives';

const TABS = ['general', 'screens', 'creatives', 'schedule', 'cms', 'activity'] as const;
type Tab = (typeof TABS)[number];
type ActivityItem = { id: string; action: string; user: { id: string; name: string } | null; timestamp: string; metadata: unknown };

export function CampaignDetailView({ initial }: { initial: CampaignDetail }) {
  const text = useText();
  const router = useRouter();
  const [campaign, setCampaign] = useState(initial);
  const [tab, setTab] = useState<Tab>('general');
  const [validation, setValidation] = useState<CampaignValidation | null>(null);
  const [pending, setPending] = useState<BookingStatus | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const [notice, setNotice] = useState('');
  const [archiving, setArchiving] = useState(false);
  const status = isBookingStatus(campaign.status) ? campaign.status : undefined;
  const terminal = status === 'COMPLETED' || status === 'CANCELLED';
  const refreshValidation = useCallback(async () => {
    if (terminal) { setValidation(null); return; }
    try { setValidation(await api<CampaignValidation>(`/campaigns/${campaign.id}/validation`)); } catch (failure) { setError(bookingError(failure)); }
  }, [campaign.id, terminal]);
  const reloadCampaign = useCallback(async () => {
    try { setCampaign(await api<CampaignDetail>(`/campaigns/${campaign.id}`)); } catch (failure) { setError(bookingError(failure)); }
  }, [campaign.id]);
  useEffect(() => { void refreshValidation(); }, [refreshValidation, campaign.updatedAt, campaign.status]);
  const blockers = validation?.blockers.length ?? 0;
  const missingCms = validation?.missingCmsUpload ?? [];
  function disabledReason(to: BookingStatus): MessageKey | null {
    if (to === 'READY' || to === 'LIVE') {
      if (!validation) return 'common.working';
      if (blockers) return 'booking.readyBlocked';
      if (to === 'LIVE' && missingCms.length) return 'booking.liveBlockedCms';
    }
    return null;
  }
  async function transition(to: BookingStatus) {
    if (busy || !status) return;
    const needsReason = (BOOKING_REASON_REQUIRED as readonly string[]).includes(`${status}>${to}`);
    if (needsReason && !reason.trim()) { setError('booking.error.reason'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      setCampaign(await api<CampaignDetail>(`/campaigns/${campaign.id}/transitions`, {
        method: 'POST', body: needsReason ? { to, reason: reason.trim() } : { to },
      }));
      setPending(null); setReason(''); router.refresh();
    } catch (failure) {
      if (failure instanceof RequestError && failure.code === 'CAMPAIGN_NOT_READY') void refreshValidation();
      if (failure instanceof RequestError && failure.status === 409) {
        // Someone else moved the booking (or the plan changed): show the real state and drop the stale dialog.
        setPending(null); setReason('');
        await reloadCampaign(); void refreshValidation(); router.refresh();
      }
      setError(bookingError(failure));
    } finally { setBusy(false); }
  }
  function request(to: BookingStatus) {
    if (!status) return;
    setError('');
    if ((BOOKING_REASON_REQUIRED as readonly string[]).includes(`${status}>${to}`)) { setPending(to); setReason(''); } else void transition(to);
  }
  async function archive() {
    if (busy) return;
    setBusy(true); setError('');
    try { await api(`/campaigns/${campaign.id}/archive`, { method: 'POST' }); router.push(campaignBase); }
    catch (failure) {
      setError(bookingError(failure)); setBusy(false); setArchiving(false);
      if (failure instanceof RequestError && failure.status === 409) { await reloadCampaign(); void refreshValidation(); router.refresh(); }
    }
  }
  const actions = status ? BOOKING_TRANSITIONS[status] : [];
  const editable = !!status && (BOOKING_PLAN_EDITABLE as readonly string[]).includes(status);
  return <div className="stack inventory campaign-detail">
    <div className="inventory-actions"><Link className="button quiet" href={campaignBase}>{text('booking.backList')}</Link>
      {editable && <Link className="button quiet" href={`${campaignBase}/${campaign.id}/edit`}>{text('booking.editWizard')}</Link>}
      {status === 'DRAFT' && <button type="button" className="button quiet" disabled={busy} onClick={() => { setError(''); setArchiving(true); }}>{text('booking.archive')}</button>}</div>
    {archiving && <ConfirmDialog title="booking.archiveTitle" confirmLabel="booking.archive" busy={busy} error={error} onConfirm={() => void archive()} onCancel={() => setArchiving(false)}>
      <p>{text('booking.archiveText')}</p></ConfirmDialog>}
    <section className="card status-card" aria-label={text('field.status')}>
      <div className="section-heading"><h2><BookingStatusBadge status={campaign.status} flightEnded={campaign.flightEnded} /></h2></div>
      {(status === 'LIVE' || status === 'PAUSED') && <OperatorNote />}
      {campaign.flightEnded && <p className="notice" role="note">{text('booking.flightEndedHint')}</p>}
      {terminal && <p className="hint">{text('common.readOnly')}</p>}
      <div className="inventory-actions status-actions">{actions.map(to => {
        const blocked = disabledReason(to);
        return <button key={to} type="button" className={`button ${to === 'CANCELLED' ? 'quiet' : 'primary'}`} disabled={busy || !!blocked}
          title={blocked ? text(blocked) : undefined} onClick={() => request(to)}>{text(`booking.action.${to}`)}</button>;
      })}</div>
      {actions.some(to => disabledReason(to) && disabledReason(to) !== 'common.working') && <p className="hint" role="status">
        {blockers ? text('booking.readyBlocked') : text('booking.liveBlockedCms')}{!blockers && missingCms.length > 0 && <> <small>{missingCms.join(', ')}</small></>}</p>}
      {pending && <div className="dialog-backdrop"><div className="dialog card" role="dialog" aria-modal="true" aria-label={text('booking.reasonTitle')}>
        <h2>{text('booking.reasonTitle')}</h2>
        {(pending === 'LIVE' || pending === 'PAUSED') && <OperatorNote />}
        {(pending === 'PAUSED' || (pending === 'LIVE' && status === 'PAUSED')) && <DeclarationWarning campaign={campaign}
          expected={pending === 'PAUSED' ? 'PLAYBACK_PAUSED' : 'PLAYBACK_RESUMED'} />}
        <form className="form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); void transition(pending); }}>
          <label>{text('booking.reason')}<textarea name="reason" rows={3} maxLength={1000} autoFocus value={reason} onChange={event => setReason(event.target.value)} /></label>
          <div className="inventory-actions"><button className="button primary" disabled={busy}>{text(busy ? 'common.working' : `booking.action.${pending}`)}</button>
            <button type="button" className="button quiet" disabled={busy} onClick={() => setPending(null)}>{text('common.cancel')}</button></div>
          <Feedback error={error} />
        </form></div></div>}
      {!pending && !archiving && <Feedback error={error} message={notice ? 'common.saved' : ''} />}
    </section>
    <div className="tabs" role="tablist" aria-label={text('booking.tabs')}>{TABS.map(name =>
      <button key={name} type="button" role="tab" id={`tab-${name}`} aria-selected={tab === name} aria-controls={`panel-${name}`}
        className={`tab ${tab === name ? 'active' : ''}`} onClick={() => setTab(name)}>{text(`booking.tab.${name}`)}</button>)}</div>
    <section className="card" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === 'general' && <General campaign={campaign} validation={validation} terminal={terminal}
        limited={status === 'LIVE' || status === 'PAUSED'} onSaved={value => { setCampaign(value); setNotice('saved'); }} />}
      {tab === 'screens' && <ScreensTab campaign={campaign} />}
      {tab === 'creatives' && <CreativesTab campaign={campaign} canUnlinkRevoked={status === 'LIVE' || status === 'PAUSED' || editable} onChange={setCampaign} />}
      {tab === 'schedule' && <><h2>{text('booking.tab.schedule')}</h2><ScheduleTable schedule={campaign.schedule} timezone={campaign.timezone} /></>}
      {tab === 'cms' && <CmsTab campaign={campaign} readOnly={terminal} onRecorded={() => { void refreshValidation(); void reloadCampaign(); }} />}
      {tab === 'activity' && <ActivityTab campaign={campaign} />}
    </section>
  </div>;
}

/** Screens whose last CMS record is not the one this declaration would normally follow (a warning, never a block). */
function DeclarationWarning({ campaign, expected }: { campaign: CampaignDetail; expected: CmsOperationType }) {
  const text = useText();
  const lacking = campaign.screens.filter(row => row.active && row.lastCmsOperation?.type !== expected);
  if (!lacking.length) return null;
  return <div className="notice" role="note" data-testid="declaration-warning">
    <p>{text(expected === 'PLAYBACK_PAUSED' ? 'booking.pauseWarning' : 'booking.resumeWarning')}</p>
    <ul className="plain-list">{lacking.map(row => <li key={row.screenId} data-screen={row.code}><strong>{row.code}</strong> <small>{row.name}</small></li>)}</ul>
  </div>;
}
function Fact({ label, children }: { label: MessageKey; children: ReactNode }) {
  const text = useText();
  return <div><dt>{text(label)}</dt><dd>{children}</dd></div>;
}
function General({ campaign, validation, terminal, limited, onSaved }: {
  campaign: CampaignDetail; validation: CampaignValidation | null; terminal: boolean; limited: boolean; onSaved: (value: CampaignDetail) => void;
}) {
  const text = useText();
  const c = campaign.commercial;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const [end, setEnd] = useState(utcToLocalInput(campaign.endAt, campaign.timezone));
  const initialEnd = utcToLocalInput(campaign.endAt, campaign.timezone);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const notes = String(form.get('notes') ?? '').trim() || null;
    const endUtc = localInputToUtc(end, campaign.timezone);
    setError('');
    if (!endUtc) { setError('booking.error.dates'); return; }
    const patch: Record<string, unknown> = {};
    if (notes !== campaign.notes) patch.notes = notes;
    // Minutes only: the stored value may carry seconds the input cannot show, so only an edited input counts as a change.
    if (end !== initialEnd && minuteOf(endUtc) !== minuteOf(campaign.endAt)) {
      if (minuteOf(endUtc) < minuteOf(campaign.endAt)) { setError('booking.error.extendOnly'); return; }
      patch.endAt = endUtc;
    }
    if (!Object.keys(patch).length) { setError('inventory.noChanges'); return; }
    setBusy(true);
    try { onSaved(await api<CampaignDetail>(`/campaigns/${campaign.id}`, { method: 'PATCH', body: patch })); }
    catch (failure) { setError(bookingError(failure)); } finally { setBusy(false); }
  }
  return <div className="stack">
    <dl className="inventory-facts">
      <Fact label="booking.advertiser">{campaign.advertiser.name}</Fact>
      <Fact label="booking.agency"><Unknown value={campaign.agency?.name} fallback="booking.noAgency" /></Fact>
      <Fact label="booking.owner">{campaign.internalOwner.name}</Fact>
      <Fact label="booking.timezone">{campaign.timezone}</Fact>
      <Fact label="booking.startAt"><Stamp value={campaign.startAt} zone={campaign.timezone} /></Fact>
      <Fact label="booking.endAt"><Stamp value={campaign.endAt} zone={campaign.timezone} /></Fact>
      <Fact label="booking.primaryGoal">{campaign.primaryGoal ? text(`booking.goal.${campaign.primaryGoal}`) : text('booking.unknown')}</Fact>
      <Fact label="booking.targetPlayouts"><Unknown value={campaign.targetPlayouts} suffix={campaign.targetPlayouts ? ` ${text('booking.playouts')}` : ''} /></Fact>
      <Fact label="booking.targetImpressions"><Unknown value={campaign.targetImpressions} suffix={campaign.targetImpressions ? ` ${text('booking.impressions')}` : ''} /></Fact>
      <Fact label="booking.maxPerHour"><Unknown value={campaign.maxPlayoutsPerHourPerScreen} /></Fact>
      <Fact label="booking.pricingModel">{c.pricingModel ? text(`booking.pricing.${c.pricingModel}`) : text('booking.commercialEmpty')}</Fact>
      {c.pricingModel && <>
        <Fact label="booking.unitPrice"><Unknown value={c.unitPrice && `${c.unitPrice} ${c.currency}`} /></Fact>
        <Fact label="booking.budget"><Unknown value={c.budget && `${c.budget} ${c.currency}`} /></Fact>
        <Fact label="booking.contractedAmount"><Unknown value={c.contractedAmount && `${c.contractedAmount} ${c.currency}`} /></Fact>
        <Fact label="booking.guaranteedImpressions"><Unknown value={c.guaranteedImpressions} /></Fact>
        <Fact label="booking.contractedQuantity"><Unknown value={c.contractedQuantity} /></Fact>
        <Fact label="booking.overdelivery">{c.overdeliveryTolerancePct}%</Fact>
        <Fact label="booking.publisherShare"><Unknown value={c.publisherSharePct && `${c.publisherSharePct}%`} /></Fact>
        <Fact label="booking.protargetShare"><Unknown value={c.protargetSharePct && `${c.protargetSharePct}%`} /></Fact>
      </>}
      <Fact label="inventory.createdAt"><Stamp value={campaign.createdAt} zone={campaign.timezone} /></Fact>
      {campaign.launchedAt && <Fact label="booking.launchedAt"><Stamp value={campaign.launchedAt} zone={campaign.timezone} /> <OperatorNote inline /></Fact>}
      {campaign.completedAt && <Fact label="booking.completedAt"><Stamp value={campaign.completedAt} zone={campaign.timezone} /></Fact>}
    </dl>
    {limited && <form onSubmit={save}><fieldset disabled={busy} className="form-grid two-columns">
      <p className="hint full">{text('booking.limitedEdit')}</p>
      <label className="full">{text('inventory.notes')}<textarea name="notes" rows={3} maxLength={2000} defaultValue={campaign.notes ?? ''} /></label>
      <label>{text('booking.endAt')}<input type="datetime-local" required value={end} onChange={event => setEnd(event.target.value)} /></label>
      <Feedback error={error} />
      <div><button className="button primary">{text(busy ? 'common.working' : 'common.save')}</button></div>
    </fieldset></form>}
    {!limited && <div><h3>{text('inventory.notes')}</h3><p className="notes">{campaign.notes || <span className="muted">{text('booking.notEntered')}</span>}</p></div>}
    {!terminal && <div><h2>{text('booking.validation')}</h2><ValidationPanel validation={validation} showCms /></div>}
  </div>;
}

function ScreensTab({ campaign }: { campaign: CampaignDetail }) {
  const text = useText();
  return <div className="table-scroll"><table>
    <caption className="visually-hidden">{text('booking.tab.screens')}</caption>
    <thead><tr><th>{text('booking.screen')}</th><ScreenHeadCells /><th>{text('booking.cmsState')}</th></tr></thead>
    <tbody>{campaign.screens.map(row => <tr key={row.screenId} data-screen={row.code}>
      <td><strong>{row.code}</strong><small>{row.name}</small></td><ScreenCells row={row} />
      <td><CmsStateBadge row={row} /></td>
    </tr>)}</tbody></table>
    {!campaign.screens.length && <p className="empty-inline">{text('booking.noScreens')}</p>}</div>;
}
function CreativesTab({ campaign, canUnlinkRevoked, onChange }: { campaign: CampaignDetail; canUnlinkRevoked: boolean; onChange: (value: CampaignDetail) => void }) {
  const text = useText();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  // A revoked creative is the one thing that may be unlinked even while the plan is otherwise locked (LIVE/PAUSED).
  async function unlink(creative: CreativeSummary) {
    if (busy) return;
    setBusy(true); setError('');
    try { onChange(await api<CampaignDetail>(`/campaigns/${campaign.id}/creatives/remove`, { method: 'POST', body: { creativeId: creative.id } })); }
    catch (failure) { setError(bookingError(failure)); } finally { setBusy(false); }
  }
  return <div className="stack"><Feedback error={error} />{campaign.creatives.map(creative => <article key={creative.id} className="creative-row" data-creative={creative.code}>
    <div className="section-heading"><h3>{creative.code} <small>{creative.originalFilename}</small></h3><CreativeStatusBadge status={creative.status} /></div>
    {creative.status === 'REVOKED' && <p className="notice" role="note">{text('creative.revokedNotice')}</p>}
    <CreativeFacts creative={creative} />
    <div className="inventory-actions">
      {creative.status !== 'REJECTED' && <button type="button" className="button quiet" aria-expanded={open === creative.id}
        onClick={() => setOpen(open === creative.id ? null : creative.id)}>{text('creative.preview')}</button>}
      {creative.status === 'REVOKED' && canUnlinkRevoked && <button type="button" className="button primary" disabled={busy}
        aria-label={`${text('booking.unlink')} ${creative.code}`} onClick={() => unlink(creative)}>{text('booking.unlink')}</button>}
    </div>
    {open === creative.id && <CreativePreview creative={creative} />}
  </article>)}
    {!campaign.creatives.length && <p className="empty-inline">{text('creative.empty')}</p>}</div>;
}

function CmsTab({ campaign, readOnly, onRecorded }: { campaign: CampaignDetail; readOnly: boolean; onRecorded: () => void }) {
  const text = useText();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CmsOperationPage | null>(null);
  const [performed, setPerformed] = useState(() => nowLocalInput(campaign.timezone, campaign.createdAt));
  const [chosenType, setChosenType] = useState<CmsOperationType>('CMS_UPLOADED');
  // Upload/playback declarations need an active booking; a draft only accepts notes (G1).
  const draft = campaign.status === 'DRAFT';
  const types = draft ? [CmsOperationType.NOTE] : Object.values(CmsOperationType);
  const type = types.includes(chosenType) ? chosenType : types[0];
  const stale = campaign.screens.filter(row => row.cmsUploadStale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const [message, setMessage] = useState<MessageKey | ''>('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    api<CmsOperationPage>(`/campaigns/${campaign.id}/cms-operations?page=${page}&pageSize=10`)
      .then(result => { if (live) setData(result); }).catch(failure => { if (live) setError(bookingError(failure)); });
    return () => { live = false; };
  }, [campaign.id, page, reload]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const performedAt = localInputToUtc(performed, campaign.timezone);
    setError(''); setMessage('');
    if (!String(form.get('screenId'))) { setError('booking.error.screen'); return; }
    if (!performedAt) { setError('booking.error.dates'); return; }
    if (new Date(performedAt).getTime() > Date.now() + 60_000) { setError('booking.error.future'); return; }
    if (new Date(performedAt).getTime() < new Date(campaign.createdAt).getTime()) { setError('booking.error.cmsBeforeBooking'); return; }
    if (type === 'NOTE' && !String(form.get('note') ?? '').trim()) { setError('booking.error.noteRequired'); return; }
    setBusy(true);
    try {
      await api<CmsOperation>(`/campaigns/${campaign.id}/cms-operations`, { method: 'POST', body: {
        screenId: String(form.get('screenId')), type, performedAt,
        cmsReference: String(form.get('cmsReference') ?? '').trim() || null, note: String(form.get('note') ?? '').trim() || null,
      } });
      setMessage('booking.cmsRecorded'); setPerformed(nowLocalInput(campaign.timezone, campaign.createdAt)); formElement.reset();
      setPage(1); setReload(value => value + 1); onRecorded();
    } catch (failure) {
      setError(bookingError(failure, 'cms'));
      if (failure instanceof RequestError && failure.status === 409) onRecorded(); // the booking changed underneath: reload it
    } finally { setBusy(false); }
  }
  return <div className="stack">
    <OperatorNote />
    <h2>{text('booking.cmsChecklist')}</h2>
    {stale.length > 0 && <p className="notice" role="note" data-testid="cms-stale">{text('booking.cmsStaleHint')} <small>{stale.map(row => row.code).join(', ')}</small></p>}
    <div className="table-scroll"><table>
      <caption className="visually-hidden">{text('booking.cmsChecklist')}</caption>
      <thead><tr><th>{text('booking.screen')}</th><th>{text('booking.cmsState')}</th><th>{text('booking.cmsLast')}</th></tr></thead>
      <tbody>{campaign.screens.map(row => <tr key={row.screenId} data-screen={row.code}>
        <td><strong>{row.code}</strong><small>{row.name}</small></td>
        <td><CmsStateBadge row={row} /></td>
        <td>{row.lastCmsOperation ? <>{text(`cms.type.${row.lastCmsOperation.type}`)}<small><Stamp value={row.lastCmsOperation.performedAt} zone={campaign.timezone} /></small></>
          : <span className="muted">{text('booking.cmsNone')}</span>}</td></tr>)}</tbody></table>
      {!campaign.screens.length && <p className="empty-inline">{text('booking.noScreens')}</p>}</div>
    {!readOnly && <form onSubmit={submit} aria-label={text('booking.cmsRecord')}><fieldset disabled={busy || !campaign.screens.length} className="form-grid two-columns">
      <h3 className="full">{text('booking.cmsRecord')}</h3>
      <label>{text('booking.screen')}<select name="screenId" required defaultValue="">
        <option value="">{text('common.select')}</option>{campaign.screens.map(row => <option key={row.screenId} value={row.screenId}>{row.code} · {row.name}</option>)}</select></label>
      <label>{text('booking.cmsType')}<select name="type" value={type} onChange={event => setChosenType(event.target.value as CmsOperationType)}>
        {types.map(item => <option key={item} value={item}>{text(`cms.type.${item}`)}</option>)}</select></label>
      <label>{text('booking.cmsPerformedAt', { zone: campaign.timezone })}<input type="datetime-local" required value={performed} onChange={event => setPerformed(event.target.value)} /></label>
      <label>{text('booking.cmsReference')}<input name="cmsReference" maxLength={300} /></label>
      <label className="full">{text('booking.cmsNote')}<textarea name="note" rows={2} maxLength={2000} required={type === 'NOTE'} /></label>
      <p className="hint full">{text('booking.cmsTimeHint')}</p>
      {draft && <p className="hint full">{text('booking.cmsDraftHint')}</p>}
      <p className="hint full">{text('booking.cmsAppendOnly')}</p>
      <Feedback error={error} message={message} />
      <div><button className="button primary">{text(busy ? 'common.working' : 'booking.cmsSubmit')}</button></div>
    </fieldset></form>}
    <h2>{text('booking.cmsHistory')}</h2>
    <div className="table-scroll"><table>
      <caption className="visually-hidden">{text('booking.cmsHistory')}</caption>
      <thead><tr><th>{text('booking.screen')}</th><th>{text('booking.cmsType')}</th><th>{text('booking.cmsWhen')}</th><th>{text('booking.cmsActor')}</th></tr></thead>
      <tbody>{(data?.items ?? []).map(operation => <tr key={operation.id} data-operation={operation.type}>
        <td><strong>{operation.screenCode}</strong></td>
        <td>{text(`cms.type.${operation.type}`)}<OperatorNote inline />
          {operation.cmsReference && <small>{text('booking.cmsReference')}: {operation.cmsReference}</small>}{operation.note && <small>{operation.note}</small>}</td>
        <td><Stamp value={operation.performedAt} zone={campaign.timezone} /><small>{text('booking.cmsRecordedAt')}: <Stamp value={operation.recordedAt} zone={campaign.timezone} /></small></td>
        <td>{operation.actor.name}</td></tr>)}</tbody></table>
      {data && !data.items.length && <p className="empty-inline">{text('booking.cmsNone')}</p>}</div>
    {data && <ButtonPager data={data} onPage={setPage} />}
  </div>;
}

const ACTIVITY_FIELDS: Record<string, MessageKey> = {
  name: 'field.name', advertiserId: 'booking.advertiser', agencyId: 'booking.agency', internalOwnerId: 'booking.owner', timezone: 'booking.timezone',
  startAt: 'booking.startAt', endAt: 'booking.endAt', notes: 'inventory.notes', pricingModel: 'booking.pricingModel', currency: 'booking.currency',
  unitPrice: 'booking.unitPrice', budget: 'booking.budget', contractedAmount: 'booking.contractedAmount', guaranteedImpressions: 'booking.guaranteedImpressions',
  contractedQuantity: 'booking.contractedQuantity', overdeliveryTolerancePct: 'booking.overdelivery', pgBillingBasis: 'booking.pgBasis',
  publisherSharePct: 'booking.publisherShare', protargetSharePct: 'booking.protargetShare', primaryGoal: 'booking.primaryGoal',
  targetPlayouts: 'booking.targetPlayouts', targetImpressions: 'booking.targetImpressions', maxPlayoutsPerHourPerScreen: 'booking.maxPerHour',
};
const META_KEYS = ['reason', 'fields', 'added', 'screens', 'creativeId', 'code', 'automatic', 'declaration', 'screensWithoutMatchingCmsRecord'] as const;
const META_VALUES = ['PLAN_CHANGED', 'CREATIVE_REVOKED', 'OPERATOR_DECLARED'] as const;
const ACTIVITY_ACTIONS = ['CAMPAIGN_CREATED', 'CAMPAIGN_UPDATED', 'CAMPAIGN_DELETED', 'CAMPAIGN_SCREENS_ADDED', 'CAMPAIGN_SCREENS_REMOVED',
  'CAMPAIGN_CREATIVE_LINKED', 'CAMPAIGN_CREATIVE_UNLINKED', 'CAMPAIGN_CREATIVE_REVOKED', 'CAMPAIGN_SCHEDULE_REPLACED', 'CAMPAIGN_STATUS_CHANGED',
  'CAMPAIGN_CMS_OPERATION_RECORDED'] as const;
const known = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);

/** Audit metadata as readable key/value rows; ids that mean nothing to an operator are shown as counts. */
function ActivityMetadata({ metadata }: { metadata: unknown }) {
  const text = useText();
  if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const entries = Object.entries(metadata as Record<string, unknown>).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!entries.length) return null;
  const render = (key: string, value: unknown): ReactNode => {
    if (typeof value === 'boolean') return text(value ? 'booking.yes' : 'booking.no');
    if (key === 'screens' && Array.isArray(value)) return value.length;
    if (key === 'fields' && Array.isArray(value)) return value.map(item => known(Object.keys(ACTIVITY_FIELDS), item) ? text(ACTIVITY_FIELDS[item]) : String(item)).join(', ');
    if (Array.isArray(value)) return value.map(String).join(', ');
    if (known(META_VALUES, value)) return text(`booking.metaValue.${value}`);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };
  return <details><summary>{text('booking.activityDetails')}</summary>
    <dl className="activity-meta">{entries.map(([key, value]) => <div key={key}>
      <dt>{known(META_KEYS, key) ? text(`booking.meta.${key}`) : key}</dt><dd>{render(key, value)}</dd></div>)}</dl></details>;
}

function ActivityTab({ campaign }: { campaign: CampaignDetail }) {
  const text = useText();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageResult<ActivityItem> | null>(null);
  const [error, setError] = useState<MessageKey | ''>('');
  useEffect(() => {
    let live = true;
    api<PageResult<ActivityItem>>(`/campaigns/${campaign.id}/activity?page=${page}&pageSize=10`)
      .then(result => { if (live) setData(result); }).catch(failure => { if (live) setError(bookingError(failure)); });
    return () => { live = false; };
  }, [campaign.id, page, campaign.updatedAt]);
  return <div className="stack">
    <Feedback error={error} />
    <div className="table-scroll"><table>
      <caption className="visually-hidden">{text('booking.tab.activity')}</caption>
      <thead><tr><th>{text('booking.cmsWhen')}</th><th>{text('booking.activityAction')}</th><th>{text('booking.cmsActor')}</th></tr></thead>
      <tbody>{(data?.items ?? []).map(item => <tr key={item.id} data-action={item.action}>
        <td><Stamp value={item.timestamp} zone={campaign.timezone} /></td>
        <td>{known(ACTIVITY_ACTIONS, item.action) ? text(`booking.activity.${item.action}`) : <code>{item.action}</code>}<ActivityMetadata metadata={item.metadata} /></td>
        <td>{item.user?.name ?? text('booking.unknown')}</td></tr>)}</tbody></table>
      {data && !data.items.length && <p className="empty-inline">{text('common.empty')}</p>}</div>
    {data && <ButtonPager data={data} onPage={setPage} />}
  </div>;
}
