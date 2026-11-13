'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { MessageKey } from '@protarget/i18n';
import {
  SALES_CURRENCIES, type PageResult, type ProposalDocument, type RateView, type SalesPackageView,
} from '@protarget/shared';
import { api } from '@/lib/client';
import { errorKey, useLocale, useText } from './Locale';

type Option = { id: string; label: string };

function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setError(null);
    try { await work(); after?.(); router.refresh(); } catch (e) { setError(errorKey(e)); } finally { setBusy(false); }
  };
  return { busy, error, run };
}

function useMoney() {
  const locale = useLocale();
  return (value: string, currency: string) => `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(value))} ${currency}`;
}

export function SalesView({ rates, packages, screens }: { rates: PageResult<RateView>; packages: PageResult<SalesPackageView>; screens: Option[] }) {
  return <div className="stack">
    <Rates rates={rates} screens={screens} />
    <Packages packages={packages} screens={screens} />
    <section className="card"><h2>{useText()('sales.placeholders')}</h2><p className="muted">{useText()('sales.placeholdersNote')}</p></section>
  </div>;
}

function Rates({ rates, screens }: { rates: PageResult<RateView>; screens: Option[] }) {
  const text = useText();
  const money = useMoney();
  const { busy, error, run } = useSubmit();
  const [key, setKey] = useState(0);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const from = String(data.get('validFrom') ?? '');
    void run(() => api('/sales/rates', { method: 'POST', body: {
      screenId: data.get('screenId'), dailyRate: String(data.get('dailyRate') ?? '').trim(), currency: data.get('currency'),
      ...(from ? { validFrom: `${from}:00.000Z` } : {}), note: String(data.get('note') ?? '') || null } }), () => setKey(k => k + 1));
  };
  return <section className="card" aria-labelledby="sales-rates">
    <h2 id="sales-rates">{text('sales.rates')}</h2>
    <p className="muted">{text('sales.ratesDescription')}</p>
    <form key={key} className="form-grid two-columns" onSubmit={submit}>
      <label>{text('capacity.screen')}<select name="screenId" required defaultValue="">
        <option value="" disabled>{text('capacity.chooseScreen')}</option>
        {screens.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <label>{text('sales.dailyRate')}<input name="dailyRate" inputMode="decimal" pattern="(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?" required /></label>
      <label>{text('sales.currency')}<select name="currency" defaultValue="TRY">{SALES_CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>{text('sales.validFrom')}<input name="validFrom" type="datetime-local" /></label>
      <label className="full">{text('delivery.note')}<input name="note" maxLength={500} /></label>
      <div className="full"><button className="button primary" disabled={busy}>{text('sales.addRate')}</button></div>
    </form>
    {error && <p className="error" role="alert">{text(error)}</p>}
    {rates.items.length === 0 ? <p className="empty-inline">{text('sales.noRates')}</p> :
      <div className="table-scroll"><table>
        <thead><tr><th>{text('capacity.screen')}</th><th>{text('sales.dailyRate')}</th><th>{text('sales.validity')}</th><th>{text('delivery.note')}</th></tr></thead>
        <tbody>{rates.items.map(rate => <tr key={rate.id}>
          <td><strong>{rate.screenCode}</strong></td>
          <td>{money(rate.dailyRate, rate.currency)}</td>
          <td>{rate.validFrom.slice(0, 16).replace('T', ' ')} UTC<small>{rate.validTo ? `→ ${rate.validTo.slice(0, 16).replace('T', ' ')} UTC` : text('sales.current')}</small></td>
          <td>{rate.note ?? '—'}<small>{rate.createdBy.name}</small></td>
        </tr>)}</tbody></table></div>}
  </section>;
}

function Packages({ packages, screens }: { packages: PageResult<SalesPackageView>; screens: Option[] }) {
  const text = useText();
  const { busy, error, run } = useSubmit();
  const [key, setKey] = useState(0);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api('/sales/packages', { method: 'POST', body: { name: data.get('name'),
      description: String(data.get('description') ?? '') || null, screenIds: data.getAll('screenIds') } }), () => setKey(k => k + 1));
  };
  return <section className="card" aria-labelledby="sales-packages">
    <h2 id="sales-packages">{text('sales.packages')}</h2>
    <p className="muted">{text('sales.packagesDescription')}</p>
    <form key={key} className="form-grid two-columns" onSubmit={submit}>
      <label>{text('sales.packageName')}<input name="name" required maxLength={120} /></label>
      <label>{text('sales.packageDescription')}<input name="description" maxLength={1000} /></label>
      <label className="full">{text('sales.packageScreens')}<select name="screenIds" multiple required size={Math.min(8, Math.max(3, screens.length))}>
        {screens.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <div className="full"><button className="button primary" disabled={busy}>{text('sales.addPackage')}</button></div>
    </form>
    {error && <p className="error" role="alert">{text(error)}</p>}
    {packages.items.length === 0 ? <p className="empty-inline">{text('sales.noPackages')}</p> :
      <div className="table-scroll"><table>
        <thead><tr><th>{text('sales.packageName')}</th><th>{text('sales.packageScreens')}</th><th /></tr></thead>
        <tbody>{packages.items.map(item => <tr key={item.id}>
          <td><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}
            {!item.active && <span className="badge">{text('sales.inactive')}</span>}</td>
          <td>{item.screens.map(s => <span key={s.id} className="badge slot">{s.code}</span>)}</td>
          <td><button type="button" className="button quiet" disabled={busy}
            onClick={() => run(() => api(`/sales/packages/${item.id}`, { method: 'PATCH', body: { active: !item.active } }))}>
            {text(item.active ? 'sales.deactivate' : 'sales.activate')}</button></td>
        </tr>)}</tbody></table></div>}
  </section>;
}

