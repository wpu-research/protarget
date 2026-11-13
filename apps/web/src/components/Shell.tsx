'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Identity } from '@protarget/shared';
import type { NavItem } from '@/lib/nav';
import { LanguageSwitch, useText } from './Locale';
import { Logout } from './AuthForms';
import { Brand } from './Brand';
export function Shell({ nav, user, children }: { nav: NavItem[]; user: Identity; children: ReactNode }) {
  const text = useText();
  const pathname = usePathname();
  return <div className="shell">
    <a className="skip" href="#main">{text('common.skip')}</a>
    <aside className="sidebar">
      <Link href="/" className="brand-link" aria-label="Protarget"><Brand /></Link>
      <span className="phase-chip">{text('foundation.phase')}</span>
      <nav aria-label={text('common.navigation')}>{nav.map(item =>
        <Link key={item.href} href={item.href} aria-current={pathname === item.href ||
          (['/admin/inventory/', '/admin/campaigns', '/admin/addons'].some(prefix => item.href.startsWith(prefix)) && pathname.startsWith(item.href + '/')) ? 'page' : undefined} className="nav-link">
          {text(item.label)}{item.future && <span className="soon">{text('common.planned')}</span>}
        </Link>)}</nav>
      <div className="sidebar-note"><span className="status-dot" />{text('foundation.scope')}</div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div><strong>{user.organization.name}</strong><small>{text(`role.${user.role}`)} · {user.email}</small></div>
        <div className="toolbar"><LanguageSwitch /><Logout /></div></header>
      <main id="main" className="content">{children}</main>
    </div>
  </div>;
}
export function Placeholder({ title }: { title: string }) {
  const text = useText();
  return <><p className="eyebrow">{text('common.planned')}</p><h1>{title}</h1>
    <section className="card empty-state"><span className="empty-symbol" aria-hidden="true">＋</span>
      <h2>{text('common.notImplemented')}</h2><p>{text('foundation.future')}</p></section></>;
}
