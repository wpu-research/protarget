'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  VenueType, type InventoryVenue, type InventoryScreen, type PageResult,
  type InventoryMultiplier, type InventoryMultiplierHistory, type CreateInventoryVenue,
  type CreateInventoryScreen, type ApproveInventoryMultiplier,
} from '@protarget/shared';
import type { MessageKey } from '@protarget/i18n';
import { api, RequestError } from '@/lib/client';
import { errorKey, useLocale, useText } from './Locale';

const base = '/admin/inventory';
type Domain = 'venue' | 'screen' | 'multiplier' | 'approval';
type Filters = { active?: string; venueId?: string; pageSize?: string };
const numericFields = ['resolutionWidth', 'resolutionHeight', 'loopLengthSec', 'defaultSlotLengthSec'] as const;
const textFields = ['locationLabel', 'physicalSize', 'os', 'cmsName', 'cmsVersion', 'cmsReference', 'notes', 'operatingStart', 'operatingEnd'] as const;
const hhmm = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
function validHours(start?: string | null, end?: string | null) {
  return start == null && end == null || start != null && end != null && hhmm.test(start) && hhmm.test(end) && start !== end;
}
function inventoryError(error: unknown, domain: Domain): MessageKey {
  if (error instanceof RequestError) {
    if (error.code === 'VALIDATION_FAILED') return `inventory.error.${domain}Validation`;
    if (error.code === 'INVALID_STATE_TRANSITION') return `inventory.error.${domain}Conflict`;
  }
  return errorKey(error);
}
function changed<T extends object>(body: T, original?: object): Partial<T> {
  if (!original) return body;
  const before = original as Record<string, unknown>;
  return Object.fromEntries(Object.entries(body).filter(([key, value]) => value !== before[key])) as Partial<T>;
}
function textValue(form: FormData, name: string) { return String(form.get(name) ?? '').trim(); }
function validZone(zone: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return true; } catch { return false; }
}
function query(filters: Filters, page = 1) {
  const values = new URLSearchParams({ page: String(page) });
  for (const [key, value] of Object.entries(filters)) if (value) values.set(key, value);
  return values.toString();
}
function Status({ active }: { active: boolean }) {
  const text = useText();
  return <span className={`badge ${active ? 'good' : ''}`}>{text(active ? 'common.active' : 'common.inactive')}</span>;
}
function Feedback({ error, message }: { error?: MessageKey | ''; message?: MessageKey | '' }) {
  const text = useText();
  return <>{error && <p role="alert" className="error full">{text(error)}</p>}
    {message && <p role="status" className="success full">{text(message)}</p>}</>;
}
function Stamp({ value, zone }: { value: string; zone: string }) {
  const locale = useLocale();
  return <time dateTime={value} title={value}>{new Intl.DateTimeFormat(locale, {
    timeZone: zone, year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  }).format(new Date(value))}</time>;
}
export function InventoryPager({ data, href, filters = {} }: {
  data: Pick<PageResult<unknown>, 'page' | 'pageSize' | 'total'>; href: string; filters?: Filters;
}) {
  const text = useText();
  return <nav className="pager" aria-label={text('common.page', { page: data.page, total: data.total })}>
    <span>{text('common.page', { page: data.page, total: data.total })}</span><div>
      {data.page > 1 && <Link className="button quiet" href={`${href}?${query(filters, data.page - 1)}`}>{text('common.previous')}</Link>}
      {data.page * data.pageSize < data.total && <Link className="button quiet" href={`${href}?${query(filters, data.page + 1)}`}>{text('common.next')}</Link>}
    </div>
  </nav>;
}

/** The pagination cursor belongs to the API page, never to the retained/off-page options. */
function VenuePicker({ initial, selected, value, onChange, allowInactive = false, required = false, id }: {
  initial: PageResult<InventoryVenue>; selected?: InventoryVenue; value: string;
  onChange: (id: string) => void; allowInactive?: boolean; required?: boolean; id: string;
}) {
  const text = useText();
  const [items, setItems] = useState(initial.items);
  const [page, setPage] = useState(initial.page);
  const [more, setMore] = useState(initial.page * initial.pageSize < initial.total);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const chosen = useRef(value);
  const request = useRef<object | null>(null);
  useLayoutEffect(() => { chosen.current = value; }, [value]);
  useLayoutEffect(() => {
    request.current = null; setBusy(false);
    setItems(previous => {
      const retained = previous.find(item => item.id === chosen.current);
      return [...new Map([...(retained ? [retained] : []), ...(selected ? [selected] : []), ...initial.items]
        .map(item => [item.id, item])).values()];
    });
    setPage(initial.page); setMore(initial.page * initial.pageSize < initial.total);
    return () => { request.current = null; };
  }, [initial, selected]);
  async function loadMore() {
    if (!more || request.current) return;
    const token = {}; request.current = token; setBusy(true); setError('');
    try {
      const next = await api<PageResult<InventoryVenue>>(`/venues?page=${page + 1}&pageSize=${initial.pageSize}`);
      if (request.current !== token) return;
      setItems(previous => [...new Map([...previous, ...next.items].map(item => [item.id, item])).values()]);
      setPage(next.page); setMore(next.page * next.pageSize < next.total);
    } catch (error) { if (request.current === token) setError(inventoryError(error, 'venue')); }
    finally { if (request.current === token) { request.current = null; setBusy(false); } }
  }
  const options = selected && !items.some(item => item.id === selected.id) ? [selected, ...items] : items;
  return <div className="venue-picker">
    <label htmlFor={id}>{text('inventory.venue')}</label>
    <select id={id} name="venueId" value={value} required={required} onChange={event => onChange(event.target.value)}>
      <option value="">{text(required ? 'common.select' : 'inventory.all')}</option>
      {options.map(item => <option key={item.id} value={item.id} disabled={!allowInactive && !item.active && item.id !== value}>
        {item.name}{!item.active ? ` (${text('common.inactive')})` : ''}
      </option>)}
    </select>
    {more && <button type="button" className="button quiet" disabled={busy} onClick={loadMore}>
      {text(busy ? 'common.working' : 'inventory.loadVenues')}</button>}
    {!options.length && <p className="hint">{text('inventory.emptyChoices')}</p>}
    <Feedback error={error} />
  </div>;
}

