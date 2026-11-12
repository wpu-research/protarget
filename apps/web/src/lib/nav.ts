import type { MessageKey } from '@protarget/i18n';
export interface NavItem { label: MessageKey; href: string; future?: boolean }
export const ADMIN_NAV: NavItem[] = [
  { label: 'nav.dashboard', href: '/admin' },
  { label: 'nav.organizations', href: '/admin/organizations' },
  { label: 'nav.organizations.users', href: '/admin/organizations/users' },
  { label: 'nav.settings.auditLog', href: '/admin/settings/audit-log' },
  { label: 'nav.inventory.venues', href: '/admin/inventory/venues' },
  { label: 'nav.inventory.screens', href: '/admin/inventory/screens' },
  { label: 'nav.fleet', href: '/admin/fleet' },
  { label: 'nav.campaigns', href: '/admin/campaigns' },
  { label: 'nav.campaigns.creatives', href: '/admin/creatives' },
  { label: 'nav.reports', href: '/admin/reporting', future: true },
];
export const PORTAL_NAV: NavItem[] = [
  { label: 'nav.dashboard', href: '/portal' },
  { label: 'nav.campaigns', href: '/portal/campaigns', future: true },
  { label: 'nav.bookings', href: '/portal/bookings', future: true },
  { label: 'nav.reports', href: '/portal/reports', future: true },
];
export const SUPPORT_NAV: NavItem[] = [{ label: 'nav.support', href: '/support' }];
export function findNavLabel(nav: NavItem[], path: string) { return nav.find(item => item.href === path)?.label; }
