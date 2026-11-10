import type { MessageKey } from '@protarget/i18n';

export interface NavItem {
  label: MessageKey;
  href: string;
  children?: NavItem[];
}

/** Spec v2 §3 navigasyon yapısı — birebir. */
export const ADMIN_NAV: NavItem[] = [
  { label: 'nav.dashboard', href: '/admin' },
  {
    label: 'nav.inventory', href: '/admin/inventory',
    children: [
      { label: 'nav.inventory.venues', href: '/admin/inventory/venues' },
      { label: 'nav.inventory.screens', href: '/admin/inventory/screens' },
      { label: 'nav.inventory.playerHealth', href: '/admin/inventory/player-health' },
      { label: 'nav.inventory.multipliers', href: '/admin/inventory/multipliers' },
    ],
  },
  {
    label: 'nav.campaigns', href: '/admin/campaigns',
    children: [
      { label: 'nav.campaigns.all', href: '/admin/campaigns' },
      { label: 'nav.campaigns.create', href: '/admin/campaigns/new' },
      { label: 'nav.campaigns.creatives', href: '/admin/campaigns/creatives' },
    ],
  },
  {
    label: 'nav.deals', href: '/admin/deals',
    children: [
      { label: 'nav.deals.all', href: '/admin/deals' },
      { label: 'nav.deals.connectors', href: '/admin/deals/connectors' },
    ],
  },
  {
    label: 'nav.reporting', href: '/admin/reporting',
    children: [
      { label: 'nav.reporting.campaignDelivery', href: '/admin/reporting/campaign-delivery' },
      { label: 'nav.reporting.screenDelivery', href: '/admin/reporting/screen-delivery' },
      { label: 'nav.reporting.revenue', href: '/admin/reporting/revenue' },
      { label: 'nav.reporting.discrepancy', href: '/admin/reporting/discrepancy' },
    ],
  },
  {
    label: 'nav.organizations', href: '/admin/organizations',
    children: [
      { label: 'nav.organizations.agencies', href: '/admin/organizations/agencies' },
      { label: 'nav.organizations.advertisers', href: '/admin/organizations/advertisers' },
      { label: 'nav.organizations.users', href: '/admin/organizations/users' },
    ],
  },
  {
    label: 'nav.settings', href: '/admin/settings',
    children: [
      { label: 'nav.settings.pricing', href: '/admin/settings/pricing' },
      { label: 'nav.settings.player', href: '/admin/settings/player' },
      { label: 'nav.settings.notifications', href: '/admin/settings/notifications' },
      { label: 'nav.settings.auditLog', href: '/admin/settings/audit-log' },
    ],
  },
];

export const PORTAL_NAV: NavItem[] = [
  { label: 'nav.dashboard', href: '/portal' },
  { label: 'nav.campaigns', href: '/portal/campaigns' },
  { label: 'nav.deals', href: '/portal/deals' },
  { label: 'nav.reports', href: '/portal/reports' },
];

export function findNavLabel(nav: NavItem[], path: string): MessageKey | undefined {
  for (const item of nav) {
    const child = item.children?.find((c) => c.href === path);
    if (child) return child.label;
    if (item.href === path) return item.label;
  }
  return undefined;
}
