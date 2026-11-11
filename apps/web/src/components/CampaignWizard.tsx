'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CampaignGoal, Currency, PricingModel, type CampaignDetail, type CampaignScreenRow, type CampaignValidation, type CreativePage,
  type CreativeSummary, type OrgRef, type PageResult, type ScheduleSlot,
} from '@protarget/shared';
import type { MessageKey } from '@protarget/i18n';
import { api } from '@/lib/client';
import { localInputToUtc, utcToLocalInput, validZone } from '@/lib/zone';
import { useText } from './Locale';
import {
  bookingError, ButtonPager, BookingStatusBadge, CreativeFacts, CreativeStatusBadge, Feedback, ScreenCells, ScreenHeadCells,
} from './campaign-ui';
import { ValidationPanel, campaignBase } from './Campaigns';
import { CreativeUploader, ReviewActions } from './Creatives';

type Option = { id: string; name: string };
type Venue = { id: string; name: string; city: string };
type ScreenOption = CampaignScreenRow & { selected: boolean };
const STEPS = ['basic', 'screens', 'commercial', 'creatives', 'schedule', 'summary'] as const;
const money = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
const count = /^[1-9]\d{0,17}$/;
const percent = /^(?:100(?:\.0{1,2})?|[1-9]?\d(?:\.\d{1,2})?)$/;
const hhmm = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

interface Props { initial?: CampaignDetail; advertisers: Option[]; agencies: Option[]; owners: Option[]; venues: Venue[] }

export function CampaignWizard({ initial, advertisers, agencies, owners, venues }: Props) {
  const text = useText();
  const [campaign, setCampaign] = useState<CampaignDetail | undefined>(initial);
  const [step, setStep] = useState(0);
  const go = (next: number) => { setStep(next); document.getElementById('wizard-top')?.scrollIntoView({ block: 'start' }); };
  const saved = useCallback((value: CampaignDetail) => setCampaign(value), []);
  return <div className="stack inventory wizard" id="wizard-top">
    <section className="card">
      <div className="section-heading"><h2>{campaign ? `${campaign.code} · ${campaign.name}` : text('booking.wizardTitle')}</h2>
        {campaign && <span><BookingStatusBadge status={campaign.status} /></span>}</div>
      <p className="hint">{text('booking.wizardHint')}</p>
      {campaign?.status === 'READY' && <p className="notice" role="note">{text('booking.readyEditWarning')}</p>}
      <ol className="stepper" aria-label={text('booking.steps')}>{STEPS.map((name, index) => <li key={name}>
        <button type="button" className="step" aria-current={index === step ? 'step' : undefined} disabled={!campaign && index > 0}
          onClick={() => go(index)}><span aria-hidden="true">{index + 1}</span> {text(`booking.step.${name}`)}</button></li>)}</ol>
    </section>
    {step === 0 && <BasicStep campaign={campaign} advertisers={advertisers} agencies={agencies} owners={owners}
      onSaved={value => { saved(value); window.history.replaceState(null, '', `${campaignBase}/${value.id}/edit`); go(1); }} />}
    {campaign && step === 1 && <ScreensStep campaign={campaign} venues={venues} onChange={saved} onNext={() => go(2)} onBack={() => go(0)} />}
    {campaign && step === 2 && <CommercialStep campaign={campaign} onSaved={value => { saved(value); go(3); }} onBack={() => go(1)} />}
    {campaign && step === 3 && <CreativesStep campaign={campaign} onChange={saved} onNext={() => go(4)} onBack={() => go(2)} />}
    {campaign && step === 4 && <ScheduleStep campaign={campaign} onSaved={value => { saved(value); go(5); }} onBack={() => go(3)} />}
    {campaign && step === 5 && <SummaryStep campaign={campaign} onChange={saved} onBack={() => go(4)} />}
  </div>;
}