function InventoryFilters({ kind, filters, venues, selectedVenue }: {
  kind: 'venues' | 'screens'; filters: Filters; venues?: PageResult<InventoryVenue>; selectedVenue?: InventoryVenue;
}) {
  const text = useText();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [venueId, setVenueId] = useState(filters.venueId ?? '');
  return <form className="card form-grid two-columns inventory-filters" onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => router.push(`${base}/${kind}?${query({
      active: textValue(data, 'active'), ...(kind === 'screens' ? { venueId } : {}), pageSize: filters.pageSize,
    })}`));
  }}>
    <label>{text('field.status')}<select name="active" defaultValue={filters.active ?? ''}>
      <option value="">{text('inventory.all')}</option><option value="true">{text('common.active')}</option>
      <option value="false">{text('common.inactive')}</option>
    </select></label>
    {venues && <VenuePicker id="filter-venue" initial={venues} selected={selectedVenue} value={venueId} onChange={setVenueId} allowInactive />}
    <div className="full"><button className="button quiet" disabled={pending}>{text(pending ? 'common.working' : 'inventory.filter')}</button></div>
  </form>;
}

export function VenueEditor({ venue, onCreated, onBusyChange }: {
  venue?: InventoryVenue; onCreated?: (venue: InventoryVenue) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const text = useText();
  const router = useRouter();
  // Deliberately not reset from refreshed props: a locale refresh must not erase unsaved edits.
  const [baseline, setBaseline] = useState(venue);
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const [message, setMessage] = useState<MessageKey | ''>('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const body: CreateInventoryVenue = {
      name: textValue(values, 'name'), country: textValue(values, 'country'), city: textValue(values, 'city'),
      type: textValue(values, 'type') as CreateInventoryVenue['type'], timezone: textValue(values, 'timezone'),
      notes: textValue(values, 'notes') || null, active: values.has('active'),
    };
    setError(''); setMessage('');
    if (!body.name || !body.country || !body.city) { setError('inventory.error.required'); return; }
    if (!validZone(body.timezone)) { setError('inventory.error.timezone'); return; }
    const patch = changed(body, baseline);
    if (!Object.keys(patch).length) { setMessage('inventory.noChanges'); return; }
    setBusy(true); onBusyChange?.(true);
    try {
      const result = await api<InventoryVenue>(`/venues${baseline ? '/' + baseline.id : ''}`, { method: baseline ? 'PATCH' : 'POST', body: patch });
      if (!baseline && onCreated) onCreated(result);
      else if (!baseline) router.push(`${base}/venues/${result.id}`);
      else { setBaseline(result); setFormKey(key => key + 1); setMessage('common.saved'); router.refresh(); }
    } catch (error) { setError(inventoryError(error, 'venue')); } finally { setBusy(false); onBusyChange?.(false); }
  }
  return <section className="card inventory-editor">
    <h2>{text(baseline ? 'inventory.venueEdit' : 'inventory.venueCreate')}</h2>
    <form key={formKey} onSubmit={submit}>
      <fieldset disabled={busy} className="form-grid two-columns">
        <label>{text('field.name')}<input name="name" required maxLength={160} defaultValue={baseline?.name} /></label>
        <label>{text('inventory.type')}<select name="type" defaultValue={baseline?.type ?? 'ferry'}>
          {VenueType.map(type => <option key={type} value={type}>{text(`inventory.type.${type}`)}</option>)}
        </select></label>
        <label>{text('inventory.country')}<input name="country" required maxLength={100} defaultValue={baseline?.country} /></label>
        <label>{text('inventory.city')}<input name="city" required maxLength={100} defaultValue={baseline?.city} /></label>
        <label>{text('inventory.timezone')}<input name="timezone" required maxLength={100} defaultValue={baseline?.timezone ?? 'Europe/Istanbul'} /></label>
        <p className="hint">{text('inventory.timezoneHint')}</p>
        <label className="full">{text('inventory.notes')}<textarea name="notes" maxLength={4000} rows={3} defaultValue={baseline?.notes ?? ''} /></label>
        <div className="checks full"><label><input name="active" type="checkbox" defaultChecked={baseline?.active ?? true} />{text('common.active')}</label></div>
        <p className="hint full">{text('inventory.deactivateHint')}</p>
        <Feedback error={error} message={message} />
        <div><button className="button primary">{text(busy ? 'common.working' : 'common.save')}</button></div>
      </fieldset>
    </form>
    {baseline && <RecordMetadata record={baseline} zone={baseline.timezone} />}
  </section>;
}
function RecordMetadata({ record, zone }: { record: { createdAt: string; updatedAt: string }; zone: string }) {
  const text = useText();
  return <div className="record-metadata"><dl className="inventory-facts">
    <div><dt>{text('inventory.createdAt')}</dt><dd><Stamp value={record.createdAt} zone={zone} /></dd></div>
    <div><dt>{text('inventory.updatedAt')}</dt><dd><Stamp value={record.updatedAt} zone={zone} /></dd></div>
  </dl><Link className="text-link" href="/admin/settings/audit-log">{text('inventory.auditLink')}</Link></div>;
}
export function Venues({ data, filters }: { data: PageResult<InventoryVenue>; filters: Filters }) {
  const text = useText();
  return <div className="stack inventory">
    <VenueEditor />
    <InventoryFilters key={JSON.stringify(filters)} kind="venues" filters={filters} />
    <section className="card table-card"><div className="table-scroll"><table>
      <caption className="visually-hidden">{text('nav.inventory.venues')}</caption>
      <thead><tr><th>{text('field.name')}</th><th>{text('inventory.city')}</th><th>{text('inventory.timezone')}</th><th>{text('field.status')}</th><th>{text('common.actions')}</th></tr></thead>
      <tbody>{data.items.map(venue => <tr key={venue.id}>
        <td><strong>{venue.name}</strong><small>{text(`inventory.type.${venue.type}`)}</small></td>
        <td>{venue.city}<small>{venue.country}</small></td><td>{venue.timezone}</td><td><Status active={venue.active} /></td>
        <td><Link className="button quiet" href={`${base}/venues/${venue.id}`} aria-label={`${text('common.edit')} ${venue.name}`}>{text('common.details')}</Link></td>
      </tr>)}</tbody>
    </table></div>{!data.items.length && <p className="empty-inline">{text('inventory.emptyVenues')}</p>}
      <InventoryPager data={data} href={`${base}/venues`} filters={filters} />
    </section>
  </div>;
}
export function VenueDetail({ venue }: { venue: InventoryVenue }) {
  const text = useText();
  return <div className="stack inventory">
    <div className="inventory-actions"><Link className="button quiet" href={`${base}/venues`}>{text('inventory.backVenues')}</Link>
      <Link className="button quiet" href={`${base}/screens?venueId=${venue.id}`}>{text('inventory.venueScreens')}</Link></div>
    <VenueEditor key={venue.id} venue={venue} />
  </div>;
}

