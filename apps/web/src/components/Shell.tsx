import Link from 'next/link';
import type { ReactNode } from 'react';
import { t } from '@protarget/i18n';
import type { NavItem } from '@/lib/nav';

export function Shell({ nav, badge, children }: { nav: NavItem[]; badge?: string; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">{t('app.name')}</Link>
        {badge ? <span className="badge">{badge}</span> : null}
        <nav>
          {nav.map((item) => (
            <div key={item.href + item.label} className="nav-group">
              {item.children ? (
                <>
                  <span className="nav-heading">{t(item.label)}</span>
                  {item.children.map((child) => (
                    <Link key={child.href + child.label} href={child.href} className="nav-link nav-child">
                      {t(child.label)}
                    </Link>
                  ))}
                </>
              ) : (
                <Link href={item.href} className="nav-link">{t(item.label)}</Link>
              )}
            </div>
          ))}
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

export function Placeholder({ title }: { title: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="muted">{t('common.notImplemented')}</p>
    </>
  );
}
