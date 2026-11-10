import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { t } from '@protarget/i18n';
import type { AuditRecord, ManagedUser, Organization, PageResult } from '@protarget/shared';
import { Placeholder } from '@/components/Shell';
import { Organizations, Users, AuditTable } from '@/components/Management';
import { ADMIN_NAV, findNavLabel } from '@/lib/nav';
import { locale, pageNumber, requireUser, serverApi } from '@/lib/server';
export default async function AdminPage({ params, searchParams }: {
  params: Promise<{ slug?: string[] }>; searchParams: Promise<{ page?: string | string[] }>;
}) {
  await requireUser(['ADMIN']);
  const language = await locale();
  const { slug = [] } = await params;
  const path = ['/admin', ...slug].join('/');
  if (path === '/admin/organizations/agencies' || path === '/admin/organizations/advertisers') redirect('/admin/organizations');
  const title = findNavLabel(ADMIN_NAV, path);
  if (!title) notFound();
  const page = pageNumber((await searchParams).page);
  const heading = <><p className="eyebrow">{t('foundation.eyebrow', language)}</p><h1>{t(title, language)}</h1></>;
  if (path === '/admin/organizations') return <>{heading}<p className="page-description">{t('organization.description', language)}</p>
    <Organizations data={await serverApi<PageResult<Organization>>(`/organizations?page=${page}`)} /></>;
  if (path === '/admin/organizations/users') {
    const [data, organizations] = await Promise.all([
      serverApi<PageResult<ManagedUser>>(`/users?page=${page}`),
      serverApi<PageResult<Organization>>('/organizations?pageSize=100'),
    ]);
    return <>{heading}<p className="page-description">{t('user.description', language)}</p><Users data={data} organizations={organizations} /></>;
  }
  if (path === '/admin/settings/audit-log') return <>{heading}<p className="page-description">{t('audit.description', language)}</p>
    <AuditTable data={await serverApi<PageResult<AuditRecord>>(`/audit-logs?page=${page}`)} /></>;
  if (path !== '/admin') return <Placeholder title={t(title, language)} />;
  const [organizations, users, audit] = await Promise.all([
    serverApi<PageResult<Organization>>('/organizations?pageSize=1'),
    serverApi<PageResult<ManagedUser>>('/users?pageSize=1'),
    serverApi<PageResult<AuditRecord>>('/audit-logs?pageSize=1'),
  ]);
  return <>{heading}<p className="page-description">{t('dashboard.description', language)}</p>
    <div className="stats">
      <Link href="/admin/organizations" className="card stat"><span>{t('nav.organizations', language)}</span><strong>{organizations.total}</strong><small>{t('dashboard.realRecords', language)}</small></Link>
      <Link href="/admin/organizations/users" className="card stat"><span>{t('nav.organizations.users', language)}</span><strong>{users.total}</strong><small>{t('dashboard.realRecords', language)}</small></Link>
      <Link href="/admin/settings/audit-log" className="card stat"><span>{t('nav.settings.auditLog', language)}</span><strong>{audit.total}</strong><small>{t('dashboard.realRecords', language)}</small></Link>
    </div>
    <section className="card roadmap"><span className="phase-chip">{t('foundation.phase', language)}</span>
      <h2>{t('dashboard.foundation', language)}</h2><p>{t('dashboard.foundationDescription', language)}</p>
      <div className="roadmap-grid"><div><span>01</span><h3>{t('dashboard.nextTitle', language)}</h3><p>{t('dashboard.nextDescription', language)}</p></div>
        <div><span>02</span><h3>{t('dashboard.laterTitle', language)}</h3><p>{t('dashboard.laterDescription', language)}</p></div></div>
    </section></>;
}