export function ScreenEditor({ screen, venues, selectedVenue }: {
  screen?: InventoryScreen; venues: PageResult<InventoryVenue>; selectedVenue?: InventoryVenue;
}) {
  const text = useText();
  const router = useRouter();
  const [baseline, setBaseline] = useState(screen);
  const [venueId, setVenueId] = useState(screen?.venueId ?? selectedVenue?.id ?? '');
  const [createdVenue, setCreatedVenue] = useState<InventoryVenue>();
  const [showCreate, setShowCreate] = useState(false);
  const [inlineVenueBusy, setInlineVenueBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const [message, setMessage] = useState<MessageKey | ''>('');
  const form = useRef<HTMLFormElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const initialCodeValue = useRef<string | undefined>(undefined);
  const dirty = useRef(new Set<keyof CreateInventoryScreen>());
  useLayoutEffect(() => {
    // Text inputs strip CR/LF from legacy identifiers. Compare an edit/revert
    // against the original browser value, but preserve the stored raw identity.
    initialCodeValue.current = codeInput.current?.value;
  }, [formKey]);
  // Successful PATCH responses are authoritative, even if the server-rendered props
  // still describe the venue from before a concurrent move.
  const chosenVenue = [baseline?.venue, createdVenue, ...venues.items, selectedVenue, screen?.venue].find(item => item?.id === venueId);
  function chooseVenue(id: string) { dirty.current.add('venueId'); setVenueId(id); }
  function markDirty(event: FormEvent<HTMLFormElement>) {
    const input = event.nativeEvent.target;
    if ((input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) && input.name) {
      dirty.current.add(input.name as keyof CreateInventoryScreen);
    }
  }
  function clearHours() {
    for (const field of ['operatingStart', 'operatingEnd'] as const) {
      const input = form.current?.elements.namedItem(field);
      if (input instanceof HTMLInputElement) input.value = '';
      dirty.current.add(field);
    }
    setError(''); setMessage('');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || inlineVenueBusy) return;
    const values = new FormData(event.currentTarget);
    const rawCode = String(values.get('screenId') ?? '');
    const enteredCode = rawCode.trim();
    const body: CreateInventoryScreen = {
      screenId: baseline && (baseline.screenIdLocked || !dirty.current.has('screenId') || rawCode === initialCodeValue.current)
        ? baseline.screenId : enteredCode.toUpperCase(),
      name: textValue(values, 'name'), timezone: textValue(values, 'timezone'), venueId, active: values.has('active'),
      orientation: (textValue(values, 'orientation') || null) as CreateInventoryScreen['orientation'],
    };
    for (const field of textFields) body[field] = textValue(values, field) || null;
    for (const field of numericFields) body[field] = textValue(values, field) ? Number(textValue(values, field)) : null;
    setError(''); setMessage('');
    const hasBadInput = (fields: readonly (keyof CreateInventoryScreen)[]) => fields.some(field => {
      const input = event.currentTarget.elements.namedItem(field);
      return (!baseline || dirty.current.has(field)) && input instanceof HTMLInputElement && input.validity.badInput;
    });
    // Native validation is disabled for edits so untouched legacy controls cannot
    // block PATCH. Still reject an edited partial number/time rather than clearing it.
    if (hasBadInput(numericFields)) { setError('inventory.error.hardware'); return; }
    if (hasBadInput(['operatingStart', 'operatingEnd'])) { setError('inventory.error.hours'); return; }
    // Native controls can sanitize legacy values (notably <input type=time>).
    // Never interpret an untouched control as an edit, normalize it, or PATCH it.
    const edited = baseline ? Object.fromEntries(Object.entries(body).filter(([field]) =>
      dirty.current.has(field as keyof CreateInventoryScreen))) as Partial<CreateInventoryScreen> : body;
    const patch = changed(edited, baseline);
    if (!Object.keys(patch).length) { setMessage('inventory.noChanges'); return; }
    const resulting = { ...body, ...baseline, ...patch };
    if (['name', 'venueId', 'timezone'].some(field => field in patch && !patch[field as keyof typeof patch])) {
      setError('inventory.error.required'); return;
    }
    if ('screenId' in patch && !/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(patch.screenId!)) { setError('inventory.error.screenCode'); return; }
    if ('timezone' in patch && !validZone(patch.timezone!)) { setError('inventory.error.timezone'); return; }
    const maxLengths = { name: 160, timezone: 100, locationLabel: 250, physicalSize: 100, os: 160,
      cmsName: 160, cmsVersion: 100, cmsReference: 500, notes: 4000 } as const;
    if (Object.entries(maxLengths).some(([field, max]) => {
      const value = patch[field as keyof typeof maxLengths];
      return value != null && value.length > max;
    }) || ('orientation' in patch && patch.orientation !== null && !['LANDSCAPE', 'PORTRAIT'].includes(patch.orientation!))) {
      setError('inventory.error.screenValidation'); return;
    }
    const slotChanged = 'loopLengthSec' in patch || 'defaultSlotLengthSec' in patch;
    if (numericFields.some(field => field in patch && patch[field] != null &&
      (!Number.isInteger(patch[field]) || patch[field]! < 1 || patch[field]! > 2147483647)) ||
      (slotChanged && resulting.loopLengthSec != null && resulting.defaultSlotLengthSec != null &&
        resulting.defaultSlotLengthSec > resulting.loopLengthSec)) {
      setError('inventory.error.hardware'); return;
    }
    if (('operatingStart' in patch || 'operatingEnd' in patch) && !validHours(resulting.operatingStart, resulting.operatingEnd)) {
      setError('inventory.error.hours'); return;
    }
    setBusy(true);
    try {
      const result = await api<InventoryScreen>(`/screens${baseline ? '/' + baseline.id : ''}`, { method: baseline ? 'PATCH' : 'POST', body: patch });
      if (!baseline) router.push(`${base}/screens/${result.id}`);
      else {
        setBaseline(result); setVenueId(result.venueId); dirty.current.clear();
        setFormKey(key => key + 1); setMessage('common.saved'); router.refresh();
      }
    } catch (error) { setError(inventoryError(error, 'screen')); } finally { setBusy(false); }
  }
  const labels = {
    locationLabel: 'inventory.location', physicalSize: 'inventory.physicalSize', os: 'inventory.os',
    cmsName: 'inventory.cmsName', cmsVersion: 'inventory.cmsVersion', cmsReference: 'inventory.cmsReference',
    resolutionWidth: 'inventory.width', resolutionHeight: 'inventory.height',
    loopLengthSec: 'inventory.loop', defaultSlotLengthSec: 'inventory.slot',
  } as const;
  return <section className="card inventory-editor">
    <h2>{text(baseline ? 'inventory.screenEdit' : 'inventory.screenCreate')}</h2>
    <p className="hint">{text('inventory.connection')}: <span className="badge">{text('inventory.notConnected')}</span></p>
    <form ref={form} key={formKey} onSubmit={submit} noValidate={!!baseline} onInput={markDirty} onChange={markDirty}>
      <fieldset disabled={busy || inlineVenueBusy} className="form-grid two-columns">
        <label>{text('inventory.screenCode')}<input ref={codeInput} name="screenId" required maxLength={64} disabled={baseline?.screenIdLocked}
          pattern={baseline ? undefined : '[A-Za-z0-9][A-Za-z0-9_-]{0,63}'} defaultValue={baseline?.screenId} /></label>
        <label>{text('field.name')}<input name="name" required maxLength={160} defaultValue={baseline?.name} /></label>
        <p className="hint full">{text(baseline?.screenIdLocked ? 'inventory.codeLocked' : 'inventory.codeHint')}</p>
        <VenuePicker id="screen-venue" initial={venues} selected={chosenVenue} value={venueId} onChange={chooseVenue} required />
        <label>{text('inventory.timezone')}<input name="timezone" required maxLength={100} defaultValue={baseline?.timezone ?? selectedVenue?.timezone ?? 'Europe/Istanbul'} /></label>
        <div className="full"><button type="button" className="button quiet" onClick={() => setShowCreate(value => !value)}>
          {text(showCreate ? 'common.cancel' : 'inventory.venueCreate')}</button></div>
        {chosenVenue && !chosenVenue.active && <p className="hint full" role="note">{text('inventory.inactiveVenue')}</p>}
        <p className="hint full">{text('inventory.timezoneHint')}</p>
        <label className="full">{text('inventory.notes')}<textarea name="notes" rows={3} maxLength={4000} defaultValue={baseline?.notes ?? ''} /></label>
        <details className="full hardware-section">
          <summary>{text('inventory.hardware')}</summary>
          <p className="hint">{text('inventory.unknownHint')}</p>
          <div className="form-grid two-columns">
            {(['locationLabel', 'physicalSize', 'os', 'cmsName', 'cmsVersion', 'cmsReference'] as const).map(field =>
              <label key={field}>{text(labels[field])}<input name={field} placeholder={text('inventory.unknown')}
                maxLength={field === 'cmsReference' ? 500 : field === 'locationLabel' ? 250 : field === 'cmsVersion' || field === 'physicalSize' ? 100 : 160}
                defaultValue={baseline?.[field] ?? ''} /></label>)}
            {numericFields.map(field => <label key={field}>{text(labels[field])}<input type="number" name={field}
              min={1} max={2147483647} step={1} placeholder={text('inventory.unknown')} defaultValue={baseline?.[field] ?? ''} /></label>)}
            <label>{text('inventory.orientation')}<select name="orientation" defaultValue={baseline?.orientation ?? ''}>
              <option value="">{text('inventory.unknown')}</option><option value="LANDSCAPE">{text('inventory.landscape')}</option>
              <option value="PORTRAIT">{text('inventory.portrait')}</option>
            </select></label>
            <label>{text('inventory.operatingStart')}<input type={baseline?.operatingStart != null && !hhmm.test(baseline.operatingStart) ? 'text' : 'time'}
              name="operatingStart" defaultValue={baseline?.operatingStart ?? ''} /></label>
            <label>{text('inventory.operatingEnd')}<input type={baseline?.operatingEnd != null && !hhmm.test(baseline.operatingEnd) ? 'text' : 'time'}
              name="operatingEnd" defaultValue={baseline?.operatingEnd ?? ''} /></label>
            {baseline && !validHours(baseline.operatingStart, baseline.operatingEnd) &&
              <p className="hint full" role="note">{text('inventory.legacyHours')}</p>}
            <div className="full"><button type="button" className="button quiet" onClick={clearHours}>{text('inventory.clearHours')}</button></div>
            <p className="hint full">{text('inventory.hoursHint')}</p>
          </div>
        </details>
        <div className="checks full"><label><input type="checkbox" name="active" defaultChecked={baseline?.active ?? true} />{text('common.active')}</label></div>
        <p className="hint full">{text('inventory.deactivateHint')}</p>
        <Feedback error={error} message={message} />
        <div><button className="button primary">{text(busy ? 'common.working' : 'common.save')}</button></div>
      </fieldset>
    </form>
    {showCreate && <fieldset className="inline-venue" disabled={busy}><VenueEditor onBusyChange={setInlineVenueBusy} onCreated={venue => {
      setCreatedVenue(venue); chooseVenue(venue.id); setShowCreate(false); router.refresh();
    }} /></fieldset>}
    {baseline && <RecordMetadata record={baseline} zone={baseline.timezone} />}
  </section>;
}
export function Screens({ data, venues, selectedVenue, filters }: {
  data: PageResult<InventoryScreen>; venues: PageResult<InventoryVenue>; selectedVenue?: InventoryVenue; filters: Filters;
}) {
  const text = useText();
  return <div className="stack inventory">
    <ScreenEditor venues={venues} selectedVenue={selectedVenue} />
    <InventoryFilters key={JSON.stringify(filters)} kind="screens" filters={filters} venues={venues} selectedVenue={selectedVenue} />
    <section className="card table-card"><div className="table-scroll"><table>
      <caption className="visually-hidden">{text('nav.inventory.screens')}</caption>
      <thead><tr><th>{text('inventory.screenCode')}</th><th>{text('inventory.venue')}</th><th>{text('field.status')}</th><th>{text('inventory.connection')}</th><th>{text('common.actions')}</th></tr></thead>
      <tbody>{data.items.map(screen => <tr key={screen.id}>
        <td><strong>{screen.screenId}</strong><small>{screen.name}</small></td><td>{screen.venue.name}</td>
        <td><Status active={screen.active} /></td><td><span className="badge">{text('inventory.notConnected')}</span></td>
        <td><div className="inventory-actions"><Link className="button quiet" href={`${base}/screens/${screen.id}`}
          aria-label={`${text('common.edit')} ${screen.screenId}`}>{text('common.details')}</Link>
          <Link className="button quiet" href={`${base}/screens/${screen.id}/multipliers`}>{text('inventory.history')}</Link></div></td>
      </tr>)}</tbody>
    </table></div>{!data.items.length && <p className="empty-inline">{text('inventory.emptyScreens')}</p>}
      <InventoryPager data={data} href={`${base}/screens`} filters={filters} />
    </section>
  </div>;
}
export function ScreenDetail({ screen, venues }: { screen: InventoryScreen; venues: PageResult<InventoryVenue> }) {
  const text = useText();
  return <div className="stack inventory">
    <div className="inventory-actions"><Link className="button quiet" href={`${base}/screens`}>{text('inventory.backScreens')}</Link>
      <Link className="button primary" href={`${base}/screens/${screen.id}/multipliers`}>{text('inventory.history')}</Link></div>
    <ScreenEditor key={screen.id} screen={screen} venues={venues} />
  </div>;
}