/** Printable proposal. List prices only; no discount, tax or invoice is computed. */
export function ProposalView({ proposal }: { proposal: ProposalDocument }) {
  const text = useText();
  const locale = useLocale();
  const money = useMoney();
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: proposal.campaign.timezone }).format(new Date(iso));
  const c = proposal.campaign;
  return <section className="card proposal" aria-labelledby="proposal-title">
    <div className="section-heading"><h2 id="proposal-title">{text('sales.proposalTitle', { code: c.code })}</h2>
      <button type="button" className="button no-print" onClick={() => window.print()}>{text('sales.print')}</button></div>
    <dl className="identity-grid">
      <dt>{text('delivery.campaign')}</dt><dd>{c.name}</dd>
      <dt>{text('report.advertiser')}</dt><dd>{c.advertiser}{c.agency ? ` · ${c.agency}` : ''}</dd>
      <dt>{text('report.flight')}</dt><dd>{date(c.startAt)} → {date(c.endAt)} ({c.timezone})</dd>
      <dt>{text('sales.days')}</dt><dd>{proposal.days}</dd>
    </dl>
    <div className="table-scroll"><table>
      <thead><tr><th>{text('capacity.screen')}</th><th>{text('sales.dailyRate')}</th><th>{text('sales.listAmount')}</th></tr></thead>
      <tbody>{proposal.lines.map(line => <tr key={line.screenId}>
        <td><strong>{line.screenCode}</strong><small>{line.screenName} · {line.venueName}</small></td>
        <td>{line.dailyRate && line.currency ? money(line.dailyRate, line.currency) : text('sales.noPrice')}</td>
        <td>{line.listAmount && line.currency ? money(line.listAmount, line.currency) : '—'}</td>
      </tr>)}</tbody></table></div>
    <p><strong>{text('sales.total')}:</strong> {proposal.totals.length ? proposal.totals.map(t => money(t.listAmount, t.currency)).join(' + ') : '—'}</p>
    {proposal.missingRates > 0 && <p className="error">{text('sales.missingRates', { count: proposal.missingRates })}</p>}
    <p className="hint">{text('sales.proposalNote', { date: proposal.priceDate.slice(0, 16).replace('T', ' ') + ' UTC' })}</p>
  </section>;
}
