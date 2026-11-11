import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { t } from '@protarget/i18n';
import {
  BOOKING_PLAN_EDITABLE, BOOKING_STATUSES,
  type AuditRecord, type CampaignDetail, type CampaignPage, type CreativePage, type ManagedUser, type Organization, type PageResult,
  type InventoryVenue, type InventoryScreen, type InventoryMultiplierHistory,
} from '@protarget/shared';
import { Placeholder } from '@/components/Shell';
import { Organizations, Users, AuditTable } from '@/components/Management';
import { CampaignList } from '@/components/Campaigns';
import { CampaignWizard } from '@/components/CampaignWizard';
import { CampaignDetailView } from '@/components/CampaignDetail';
import { Creatives } from '@/components/Creatives';
import { Venues, VenueDetail, Screens, ScreenDetail, MultiplierHistory } from '@/components/Inventory';
import { ADMIN_NAV, findNavLabel } from '@/lib/nav';
import { locale, pageNumber, requireUser, serverApi } from '@/lib/server';
/** Reads every page of a small admin list (organizations, users, venues), capped to keep rendering bounded. */
async function listAllCapped<T>(path: string): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  for (let page = 1; page <= 10; page++) {
    const result = await serverApi<PageResult<T>>(`${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=100`);
    items.push(...result.items);
    if (page * result.pageSize >= result.total) return { items, truncated: false };
  }
  return { items, truncated: true };
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function AdminPage({ params, searchParams }: {
  params: Promise<{ slug?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser(['ADMIN']);
  const language = await locale();
  const { slug = [] } = await params;
  const path = ['/admin', ...slug].join('/');
  const search = await searchParams;
  const page = pageNumber(search.page);
  if (path === '/admin/inventory') redirect('/admin/inventory/venues');
  if (slug[0] === 'inventory') {
    const kind = slug[1];
    if (kind !== 'venues' && kind !== 'screens') notFound();
    const id = slug[2];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if ((id && !uuid.test(id)) || slug.length > 4 ||
        (slug.length === 4 && (kind !== 'screens' || slug[3] !== 'multipliers'))) notFound();
    const heading = (name: string) => <><p className="eyebrow">{t('nav.inventory', language)}</p><h1>{name}</h1>
      <p className="page-description">{t('inventory.description', language)}</p></>;
    const pageSize = typeof search.pageSize === 'string' && /^(?:[1-9]\d?|100)$/.test(search.pageSize) ? search.pageSize : '20';
    if (id) {
      if (kind === 'venues') {
        const venue = await serverApi<InventoryVenue>(`/venues/${id}`, true);
        return <>{heading(venue.name)}<VenueDetail key={id} venue={venue} /></>;
      }
      const screen = await serverApi<InventoryScreen>(`/screens/${id}`, true);
      if (slug[3] === 'multipliers') {
        const history = await serverApi<InventoryMultiplierHistory>(`/screens/${id}/multipliers?page=${page}&pageSize=${pageSize}`, true);
        return <>{heading(`${screen.screenId} · ${t('inventory.history', language)}`)}
          <MultiplierHistory key={id} screen={screen} history={history} /></>;
      }
      const venues = await serverApi<PageResult<InventoryVenue>>('/venues?pageSize=20');
      return <>{heading(`${screen.screenId} · ${screen.name}`)}<ScreenDetail key={id} screen={screen} venues={venues} /></>;
    }
    const active = search.active === 'true' || search.active === 'false' ? search.active : undefined;
    const venueId = kind === 'screens' && typeof search.venueId === 'string' && uuid.test(search.venueId) ? search.venueId : undefined;
    const filters = { active, venueId, pageSize };
    const query = new URLSearchParams({ page: String(page), pageSize });
    if (active) query.set('active', active);
    if (venueId) query.set('venueId', venueId);
    if (kind === 'venues') return <>{heading(t('nav.inventory.venues', language))}
      <Venues data={await serverApi<PageResult<InventoryVenue>>(`/venues?${query}`)} filters={filters} /></>;
    const [data, venues, selectedVenue] = await Promise.all([
      serverApi<PageResult<InventoryScreen>>(`/screens?${query}`),
      serverApi<PageResult<InventoryVenue>>('/venues?pageSize=20'),
      venueId ? serverApi<InventoryVenue>(`/venues/${venueId}`, true) : undefined,
    ]);
    return <>{heading(t('nav.inventory.screens', language))}
      <Screens data={data} venues={venues} selectedVenue={selectedVenue} filters={filters} /></>;
  }
  if (slug[0] === 'campaigns' || (slug[0] === 'creatives' && slug.length === 1)) {
    const heading = (name: string) => <><p className="eyebrow">{t('booking.eyebrow', language)}</p><h1>{name}</h1>
      <p className="page-description">{t(slug[0] === 'creatives' ? 'creative.description' : 'booking.description', language)}</p></>;
    const { items: orgs, truncated: orgsTruncated } = await listAllCapped<Organization>('/organizations');
    const advertisers = orgs.filter(org => org.type === 'ADVERTISER').map(org => ({ id: org.id, name: org.name, type: org.type }));
    const pageSize = typeof search.pageSize === 'string' && /^(?:[1-9]\d?|100)$/.test(search.pageSize) ? search.pageSize : '20';
    const advertiserId = typeof search.advertiserId === 'string' && uuidPattern.test(search.advertiserId) ? search.advertiserId : undefined;
    if (slug[0] === 'creatives') {
      const status = typeof search.status === 'string' && ['UPLOADED', 'VALIDATING', 'APPROVED', 'REJECTED', 'REVOKED'].includes(search.status) ? search.status : undefined;
      const query = new URLSearchParams({ page: String(page), pageSize });
      if (advertiserId) query.set('advertiserId', advertiserId);
      if (status) query.set('status', status);
      return <>{heading(t('nav.campaigns.creatives', language))}
        <Creatives data={await serverApi<CreativePage>(`/creatives?${query}`)}
          advertisers={advertisers} uploadAdvertisers={orgs.filter(org => org.type === 'ADVERTISER' && org.active).map(org => ({ id: org.id, name: org.name, type: org.type }))}
          filters={{ advertiserId, status, pageSize }} /></>;
    }
    const id = slug[1];
    const wizardData = async () => {
      const [{ items: users, truncated: usersTruncated }, { items: venues, truncated: venuesTruncated }] = await Promise.all([
        listAllCapped<ManagedUser>('/users'), listAllCapped<InventoryVenue>('/venues')]);
      return {
        truncated: orgsTruncated || usersTruncated || venuesTruncated,
        advertisers: orgs.filter(org => org.type === 'ADVERTISER' && org.active).map(org => ({ id: org.id, name: org.name })),
        agencies: orgs.filter(org => org.type === 'AGENCY' && org.active).map(org => ({ id: org.id, name: org.name })),
        owners: users.filter(user => user.role === 'ADMIN' && user.active).map(user => ({ id: user.id, name: user.name })),
        venues: venues.filter(venue => venue.active).map(venue => ({ id: venue.id, name: venue.name, city: venue.city })),
      };
    };
    if (!id) {
      const status = typeof search.status === 'string' && (BOOKING_STATUSES as readonly string[]).includes(search.status) ? search.status : undefined;
      const text = typeof search.search === 'string' && search.search.trim() && search.search.length <= 100 ? search.search.trim() : undefined;
      const query = new URLSearchParams({ page: String(page), pageSize });
      if (status) query.set('status', status);
      if (advertiserId) query.set('advertiserId', advertiserId);
      if (text) query.set('search', text);
      return <>{heading(t('nav.campaigns', language))}
        <CampaignList data={await serverApi<CampaignPage>(`/campaigns?${query}`)} advertisers={advertisers}
          filters={{ status, advertiserId, search: text, pageSize }} truncated={orgsTruncated} /></>;
    }
    if (id === 'new' && slug.length === 2) return <>{heading(t('booking.new', language))}<CampaignWizard key="new" {...await wizardData()} /></>;
    if (!uuidPattern.test(id) || slug.length > 3 || (slug.length === 3 && slug[2] !== 'edit')) notFound();
    const campaign = await serverApi<CampaignDetail>(`/campaigns/${id}`, true);
    if (slug[2] === 'edit') {
      if (!(BOOKING_PLAN_EDITABLE as readonly string[]).includes(campaign.status)) redirect(`/admin/campaigns/${id}`);
      return <>{heading(`${campaign.code} · ${campaign.name}`)}<CampaignWizard key={id} initial={campaign} {...await wizardData()} /></>;
    }
    return <>{heading(`${campaign.code} · ${campaign.name}`)}<CampaignDetailView key={id} initial={campaign} /></>;
  }
  if (path === '/admin/organizations/agencies' || path === '/admin/organizations/advertisers') redirect('/admin/organizations');
  const title = findNavLabel(ADMIN_NAV, path);
  if (!title) notFound();
  const heading = <><p className="eyebrow">{t('foundation.eyebrow', language)}</p><h1>{t(title, language)}</h1></>;
  if (path === '/admin/organizations') return <>{heading}<p className="page-description">{t('organization.description', language)}</p>
    <Organizations data={await serverApi<PageResult<Organization>>(`/organizations?page=${page}`)} /></>;
  if (path === '/admin/organizations/users') {
    const [data, organizations, capabilities] = await Promise.all([
      serverApi<PageResult<ManagedUser>>(`/users?page=${page}`),
      serverApi<PageResult<Organization>>('/organizations?pageSize=100'),
      serverApi<{ invitationsEnabled: boolean }>('/users/capabilities'),
    ]);
    return <>{heading}<p className="page-description">{t('user.description', language)}</p>
      <Users data={data} organizations={organizations} invitationsEnabled={capabilities.invitationsEnabled} /></>;
  }
  if (path === '/admin/settings/audit-log') return <>{heading}<p className="page-description">{t('audit.description', language)}</p>
    <AuditTable data={await serverApi<PageResult<AuditRecord>>(`/audit-logs?page=${page}`)} /></>;
  if (path !== '/admin') return <Placeholder title={t(title, language)} />;
  const [organizations, users, audit, venues, screens] = await Promise.all([
    serverApi<PageResult<Organization>>('/organizations?pageSize=1'),
    serverApi<PageResult<ManagedUser>>('/users?pageSize=1'),
    serverApi<PageResult<AuditRecord>>('/audit-logs?pageSize=1'),
    serverApi<PageResult<InventoryVenue>>('/venues?pageSize=1'),
    serverApi<PageResult<InventoryScreen>>('/screens?pageSize=1'),
  ]);
  return <>{heading}<p className="page-description">{t('dashboard.description', language)}</p>
    <div className="stats">
      <Link href="/admin/organizations" className="card stat"><span>{t('nav.organizations', language)}</span><strong>{organizations.total}</strong><small>{t('dashboard.realRecords', language)}</small></Link>
      <Link href="/admin/organizations/users" className="card stat"><span>{t('nav.organizations.users', language)}</span><strong>{users.total}</strong><small>{t('dashboard.realRecords', language)}</small></Link>
      <Link href="/admin/settings/audit-log" className="card stat"><span>{t('nav.settings.auditLog', language)}</span><strong>{audit.total}</strong><small>{t('dashboard.realRecords', language)}</small></Link>
      <Link href="/admin/inventory/venues" className="card stat"><span>{t('nav.inventory.venues', language)}</span><strong>{venues.total}</strong><small>{t('dashboard.realRecords', language)}</small></Link>
      <Link href="/admin/inventory/screens" className="card stat"><span>{t('nav.inventory.screens', language)}</span><strong>{screens.total}</strong><small>{t('dashboard.realRecords', language)}</small></Link>
    </div>
    <section className="card roadmap"><span className="phase-chip">{t('foundation.phase', language)}</span>
      <h2>{t('dashboard.foundation', language)}</h2><p>{t('dashboard.foundationDescription', language)}</p>
      <div className="roadmap-grid"><div><span>01</span><h3>{t('dashboard.nextTitle', language)}</h3><p>{t('dashboard.nextDescription', language)}</p></div>
        <div><span>02</span><h3>{t('dashboard.laterTitle', language)}</h3><p>{t('dashboard.laterDescription', language)}</p></div></div>
    </section></>;
}