function wholeScreen(version: InventoryMultiplier) {
  return !version.daypartStart && !version.daypartEnd && !version.weekdays.length;
}
function Source({ version }: { version: InventoryMultiplier }) {
  const text = useText();
  const labels: Record<InventoryMultiplier['sourceType'], MessageKey> = {
    MANUAL: 'multiplier.source.MANUAL', MANUAL_VERIFIED: 'multiplier.source.MANUAL_VERIFIED',
    CAMERA: 'multiplier.source.CAMERA', MUNICIPALITY: 'multiplier.source.MUNICIPALITY',
    SENSOR: 'multiplier.source.SENSOR', THIRD_PARTY: 'multiplier.source.THIRD_PARTY',
  };
  return <span>{text(labels[version.sourceType])}</span>;
}
function VersionSummary({ version, empty, zone }: { version: InventoryMultiplier | null; empty: MessageKey; zone: string }) {
  const text = useText();
  if (!version) return <p className="muted">{text(empty)}</p>;
  return <><p className="version-value">{version.value} <small>{text('multiplier.version', { version: version.version })}</small></p>
    <span className="badge">{text(version.approvalStatus === 'DRAFT' ? 'multiplier.draft' : 'multiplier.approved')}</span>
    <p><Source version={version} /></p>
    {version.validFrom && <p className="hint"><Stamp value={version.validFrom} zone={zone} /> → {version.validTo
      ? <Stamp value={version.validTo} zone={zone} /> : text('multiplier.openEnd')}</p>}</>;
}
function VersionDetails({ version, zone }: { version: InventoryMultiplier; zone: string }) {
  const text = useText();
  return <dl className="inventory-facts">
    <div><dt>{text('multiplier.source')}</dt><dd><Source version={version} /></dd></div>
    <div><dt>{text('multiplier.sourceRef')}</dt><dd>{version.sourceRef}</dd></div>
    <div><dt>{text('multiplier.reason')}</dt><dd>{version.changeReason ?? text('inventory.unknown')}</dd></div>
    <div><dt>{text('multiplier.creator')}</dt><dd><code>{version.createdBy}</code></dd></div>
    <div><dt>{text('inventory.createdAt')}</dt><dd><Stamp value={version.createdAt} zone={zone} /></dd></div>
    <div><dt>{text('multiplier.from')}</dt><dd>{version.validFrom ? <Stamp value={version.validFrom} zone={zone} /> : text('multiplier.notApplicable')}</dd></div>
    <div><dt>{text('multiplier.to')}</dt><dd>{version.approvalStatus === 'DRAFT' ? text('multiplier.notApplicable') : version.validTo
      ? <Stamp value={version.validTo} zone={zone} /> : text('multiplier.openEnd')}</dd></div>
    <div><dt>{text('multiplier.approver')}</dt><dd>{version.approvedBy ? <code>{version.approvedBy}</code> : text('multiplier.notApplicable')}</dd></div>
    <div><dt>{text('multiplier.approvedAt')}</dt><dd>{version.approvedAt ? <Stamp value={version.approvedAt} zone={zone} /> : text('multiplier.notApplicable')}</dd></div>
    <div><dt>{text('multiplier.supersedes')}</dt><dd>{version.supersedesId ? <code>{version.supersedesId}</code> : text('multiplier.notApplicable')}</dd></div>
    {version.confidenceNote && <div><dt>{text('multiplier.confidence')}</dt><dd>{version.confidenceNote}</dd></div>}
    <div><dt>{text(wholeScreen(version) ? 'multiplier.scope' : 'multiplier.legacyScope')}</dt>
      <dd>{!wholeScreen(version) && `${version.daypartStart ?? '—'} – ${version.daypartEnd ?? '—'} · ${version.weekdays.join(', ')}`}</dd></div>
  </dl>;
}
function DraftEditor({ screenId, onSaved }: { screenId: string; onSaved: () => void }) {
  const text = useText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const [formKey, setFormKey] = useState(0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const body = { value: textValue(form, 'value'), sourceRef: textValue(form, 'sourceRef'), changeReason: textValue(form, 'changeReason') };
    setError('');
    if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$/.test(body.value) || !/[1-9]/.test(body.value) || !body.sourceRef || !body.changeReason) {
      setError('inventory.error.multiplierValidation'); return;
    }
    setBusy(true);
    try {
      await api(`/screens/${screenId}/multipliers`, { method: 'POST', body });
      setFormKey(key => key + 1); onSaved();
    } catch (error) { setError(inventoryError(error, 'multiplier')); } finally { setBusy(false); }
  }
  return <section className="card"><h2>{text('multiplier.create')}</h2>
    <form key={formKey} onSubmit={submit}><fieldset disabled={busy} className="form-grid two-columns">
      <label>{text('multiplier.value')}<input name="value" inputMode="decimal" required maxLength={13} placeholder="1.2500" /></label>
      <label>{text('multiplier.sourceRef')}<input name="sourceRef" required maxLength={500} /></label>
      <label className="full">{text('multiplier.reason')}<textarea name="changeReason" required maxLength={2000} rows={3} /></label>
      <Feedback error={error} />
      <div><button className="button primary">{text(busy ? 'common.working' : 'multiplier.create')}</button></div>
    </fieldset></form>
  </section>;
}

