'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { MessageKey } from '@protarget/i18n';
import {
  CAPACITY_MAX_DAYS, type CapacityReport, type CapacityScreenRow, type PageResult, type ScreenHoldView,
} from '@protarget/shared';
import { api } from '@/lib/client';
import { errorKey, useLocale, useText } from './Locale';

export interface CapacityOption { id: string; label: string }

function useUtc() {
  const locale = useLocale();
  return (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso)) + ' UTC';
}
/** `datetime-local` value (read as UTC) → ISO string ending in Z, or null. */
const toUtc = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00.000Z` : null;

function Status({ row }: { row: CapacityScreenRow }) {
  const text = useText();
  if (row.overbooked === null) return <span className="badge warn">{text('capacity.unknown')}</span>;
  if (row.overbooked) return <span className="badge status-cancelled">{text('capacity.overbooked')}</span>;
  if (row.slotsPerLoop !== null && row.peakSlots >= row.slotsPerLoop) return <span className="badge status-paused">{text('capacity.full')}</span>;
  return <span className="badge good">{text('capacity.available')}</span>;
}

export function CapacityView({ report, holds, venues, screens, filters }: {
  report: CapacityReport; holds: PageResult<ScreenHoldView>; venues: CapacityOption[]; screens: CapacityOption[];
  filters: { from: string; days: number; venueId?: string };
}) {
  const text = useText();
  const utc = useUtc();
  return <div className="stack">
    <form className="card form-grid capacity-filters" method="get">
      <label>{text('capacity.from')}<input type="date" name="from" defaultValue={filters.from} required /></label>
      <label>{text('capacity.days')}<input type="number" name="days" min={1} max={CAPACITY_MAX_DAYS} defaultValue={filters.days} required /></label>
      <label>{text('capacity.venue')}<select name="venueId" defaultValue={filters.venueId ?? ''}>
        <option value="">{text('capacity.allVenues')}</option>
        {venues.map(venue => <option key={venue.id} value={venue.id}>{venue.label}</option>)}</select></label>
      <div><button className="button primary" type="submit">{text('capacity.apply')}</button></div>
      <p className="hint full">{text('capacity.rule')}</p>
    </form>
    <section className="card table-card" aria-labelledby="capacity-table">
      <div className="section-heading capacity-head"><h2 id="capacity-table">{text('capacity.table')}</h2>
        <small className="muted">{text('capacity.generated', { date: utc(report.generatedAt) })}</small></div>
      {report.items.length === 0 ? <p className="empty-inline">{text('capacity.empty')}</p> :
        <div className="table-scroll"><table>
          <thead><tr><th>{text('capacity.screen')}</th><th>{text('capacity.slots')}</th><th>{text('capacity.peak')}</th>
            <th>{text('capacity.occupancy')}</th><th>{text('capacity.status')}</th><th>{text('capacity.byDay')}</th><th>{text('capacity.claims')}</th></tr></thead>
          <tbody>{report.items.map(row => <tr key={row.screenId}>
            <td><strong>{row.screenCode}</strong><small>{row.screenName} · {row.venueName}</small></td>
            <td>{row.slotsPerLoop ?? text('capacity.notComputable')}
              <small>{row.loopLengthSec ?? '—'}s / {row.defaultSlotLengthSec ?? '—'}s</small></td>
            <td>{row.peakSlots}</td>
            <td>{row.peakOccupancyPct === null ? text('capacity.notComputable') : `%${row.peakOccupancyPct}`}</td>
            <td><Status row={row} />{row.overbookedFrom && <small>{text('capacity.overFrom', { date: utc(row.overbookedFrom) })}</small>}</td>
            <td><div className="capacity-days">{row.days.map(day => <span key={day.date} title={`${day.date} UTC`}
              className={`capacity-day${row.slotsPerLoop !== null && day.peakSlots > row.slotsPerLoop ? ' over' : day.peakSlots ? ' used' : ''}`}>
              {day.peakSlots}</span>)}</div></td>
            <td>{row.contributors.length ? row.contributors.map(item => <span key={`${item.kind}-${item.id}`}
              className={`badge slot${item.inOverbooking ? ' status-cancelled' : ''}`}>
              {item.kind === 'HOLD' ? text('capacity.holdTag', { label: item.label, slots: item.slots }) : item.label}</span>)
              : <small>{text('capacity.noClaims')}</small>}</td>
          </tr>)}</tbody></table></div>}
    </section>
    <Holds holds={holds} screens={screens} />
  </div>;
}

function Holds({ holds, screens }: { holds: PageResult<ScreenHoldView>; screens: CapacityOption[] }) {
  const text = useText();
  const utc = useUtc();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [formKey, setFormKey] = useState(0);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const [startAt, endAt, expiresAt] = ['startAt', 'endAt', 'expiresAt'].map(name => toUtc(String(data.get(name) ?? '')));
    if (!startAt || !endAt || !expiresAt) { setError('error.validation'); return; }
    setBusy(true); setError(null);
    try {
      await api('/capacity/holds', { method: 'POST', body: { screenId: data.get('screenId'), label: data.get('label'),
        startAt, endAt, expiresAt, slots: Number(data.get('slots')), note: String(data.get('note') ?? '') || null } });
      setFormKey(key => key + 1); router.refresh();
    } catch (e) { setError(errorKey(e)); } finally { setBusy(false); }
  };
  const release = async (hold: ScreenHoldView) => {
    const reason = window.prompt(text('capacity.releaseReason'));
    if (!reason || reason.trim().length < 3) return;
    setBusy(true); setError(null);
    try { await api(`/capacity/holds/${hold.id}/release`, { method: 'POST', body: { reason: reason.trim() } }); router.refresh(); }
    catch (e) { setError(errorKey(e)); } finally { setBusy(false); }
  };
  return <section className="card" aria-labelledby="holds-heading">
    <h2 id="holds-heading">{text('capacity.holds')}</h2>
    <p className="muted">{text('capacity.holdsDescription')}</p>
    <form key={formKey} className="form-grid two-columns" onSubmit={create}>
      <label>{text('capacity.screen')}<select name="screenId" required defaultValue="">
        <option value="" disabled>{text('capacity.chooseScreen')}</option>
        {screens.map(screen => <option key={screen.id} value={screen.id}>{screen.label}</option>)}</select></label>
      <label>{text('capacity.holdLabel')}<input name="label" required maxLength={120} /></label>
      <label>{text('capacity.holdStart')}<input name="startAt" type="datetime-local" required /></label>
      <label>{text('capacity.holdEnd')}<input name="endAt" type="datetime-local" required /></label>
      <label>{text('capacity.holdSlots')}<input name="slots" type="number" min={1} max={100} defaultValue={1} required /></label>
      <label>{text('capacity.holdExpires')}<input name="expiresAt" type="datetime-local" required /></label>
      <label className="full">{text('capacity.holdNote')}<input name="note" maxLength={1000} /></label>
      <p className="hint full">{text('capacity.utcInputs')}</p>
      <div className="full"><button className="button primary" type="submit" disabled={busy}>{text('capacity.createHold')}</button></div>
    </form>
    {error && <p className="error" role="alert">{text(error)}</p>}
    {holds.items.length === 0 ? <p className="empty-inline">{text('capacity.noHolds')}</p> :
      <div className="table-scroll"><table>
        <thead><tr><th>{text('capacity.screen')}</th><th>{text('capacity.holdLabel')}</th><th>{text('capacity.window')}</th>
          <th>{text('capacity.holdSlots')}</th><th>{text('capacity.status')}</th><th /></tr></thead>
        <tbody>{holds.items.map(hold => <tr key={hold.id}>
          <td><strong>{hold.screenCode}</strong></td>
          <td>{hold.label}{hold.note && <small>{hold.note}</small>}<small>{hold.createdBy.name}</small></td>
          <td>{utc(hold.startAt)}<small>→ {utc(hold.endAt)}</small><small>{text('capacity.expires', { date: utc(hold.expiresAt) })}</small></td>
          <td>{hold.slots}</td>
          <td><span className={`badge${hold.state === 'ACTIVE' ? ' good' : ''}`}>{text(`capacity.holdState.${hold.state}`)}</span>
            {hold.releaseReason && <small>{hold.releaseReason}</small>}</td>
          <td>{hold.state !== 'RELEASED' && <button type="button" className="button quiet" disabled={busy} onClick={() => release(hold)}>
            {text('capacity.release')}</button>}</td>
        </tr>)}</tbody></table></div>}
  </section>;
}