function StepActions({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  const text = useText();
  return <div className="inventory-actions step-actions">
    {onBack && <button type="button" className="button quiet" onClick={onBack}>{text('booking.back')}</button>}{children}</div>;
}

function BasicStep({ campaign, advertisers, agencies, owners, onSaved }: {
  campaign?: CampaignDetail; advertisers: Option[]; agencies: Option[]; owners: Option[]; onSaved: (value: CampaignDetail) => void;
}) {
  const text = useText();
  const [zone, setZone] = useState(campaign?.timezone ?? 'Europe/Istanbul');
  const [start, setStart] = useState(campaign ? utcToLocalInput(campaign.startAt, campaign.timezone) : '');
  const [end, setEnd] = useState(campaign ? utcToLocalInput(campaign.endAt, campaign.timezone) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const startUtc = validZone(zone) ? localInputToUtc(start, zone) : null;
  const endUtc = validZone(zone) ? localInputToUtc(end, zone) : null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const body = {
      name: field(form, 'name'), advertiserId: field(form, 'advertiserId'), agencyId: field(form, 'agencyId') || null,
      internalOwnerId: field(form, 'internalOwnerId'), timezone: zone.trim(), notes: field(form, 'notes') || null,
    };
    setError('');
    if (body.name.length < 3 || body.name.length > 150) { setError('booking.error.name'); return; }
    if (!body.advertiserId || !body.internalOwnerId) { setError('booking.error.required'); return; }
    if (!validZone(body.timezone)) { setError('inventory.error.timezone'); return; }
    if (!startUtc || !endUtc) { setError('booking.error.dates'); return; }
    if (new Date(startUtc) >= new Date(endUtc)) { setError('booking.error.flight'); return; }
    setBusy(true);
    try {
      if (!campaign) { onSaved(await api<CampaignDetail>('/campaigns', { method: 'POST', body: { ...body, startAt: startUtc, endAt: endUtc } })); return; }
      const patch: Record<string, unknown> = {};
      if (body.name !== campaign.name) patch.name = body.name;
      if (body.advertiserId !== campaign.advertiser.id) patch.advertiserId = body.advertiserId;
      if (body.agencyId !== (campaign.agency?.id ?? null)) patch.agencyId = body.agencyId;
      if (body.internalOwnerId !== campaign.internalOwner.id) patch.internalOwnerId = body.internalOwnerId;
      if (body.timezone !== campaign.timezone) patch.timezone = body.timezone;
      if (body.notes !== campaign.notes) patch.notes = body.notes;
      if (new Date(startUtc).getTime() !== new Date(campaign.startAt).getTime()) patch.startAt = startUtc;
      if (new Date(endUtc).getTime() !== new Date(campaign.endAt).getTime()) patch.endAt = endUtc;
      onSaved(Object.keys(patch).length ? await api<CampaignDetail>(`/campaigns/${campaign.id}`, { method: 'PATCH', body: patch }) : campaign);
    } catch (failure) { setError(bookingError(failure)); } finally { setBusy(false); }
  }
  return <section className="card" aria-label={text('booking.step.basic')}>
    <h2>{text('booking.step.basic')}</h2>
    <form onSubmit={submit}><fieldset disabled={busy} className="form-grid two-columns">
      <label className="full">{text('field.name')}<input name="name" required minLength={3} maxLength={150} defaultValue={campaign?.name} /></label>
      <label>{text('booking.advertiser')}<select name="advertiserId" required defaultValue={campaign?.advertiser.id ?? ''}>
        <option value="">{text('common.select')}</option>{advertisers.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
      <label>{text('booking.agency')}<select name="agencyId" defaultValue={campaign?.agency?.id ?? ''}>
        <option value="">{text('booking.noAgency')}</option>{agencies.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
      <label>{text('booking.owner')}<select name="internalOwnerId" required defaultValue={campaign?.internalOwner.id ?? ''}>
        <option value="">{text('common.select')}</option>{owners.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
      <label>{text('booking.timezone')}<input name="timezone" required maxLength={100} value={zone} onChange={event => setZone(event.target.value)} /></label>
      <label>{text('booking.startAt')}<input name="start" type="datetime-local" required value={start} onChange={event => setStart(event.target.value)} /></label>
      <label>{text('booking.endAt')}<input name="end" type="datetime-local" required value={end} onChange={event => setEnd(event.target.value)} /></label>
      <p className="hint full">{text('booking.flightHint', { zone })}{startUtc && endUtc && <> {text('booking.utcPreview', { start: startUtc, end: endUtc })}</>}</p>
      <label className="full">{text('inventory.notes')}<textarea name="notes" rows={3} maxLength={2000} defaultValue={campaign?.notes ?? ''} /></label>
      <Feedback error={error} />
      <div><button className="button primary">{text(busy ? 'common.working' : 'booking.saveNext')}</button></div>
    </fieldset></form>
  </section>;
}

function ScreensStep({ campaign, venues, onChange, onNext, onBack }: {
  campaign: CampaignDetail; venues: Venue[]; onChange: (value: CampaignDetail) => void; onNext: () => void; onBack: () => void;
}) {
  const text = useText();
  const [filters, setFilters] = useState({ venueId: '', city: '', orientation: '', search: '', selected: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageResult<ScreenOption> | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const [message, setMessage] = useState<MessageKey | ''>('');
  const [reload, setReload] = useState(0);
  const scheduleKey = JSON.stringify(campaign.schedule);
  useEffect(() => {
    let live = true;
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    for (const [key, value] of Object.entries(applied)) if (value) query.set(key, value);
    api<PageResult<ScreenOption>>(`/campaigns/${campaign.id}/screen-options?${query}`)
      .then(result => { if (live) { setData(result); setError(''); } })
      .catch(failure => { if (live) setError(bookingError(failure)); });
    return () => { live = false; };
  }, [campaign.id, applied, page, reload, scheduleKey]);
  const rows = data?.items ?? [];
  async function bulk(kind: 'add' | 'remove') {
    if (busy) return;
    const ids = rows.filter(row => checked.has(row.screenId) && row.selected === (kind === 'remove')).map(row => row.screenId);
    if (!ids.length) { setError(kind === 'add' ? 'booking.error.pickToAdd' : 'booking.error.pickToRemove'); return; }
    if (ids.length > 100) { setError('booking.error.tooManyScreens'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      onChange(await api<CampaignDetail>(`/campaigns/${campaign.id}/screens${kind === 'remove' ? '/remove' : ''}`, { method: 'POST', body: { screenIds: ids } }));
      setChecked(new Set()); setReload(value => value + 1); setMessage(kind === 'add' ? 'booking.screensAdded' : 'booking.screensRemoved');
    } catch (failure) { setError(bookingError(failure)); } finally { setBusy(false); }
  }
  function toggle(id: string) { setChecked(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const allChecked = rows.length > 0 && rows.every(row => checked.has(row.screenId));
  return <section className="card" aria-label={text('booking.step.screens')}>
    <h2>{text('booking.step.screens')}</h2>
    <p className="hint">{text('booking.screensSelected', { count: campaign.screens.length })}</p>
    <form className="form-grid two-columns inventory-filters" onSubmit={event => { event.preventDefault(); setPage(1); setApplied(filters); }} aria-label={text('booking.filters')}>
      <label>{text('inventory.venue')}<select value={filters.venueId} onChange={event => setFilters({ ...filters, venueId: event.target.value })}>
        <option value="">{text('inventory.all')}</option>{venues.map(venue => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select></label>
      <label>{text('inventory.city')}<input maxLength={100} value={filters.city} onChange={event => setFilters({ ...filters, city: event.target.value })} /></label>
      <label>{text('booking.orientation')}<select value={filters.orientation} onChange={event => setFilters({ ...filters, orientation: event.target.value })}>
        <option value="">{text('inventory.all')}</option>
        <option value="LANDSCAPE">{text('booking.orientation.LANDSCAPE')}</option><option value="PORTRAIT">{text('booking.orientation.PORTRAIT')}</option></select></label>
      <label>{text('booking.search')}<input maxLength={100} value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} /></label>
      <div className="checks full"><label><input type="checkbox" checked={filters.selected === 'true'}
        onChange={event => setFilters({ ...filters, selected: event.target.checked ? 'true' : '' })} />{text('booking.onlySelected')}</label></div>
      <div className="full"><button className="button quiet">{text('inventory.filter')}</button></div>
    </form>
    <div className="inventory-actions bulk-actions">
      <button type="button" className="button primary" disabled={busy} onClick={() => bulk('add')}>{text('booking.addSelected')}</button>
      <button type="button" className="button quiet" disabled={busy} onClick={() => bulk('remove')}>{text('booking.removeSelected')}</button>
    </div>
    <Feedback error={error} message={message} />
    <div className="table-scroll"><table>
      <caption className="visually-hidden">{text('booking.step.screens')}</caption>
      <thead><tr><th><input type="checkbox" aria-label={text('booking.selectPage')} checked={allChecked}
        onChange={event => setChecked(event.target.checked ? new Set(rows.map(row => row.screenId)) : new Set())} /></th>
        <th>{text('booking.screen')}</th><ScreenHeadCells /><th>{text('field.status')}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.screenId} data-screen={row.code}>
        <td><input type="checkbox" aria-label={`${text('common.select')} ${row.code}`} checked={checked.has(row.screenId)} onChange={() => toggle(row.screenId)} /></td>
        <td><strong>{row.code}</strong><small>{row.name}</small></td><ScreenCells row={row} />
        <td>{row.selected ? <span className="badge good">{text('booking.inBooking')}</span> : <span className="muted">—</span>}</td>
      </tr>)}</tbody></table></div>
    {data && !rows.length && <p className="empty-inline">{text('booking.noScreens')}</p>}
    {data && <ButtonPager data={data} onPage={setPage} />}
    <StepActions onBack={onBack}><button type="button" className="button primary" onClick={onNext}>{text('booking.next')}</button></StepActions>
  </section>;
}

function CommercialStep({ campaign, onSaved, onBack }: { campaign: CampaignDetail; onSaved: (value: CampaignDetail) => void; onBack: () => void }) {
  const text = useText();
  const commercial = campaign.commercial;
  const [model, setModel] = useState<string>(commercial.pricingModel ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const input = (name: string, label: MessageKey, value: string | number | null, hint?: MessageKey) =>
    <div className="field"><label>{text(label)}<input name={name} inputMode="decimal" defaultValue={value ?? ''} aria-describedby={hint ? `${name}-hint` : undefined} /></label>
      {hint && <span className="hint" id={`${name}-hint`}>{text(hint)}</span>}</div>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const get = (name: string) => field(form, name) || null;
    const check = (value: string | null, pattern: RegExp, positive = false) =>
      value === null || (pattern.test(value) && (!positive || /[1-9]/.test(value)));
    const body = {
      pricingModel: model || null, currency: field(form, 'currency') || commercial.currency,
      unitPrice: get('unitPrice'), budget: get('budget'), contractedAmount: get('contractedAmount'),
      guaranteedImpressions: get('guaranteedImpressions'), contractedQuantity: get('contractedQuantity'),
      overdeliveryTolerancePct: field(form, 'overdeliveryTolerancePct') || commercial.overdeliveryTolerancePct,
      pgBillingBasis: field(form, 'pgBillingBasis') || commercial.pgBillingBasis,
      publisherSharePct: get('publisherSharePct'), protargetSharePct: get('protargetSharePct'),
      primaryGoal: get('primaryGoal'), targetPlayouts: get('targetPlayouts'), targetImpressions: get('targetImpressions'),
      maxPlayoutsPerHourPerScreen: get('maxPlayoutsPerHourPerScreen') === null ? null : Number(get('maxPlayoutsPerHourPerScreen')),
    };
    setError('');
    const max = body.maxPlayoutsPerHourPerScreen;
    const valid = check(body.unitPrice, money, true) && check(body.budget, money, true) && check(body.contractedAmount, money, true)
      && check(body.guaranteedImpressions, count) && check(body.contractedQuantity, count) && percent.test(body.overdeliveryTolerancePct)
      && check(body.publisherSharePct, percent) && check(body.protargetSharePct, percent)
      && check(body.targetPlayouts, count) && check(body.targetImpressions, count)
      && (max === null || (Number.isInteger(max) && max >= 1 && max <= 3600));
    if (!valid) { setError('booking.error.numbers'); return; }
    if (body.publisherSharePct && body.protargetSharePct && Math.abs(Number(body.publisherSharePct) + Number(body.protargetSharePct) - 100) > 0.0001) {
      setError('booking.error.shares'); return;
    }
    setBusy(true);
    try { onSaved(await api<CampaignDetail>(`/campaigns/${campaign.id}`, { method: 'PATCH', body })); }
    catch (failure) { setError(bookingError(failure)); } finally { setBusy(false); }
  }
  return <section className="card" aria-label={text('booking.step.commercial')}>
    <h2>{text('booking.step.commercial')}</h2>
    <form onSubmit={submit}><fieldset disabled={busy} className="form-grid two-columns">
      <h3 className="full">{text('booking.commercial')}</h3>
      <label>{text('booking.pricingModel')}<select name="pricingModel" value={model} onChange={event => setModel(event.target.value)}>
        <option value="">{text('booking.pricing.none')}</option>
        {Object.values(PricingModel).map(value => <option key={value} value={value}>{text(`booking.pricing.${value}`)}</option>)}</select></label>
      {!model && <p className="hint">{text('booking.commercialEmpty')}</p>}
      {model && <>
        <label>{text('booking.currency')}<select name="currency" defaultValue={commercial.currency}>
          {Object.values(Currency).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        {input('unitPrice', 'booking.unitPrice', commercial.unitPrice)}
        {input('budget', 'booking.budget', commercial.budget)}
        {input('contractedAmount', 'booking.contractedAmount', commercial.contractedAmount)}
        {input('guaranteedImpressions', 'booking.guaranteedImpressions', commercial.guaranteedImpressions)}
        {input('contractedQuantity', 'booking.contractedQuantity', commercial.contractedQuantity)}
        {input('overdeliveryTolerancePct', 'booking.overdelivery', commercial.overdeliveryTolerancePct)}
        {model === 'PG' && <label>{text('booking.pgBasis')}<select name="pgBillingBasis" defaultValue={commercial.pgBillingBasis}>
          <option value="CONTRACTED">{text('booking.pgBasis.CONTRACTED')}</option><option value="DELIVERED">{text('booking.pgBasis.DELIVERED')}</option></select></label>}
        {input('publisherSharePct', 'booking.publisherShare', commercial.publisherSharePct)}
        {input('protargetSharePct', 'booking.protargetShare', commercial.protargetSharePct, 'booking.sharesHint')}
      </>}
      <h3 className="full">{text('booking.goal')}</h3>
      <label>{text('booking.primaryGoal')}<select name="primaryGoal" defaultValue={campaign.primaryGoal ?? ''}>
        <option value="">{text('booking.unknown')}</option>
        {Object.values(CampaignGoal).map(value => <option key={value} value={value}>{text(`booking.goal.${value}`)}</option>)}</select></label>
      {input('targetPlayouts', 'booking.targetPlayouts', campaign.targetPlayouts)}
      {input('targetImpressions', 'booking.targetImpressions', campaign.targetImpressions)}
      {input('maxPlayoutsPerHourPerScreen', 'booking.maxPerHour', campaign.maxPlayoutsPerHourPerScreen, 'booking.maxPerHourHint')}
      <p className="hint full">{text('booking.goalUnitsHint')}</p>
      <Feedback error={error} />
      <div className="inventory-actions full"><button type="button" className="button quiet" onClick={onBack}>{text('booking.back')}</button>
        <button className="button primary">{text(busy ? 'common.working' : 'booking.saveNext')}</button></div>
    </fieldset></form>
  </section>;
}

function CreativesStep({ campaign, onChange, onNext, onBack }: {
  campaign: CampaignDetail; onChange: (value: CampaignDetail) => void; onNext: () => void; onBack: () => void;
}) {
  const text = useText();
  const [items, setItems] = useState<CreativeSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const [showUpload, setShowUpload] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    api<CreativePage>(`/creatives?advertiserId=${campaign.advertiser.id}&pageSize=100`)
      .then(result => { if (live) setItems(result.items); }).catch(failure => { if (live) setError(bookingError(failure)); });
    return () => { live = false; };
  }, [campaign.advertiser.id, reload]);
  const linked = new Set(campaign.creatives.map(creative => creative.id));
  async function link(creative: CreativeSummary, unlink: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try { onChange(await api<CampaignDetail>(`/campaigns/${campaign.id}/creatives${unlink ? '/remove' : ''}`, { method: 'POST', body: { creativeId: creative.id } })); }
    catch (failure) { setError(bookingError(failure)); } finally { setBusy(false); }
  }
  const advertiser: OrgRef = { id: campaign.advertiser.id, name: campaign.advertiser.name, type: 'ADVERTISER' };
  const replaceItem = (updated: CreativeSummary) => setItems(previous => previous?.map(item => item.id === updated.id ? updated : item) ?? previous);
  return <section className="card" aria-label={text('booking.step.creatives')}>
    <h2>{text('booking.step.creatives')}</h2>
    <p className="hint">{text('booking.creativesHint', { name: campaign.advertiser.name })}</p>
    <Feedback error={error} />
    <div className="table-scroll"><table>
      <caption className="visually-hidden">{text('booking.step.creatives')}</caption>
      <thead><tr><th>{text('creative.code')}</th><th>{text('creative.kind')}</th><th>{text('field.status')}</th><th>{text('common.actions')}</th></tr></thead>
      <tbody>{(items ?? []).map(creative => <tr key={creative.id} data-creative={creative.code}>
        <td><strong>{creative.code}</strong><small>{creative.originalFilename}</small></td>
        <td><CreativeFacts creative={creative} /></td>
        <td><CreativeStatusBadge status={creative.status} />{linked.has(creative.id) && <span className="badge good">{text('booking.linked')}</span>}</td>
        <td><div className="stack-small">
          {linked.has(creative.id)
            ? <button type="button" className="button quiet" disabled={busy} onClick={() => link(creative, true)} aria-label={`${text('booking.unlink')} ${creative.code}`}>{text('booking.unlink')}</button>
            : creative.status !== 'REJECTED' && <button type="button" className="button primary" disabled={busy} onClick={() => link(creative, false)} aria-label={`${text('booking.link')} ${creative.code}`}>{text('booking.link')}</button>}
          <ReviewActions creative={creative} onChange={replaceItem} />
        </div></td></tr>)}</tbody></table></div>
    {items && !items.length && <p className="empty-inline">{text('creative.empty')}</p>}
    <div className="inventory-actions"><button type="button" className="button quiet" aria-expanded={showUpload} onClick={() => setShowUpload(value => !value)}>{text('creative.uploadInline')}</button>
      <Link className="text-link" href="/admin/creatives">{text('booking.openLibrary')}</Link></div>
    {showUpload && <CreativeUploader advertisers={[advertiser]} advertiserId={advertiser.id} onDone={() => setReload(value => value + 1)} />}
    <StepActions onBack={onBack}><button type="button" className="button primary" onClick={onNext}>{text('booking.next')}</button></StepActions>
  </section>;
}

type Dayparts = Record<number, { start: string; end: string }[]>;
function toDayparts(schedule: ScheduleSlot[]): Dayparts {
  const result: Dayparts = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  for (const slot of schedule) result[slot.dayOfWeek]?.push({ start: slot.startTime, end: slot.endTime });
  return result;
}
function ScheduleStep({ campaign, onSaved, onBack }: { campaign: CampaignDetail; onSaved: (value: CampaignDetail) => void; onBack: () => void }) {
  const text = useText();
  const [days, setDays] = useState<Dayparts>(() => toDayparts(campaign.schedule));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const update = (day: number, index: number, key: 'start' | 'end', value: string) =>
    setDays(previous => ({ ...previous, [day]: previous[day].map((slot, position) => position === index ? { ...slot, [key]: value } : slot) }));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const slots = Object.entries(days).flatMap(([day, list]) => list.map(slot => ({ dayOfWeek: Number(day), startTime: slot.start, endTime: slot.end })));
    setError('');
    if (slots.some(slot => !hhmm.test(slot.startTime) || !hhmm.test(slot.endTime) || slot.startTime === slot.endTime)) { setError('booking.error.dayparts'); return; }
    setBusy(true);
    try { onSaved(await api<CampaignDetail>(`/campaigns/${campaign.id}/schedule`, { method: 'POST', body: { slots } })); }
    catch (failure) { setError(bookingError(failure)); } finally { setBusy(false); }
  }
  return <section className="card" aria-label={text('booking.step.schedule')}>
    <h2>{text('booking.step.schedule')}</h2>
    <p className="hint">{text('booking.scheduleHint', { zone: campaign.timezone })}</p>
    <form onSubmit={save}><fieldset disabled={busy} className="schedule-grid">
      {[1, 2, 3, 4, 5, 6, 7].map(day => <div key={day} className="schedule-day" role="group" aria-label={text(`weekday.${day as 1 | 2 | 3 | 4 | 5 | 6 | 7}`)}>
        <strong>{text(`weekday.${day as 1 | 2 | 3 | 4 | 5 | 6 | 7}`)}</strong>
        {days[day].map((slot, index) => <div key={index} className="daypart">
          <input type="time" aria-label={`${text(`weekday.${day as 1 | 2 | 3 | 4 | 5 | 6 | 7}`)} ${text('booking.from')} ${index + 1}`} value={slot.start} onChange={event => update(day, index, 'start', event.target.value)} />
          <span aria-hidden="true">–</span>
          <input type="time" aria-label={`${text(`weekday.${day as 1 | 2 | 3 | 4 | 5 | 6 | 7}`)} ${text('booking.to')} ${index + 1}`} value={slot.end} onChange={event => update(day, index, 'end', event.target.value)} />
          <button type="button" className="button quiet" onClick={() => setDays(previous => ({ ...previous, [day]: previous[day].filter((_, position) => position !== index) }))}>{text('booking.removeDaypart')}</button>
          {slot.start && slot.end && slot.end < slot.start && <small>{text('booking.overnight')}</small>}
        </div>)}
        <button type="button" className="button quiet" onClick={() => setDays(previous => ({ ...previous, [day]: [...previous[day], { start: '', end: '' }] }))}>{text('booking.addDaypart')}</button>
      </div>)}
      <div className="inventory-actions"><button type="button" className="button quiet"
        onClick={() => setDays(previous => ({ 1: previous[1], 2: [...previous[1]], 3: [...previous[1]], 4: [...previous[1]], 5: [...previous[1]], 6: [...previous[1]], 7: [...previous[1]] }))}>{text('booking.copyMonday')}</button></div>
      <Feedback error={error} />
      <div className="inventory-actions"><button type="button" className="button quiet" onClick={onBack}>{text('booking.back')}</button>
        <button className="button primary">{text(busy ? 'common.working' : 'booking.saveNext')}</button></div>
    </fieldset></form>
  </section>;
}

function SummaryStep({ campaign, onChange, onBack }: { campaign: CampaignDetail; onChange: (value: CampaignDetail) => void; onBack: () => void }) {
  const text = useText();
  const router = useRouter();
  const [validation, setValidation] = useState<CampaignValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  useEffect(() => {
    let live = true;
    api<CampaignValidation>(`/campaigns/${campaign.id}/validation`).then(result => { if (live) setValidation(result); })
      .catch(failure => { if (live) setError(bookingError(failure)); });
    return () => { live = false; };
  }, [campaign.id, campaign.updatedAt, campaign.status]);
  const approved = campaign.creatives.filter(creative => creative.status === 'APPROVED').length;
  const blocked = !validation || validation.blockers.length > 0;
  async function ready() {
    if (busy || blocked) return;
    setBusy(true); setError('');
    try {
      const updated = await api<CampaignDetail>(`/campaigns/${campaign.id}/transitions`, { method: 'POST', body: { to: 'READY' } });
      onChange(updated); router.push(`${campaignBase}/${campaign.id}`);
    } catch (failure) { setError(bookingError(failure)); setBusy(false); }
  }
  return <section className="card" aria-label={text('booking.step.summary')}>
    <h2>{text('booking.step.summary')}</h2>
    <dl className="inventory-facts">
      <div><dt>{text('booking.advertiser')}</dt><dd>{campaign.advertiser.name}</dd></div>
      <div><dt>{text('booking.screensLabel')}</dt><dd>{campaign.screens.length}</dd></div>
      <div><dt>{text('booking.step.creatives')}</dt><dd>{text('booking.creativeSummary', { total: campaign.creatives.length, approved })}</dd></div>
      <div><dt>{text('booking.step.schedule')}</dt><dd>{text('booking.dayparts.count', { count: campaign.schedule.length })}</dd></div>
    </dl>
    <ValidationPanel validation={validation} />
    <Feedback error={error} />
    {campaign.status === 'DRAFT' && blocked && validation && <p className="hint" role="status">{text('booking.readyBlocked')}</p>}
    <StepActions onBack={onBack}>
      {campaign.status === 'DRAFT'
        ? <button type="button" className="button primary" disabled={busy || blocked} onClick={ready}>{text('booking.action.READY')}</button>
        : <Link className="button primary" href={`${campaignBase}/${campaign.id}`}>{text('booking.openDetail')}</Link>}
    </StepActions>
  </section>;
}
