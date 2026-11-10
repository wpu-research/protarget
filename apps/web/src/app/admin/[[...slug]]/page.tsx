import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { t } from '@protarget/i18n';
import type { AuditRecord, ManagedUser, Organization, PageResult, InventoryVenue, InventoryScreen, InventoryMultiplierHistory } from '@protarget/shared';
import { Placeholder } from '@/components/Shell';
import { Organizations, Users, AuditTable } from '@/components/Management';
import { Venues, VenueDetail, Screens, ScreenDetail, MultiplierHistory } from '@/components/Inventory';
import { ADMIN_NAV, findNavLabel } from '@/lib/nav';
import { locale, pageNumber, requireUser, serverApi } from '@/lib/server';
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