/** Reject normalized/nonexistent local times instead of silently shifting a DST-gap input. */
function localToUTC(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  const roundtrip = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return roundtrip === value ? date.toISOString() : null;
}
function Approval({ screenId, draft, zone, reloadToken, onSaved, onCancel, onConflict }: {
  screenId: string; draft: InventoryMultiplier; zone: string; reloadToken: number;
  onSaved: () => void; onCancel: () => void; onConflict: () => void;
}) {
  const text = useText();
  const [mode, setMode] = useState('now');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [inputZone, setInputZone] = useState('');
  const [predecessor, setPredecessor] = useState('');
  const [options, setOptions] = useState<InventoryMultiplier[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<MessageKey | ''>('');
  const [confirmed, setConfirmed] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | ''>('');
  const request = useRef<object | null>(null);
  const panel = useRef<HTMLElement>(null);
  function eligible(item: InventoryMultiplier) {
    return item.id !== draft.id && item.approvalStatus === 'APPROVED' && item.validTo === null && wholeScreen(item);
  }
  async function load(nextPage: number, reset = false) {
    if (reset) {
      // Invalidate outstanding pagination requests before replacing the snapshot.
      request.current = null; setOptions([]); setPage(0); setMore(true);
      setPredecessor(''); invalidateConfirmation();
    }
    if (request.current) return;
    const token = {}; request.current = token; setLoading(true); setLoadError('');
    try {
      const data = await api<InventoryMultiplierHistory>(`/screens/${screenId}/multipliers?page=${nextPage}&pageSize=100`);
      if (request.current !== token) return;
      // Merge before filtering, so a newly closed entry removes its older open copy.
      setOptions(previous => [...new Map([...(reset ? [] : previous), ...data.items]
        .map(item => [item.id, item])).values()].filter(eligible));
      if (data.items.some(item => item.id === predecessor && !eligible(item))) {
        setPredecessor(''); invalidateConfirmation();
      }
      setPage(data.page); setMore(data.page * data.pageSize < data.total);
    } catch (error) { if (request.current === token) setLoadError(inventoryError(error, 'approval')); }
    finally { if (request.current === token) { request.current = null; setLoading(false); } }
  }
  useEffect(() => {
    setInputZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    panel.current?.focus();
  }, []);
  useEffect(() => {
    setError('');
    void load(1, true);
    return () => { request.current = null; };
    // Explicit refresh resets choices/confirmations, not dates. A locale-only
    // router.refresh does not change this token or discard the approval draft.
  }, [reloadToken, screenId]);
  const utcStart = mode === 'future' && start ? localToUTC(start) : null;
  const utcEnd = end ? localToUTC(end) : null;
  function invalidateConfirmation() { setConfirmed(false); setReplaceConfirmed(false); }
  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loading || loadError || !confirmed || (predecessor && !replaceConfirmed)) return;
    setError('');
    if ((mode === 'future' && !utcStart) || (end && !utcEnd)) { setError('inventory.error.localTime'); return; }
    const from = utcStart ? Date.parse(utcStart) : Date.now();
    if ((utcStart && from <= Date.now()) || (utcEnd && Date.parse(utcEnd) <= from)) { setError('inventory.error.approvalValidation'); return; }
    const body: ApproveInventoryMultiplier = {
      ...(utcStart ? { validFrom: utcStart } : {}), ...(utcEnd ? { validTo: utcEnd } : {}),
      ...(predecessor ? { supersedesId: predecessor } : {}),
    };
    setBusy(true);
    try { await api(`/screens/${screenId}/multipliers/${draft.id}/approve`, { method: 'POST', body }); onSaved(); }
    catch (error) {
      setError(inventoryError(error, 'approval')); invalidateConfirmation();
      if (error instanceof RequestError && error.status === 409) {
        void load(1, true); onConflict();
      }
    }
    finally { setBusy(false); }
  }
  return <section ref={panel} tabIndex={-1} className="card approval-panel" aria-labelledby="approval-title">
    <div className="section-heading"><h2 id="approval-title">{text('multiplier.approval', { version: draft.version })}</h2>
      <button type="button" className="button quiet" disabled={busy} onClick={onCancel}>{text('common.cancel')}</button></div>
    <VersionSummary version={draft} zone={zone} empty="multiplier.noneLatest" />
    <p className="hint">{text('multiplier.manualHint')}</p>
    <form onSubmit={approve}><fieldset disabled={busy} className="form-grid two-columns">
      <label>{text('multiplier.startMode')}<select value={mode} onChange={event => { setMode(event.target.value); invalidateConfirmation(); }}>
        <option value="now">{text('multiplier.now')}</option><option value="future">{text('multiplier.future')}</option>
      </select></label>
      {mode === 'future' && <label>{text('multiplier.localStart')}<input type="datetime-local" required value={start}
        onChange={event => { setStart(event.target.value); invalidateConfirmation(); }} /></label>}
      <label>{text('multiplier.localEnd')}<input type="datetime-local" value={end}
        onChange={event => { setEnd(event.target.value); invalidateConfirmation(); }} /></label>
      <p className="hint full">{text('multiplier.inputZone', { zone: inputZone || '…' })}</p>
      <p className="utc-preview full">{text('multiplier.utcPreview')}: <code>{mode === 'now' ? text('multiplier.now') : utcStart ?? '—'}
        {' → '}{end ? utcEnd ?? '—' : text('multiplier.openEnd')}</code></p>
      <label className="full">{text('multiplier.predecessor')}<select value={predecessor} disabled={loading || !!loadError} onChange={event => {
        setPredecessor(event.target.value); invalidateConfirmation();
      }}><option value="">{text('multiplier.noPredecessor')}</option>
        {options.map(item => <option key={item.id} value={item.id}>
          {text('multiplier.version', { version: item.version })} · {item.value} · {item.validFrom}
        </option>)}
      </select></label>
      {(more || loadError) && <div className="full"><button type="button" className="button quiet" disabled={loading}
        onClick={() => load(page + 1)}>{text(loading ? 'common.working' : loadError ? 'common.retry' : 'multiplier.loadVersions')}</button></div>}
      <Feedback error={loadError} />
      <p className="hint full">{text('multiplier.replacementHint')}</p>
      <p className="hint full">{text('multiplier.refreshHint')}</p>
      <div className="checks full"><label><input type="checkbox" required disabled={loading || !!loadError} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{text('multiplier.confirm')}</label></div>
      {predecessor && <div className="checks full"><label><input type="checkbox" required checked={replaceConfirmed}
        onChange={event => setReplaceConfirmed(event.target.checked)} />{text('multiplier.confirmReplace')}</label></div>}
      <Feedback error={error} />
      <div className="full"><button className="button primary" disabled={loading || !!loadError || !confirmed || (!!predecessor && !replaceConfirmed) || !inputZone}>
        {text(busy ? 'common.working' : 'multiplier.approve')}</button></div>
    </fieldset></form>
  </section>;
}

