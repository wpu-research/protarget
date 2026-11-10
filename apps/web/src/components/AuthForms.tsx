'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { homeForRole, type Identity } from '@protarget/shared';
import { api, renewSession } from '@/lib/client';
import { errorKey, useText } from './Locale';

export function LoginForm() {
  const text = useText();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const result = await api<{ user: Identity }>('/auth/login', {
        method: 'POST', body: { email: data.get('email'), password: data.get('password') },
      });
      window.location.assign(homeForRole(result.user.role));
    } catch (error) { setError(text(errorKey(error))); setBusy(false); }
  }
  return <form onSubmit={submit} className="form-grid">
    <label>{text('field.email')}<input name="email" type="email" required maxLength={254} autoComplete="username" /></label>
    <label>{text('field.password')}<input name="password" type="password" required autoComplete="current-password" /></label>
    {error && <p role="alert" className="error">{error}</p>}
    <button className="button primary" disabled={busy}>{text(busy ? 'common.working' : 'auth.signIn')}</button>
  </form>;
}
export function InviteForm() {
  const text = useText();
  const token = useRef('');
  const initialized = useRef(false);
  const [valid, setValid] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    token.current = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    setValid(/^[A-Za-z0-9_-]{43}$/.test(token.current));
    // Scrub immediately, then synchronize Next's history integration after parent
    // mount effects have installed it. No token goes into storage or router state.
    const cleanPath = window.location.pathname;
    window.history.replaceState(null, '', cleanPath);
    queueMicrotask(() => {
      if (window.location.pathname === cleanPath) window.history.replaceState(null, '', cleanPath);
    });
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    if (new TextEncoder().encode(password).length > 72 || password !== data.get('confirm')) {
      setError(text('auth.passwordInvalid')); return;
    }
    setBusy(true); setError('');
    try {
      await api('/auth/accept-invite', { method: 'POST', body: { token: token.current, password } });
      token.current = ''; setDone(true);
    } catch (error) { setError(text(errorKey(error))); } finally { setBusy(false); }
  }
  if (done) return <div role="status"><p>{text('auth.inviteAccepted')}</p><Link className="button primary" href="/login">{text('auth.signIn')}</Link></div>;
  if (!valid) return <p className="muted">{text('auth.inviteInvalid')}</p>;
  return <form className="form-grid" onSubmit={submit}>
    <p className="muted">{text('auth.passwordHint')}</p>
    <label>{text('field.password')}<input name="password" type="password" minLength={12} required autoComplete="new-password" /></label>
    <label>{text('field.confirmPassword')}<input name="confirm" type="password" minLength={12} required autoComplete="new-password" /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="button primary" disabled={busy}>{text(busy ? 'common.working' : 'auth.accept')}</button>
  </form>;
}
export function RenewSession() {
  const text = useText();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    renewSession().then(user => { if (active) window.location.replace(homeForRole(user.role)); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  return <div role="status"><p>{text(failed ? 'auth.expired' : 'auth.renewing')}</p>
    {failed && <Link className="button primary" href="/login">{text('auth.signIn')}</Link>}</div>;
}
export function Logout() {
  const text = useText();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return <div><button className="button quiet" type="button" disabled={busy} onClick={async () => {
    setBusy(true); setError(false);
    try { await api('/auth/logout', { method: 'POST' }); window.location.assign('/login'); }
    catch { setError(true); setBusy(false); }
  }}>{text('auth.signOut')}</button>{error && <p role="alert">{text('error.unavailable')}</p>}</div>;
}
