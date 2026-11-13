'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MessageKey } from '@protarget/i18n';
import { addonCanEnable, type AddonState } from '@protarget/shared';
import { api } from '@/lib/client';
import { errorKey, useLocale, useText } from './Locale';

const nameKey = (addon: AddonState) => `addon.${addon.key}.name` as MessageKey;
const summaryKey = (addon: AddonState) => `addon.${addon.key}.summary` as MessageKey;

function StateBadges({ addon }: { addon: AddonState }) {
  const text = useText();
  return <p>
    <span className={`badge${addon.enabled ? ' good' : ''}`}>{text(addon.enabled ? 'addon.state.on' : 'addon.state.off')}</span>
    <span className="visually-hidden">, </span>
    <span className={`badge${addon.kind === 'PLACEHOLDER' ? ' warn' : ''}`}>{text(`addon.kind.${addon.kind}`)}</span>
  </p>;
}

function Toggle({ addon }: { addon: AddonState }) {
  const text = useText();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  // A stale stored `true` on a module that cannot run stays clearable.
  if (!addonCanEnable(addon) && !addon.storedOn) {
    return <p className="hint">{text(addon.kind === 'PLACEHOLDER' ? 'addon.placeholderNote' : 'addon.notReady')}</p>;
  }
  const change = async () => {
    if (!addon.enabled && !addon.storedOn && !window.confirm(text('addon.confirmEnable', { name: text(nameKey(addon)) }))) return;
    setBusy(true); setError(null);
    try { await api(`/addons/${addon.key}`, { method: 'PATCH', body: { enabled: !(addon.enabled || addon.storedOn) } }); router.refresh(); }
    catch (e) { setError(errorKey(e)); }
    finally { setBusy(false); }
  };
  return <div>
    <button type="button" className={`button${addon.enabled ? '' : ' primary'}`} disabled={busy} onClick={change}>
      {text(addon.enabled || addon.storedOn ? 'addon.disable' : 'addon.enable')}</button>
    {error && <p className="error" role="alert">{text(error)}</p>}
  </div>;
}

function Changed({ addon }: { addon: AddonState }) {
  const text = useText();
  const locale = useLocale();
  return <p className="hint">{addon.updatedAt
    ? text('addon.lastChanged', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(addon.updatedAt)) + ' UTC' })
    : text('addon.neverChanged')}</p>;
}

export function AddonList({ addons }: { addons: AddonState[] }) {
  const text = useText();
  return <div className="addon-grid">{addons.map(addon =>
    <section key={addon.key} className="card addon-card" aria-labelledby={`addon-${addon.key}`}>
      <p className="eyebrow">{text('addon.area', { area: addon.area })}</p>
      <h2 id={`addon-${addon.key}`}>{text(nameKey(addon))}</h2>
      <StateBadges addon={addon} />
      <p className="muted">{text(summaryKey(addon))}</p>
      <Changed addon={addon} />
      <div className="addon-actions"><Toggle addon={addon} />
        <Link className="button quiet" href={`/admin/addons/${addon.key}`}>{text('addon.details')}</Link></div>
    </section>)}
  </div>;
}

/** Detail of a module that is passive or has no working screen yet. Shows no data of any kind. */
export function AddonDetail({ addon, compact = false }: { addon: AddonState; compact?: boolean }) {
  const text = useText();
  if (compact) return <section className="card addon-compact"><StateBadges addon={addon} /><Changed addon={addon} /><Toggle addon={addon} /></section>;
  return <section className="card">
    <StateBadges addon={addon} />
    <p>{text(summaryKey(addon))}</p>
    <h2>{text('addon.prerequisites')}</h2>
    {addon.prerequisites.length
      ? <ul>{addon.prerequisites.map(item => <li key={item}>{text(`addon.req.${item}` as MessageKey)}</li>)}</ul>
      : <p className="muted">{text('addon.noPrerequisites')}</p>}
    {!addon.enabled && addonCanEnable(addon) && <p className="hint">{text('addon.disabledNote')}</p>}
    <Changed addon={addon} />
    <Toggle addon={addon} />
  </section>;
}