export function MultiplierHistory({ screen, history }: { screen: InventoryScreen; history: InventoryMultiplierHistory }) {
  const text = useText();
  const router = useRouter();
  const [draft, setDraft] = useState<InventoryMultiplier | null>(null);
  const [message, setMessage] = useState<MessageKey | ''>('');
  const [approvalReload, setApprovalReload] = useState(0);
  const [refreshing, startTransition] = useTransition();
  function refresh() { startTransition(() => router.refresh()); }
  return <div className="stack inventory">
    <div className="inventory-actions"><Link className="button quiet" href={`${base}/screens/${screen.id}`}>{text('inventory.backScreen')}</Link>
      <button type="button" className="button quiet" disabled={refreshing} onClick={() => {
        setApprovalReload(value => value + 1); refresh();
      }}>{text(refreshing ? 'common.working' : 'multiplier.refresh')}</button></div>
    <p className="inventory-notice">{text('multiplier.manualHint')}</p>
    <div className="version-summary">
      <section className="card" aria-labelledby="current-title"><h2 id="current-title">{text('multiplier.current')}</h2>
        <VersionSummary version={history.current} empty="multiplier.noneCurrent" zone={screen.timezone} /></section>
      <section className="card" aria-labelledby="latest-title"><h2 id="latest-title">{text('multiplier.latest')}</h2>
        <VersionSummary version={history.latest} empty="multiplier.noneLatest" zone={screen.timezone} /></section>
    </div>
    <div className="hint"><p>{text('multiplier.asOf', { time: history.asOf })}</p>
      <p>{text('multiplier.displayZone', { zone: screen.timezone })}</p></div>
    <Feedback message={message} />
    <DraftEditor screenId={screen.id} onSaved={() => {
      setMessage('multiplier.savedDraft');
      router.push(`${base}/screens/${screen.id}/multipliers`); refresh();
    }} />
    {draft && <Approval key={draft.id} screenId={screen.id} draft={draft} zone={screen.timezone}
      reloadToken={approvalReload} onConflict={refresh} onCancel={() => setDraft(null)} onSaved={() => {
      setDraft(null); setMessage('multiplier.savedApproval'); refresh();
    }} />}
    <section className="stack" aria-label={text('inventory.history')}>
      <h2>{text('inventory.history')}</h2>
      {!history.items.length && <p className="card empty-inline">{text('multiplier.noneLatest')}</p>}
      {history.items.map(version => <article className="card version-card" key={version.id} data-version={version.version}>
        <div className="section-heading"><h3>{text('multiplier.version', { version: version.version })} · {version.value}</h3>
          <span className="badge">{text(version.approvalStatus === 'DRAFT' ? 'multiplier.draft' : 'multiplier.approved')}</span></div>
        <VersionDetails version={version} zone={screen.timezone} />
        {version.approvalStatus === 'DRAFT' && version.sourceType === 'MANUAL' && wholeScreen(version) &&
          <button type="button" className="button quiet" onClick={() => { setDraft(version); setMessage(''); }}>
            {text('multiplier.review')}</button>}
      </article>)}
      <InventoryPager data={history} href={`${base}/screens/${screen.id}/multipliers`} filters={{ pageSize: String(history.pageSize) }} />
    </section>
  </div>;
}
