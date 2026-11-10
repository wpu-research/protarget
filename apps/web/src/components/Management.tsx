'use client';
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  OrganizationType, rolesForOrganization,
  type Organization, type PageResult, type ManagedUser, type Role, type AuditRecord,
} from '@protarget/shared';
import { api } from '@/lib/client';
import { errorKey, useText } from './Locale';

export function Pager({ data, href }: { data: Pick<PageResult<unknown>, 'page' | 'pageSize' | 'total'>; href: string }) {
  const text = useText();
  return <div className="pager"><span>{text('common.page', { page: data.page, total: data.total })}</span><div>
    {data.page > 1 && <Link className="button quiet" href={`${href}?page=${data.page - 1}`}>{text('common.previous')}</Link>}
    {data.page * data.pageSize < data.total && <Link className="button quiet" href={`${href}?page=${data.page + 1}`}>{text('common.next')}</Link>}
  </div></div>;
}
export function Organizations({ data }: { data: PageResult<Organization> }) {
  const text = useText();
  const [selected, setSelected] = useState<Organization | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const body = {
      name: String(values.get('name')).trim(), type: values.get('type'),
      brandName: String(values.get('brandName')).trim() || null,
      taxLegalLabel: String(values.get('taxLegalLabel')).trim() || null,
      active: values.has('active'), spendVisible: values.has('spendVisible'), revenueShareVisible: values.has('revenueShareVisible'),
    };
    setBusy(true); setError(''); setMessage('');
    try {
      await api(`/organizations${selected ? '/' + selected.id : ''}`, { method: selected ? 'PATCH' : 'POST', body });
      setMessage(text('common.saved')); setSelected(null); setFormKey(key => key + 1); router.refresh();
    } catch (error) { setError(text(errorKey(error))); } finally { setBusy(false); }
  }
  function edit(org: Organization | null) {
    setSelected(org); setFormKey(key => key + 1); setError(''); setMessage('');
    document.getElementById('organization-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return <div className="stack">
    <section className="card" id="organization-editor">
      <div className="section-heading"><h2>{text(selected ? 'organization.edit' : 'organization.create')}</h2>
        {selected && <button className="button quiet" disabled={busy} onClick={() => edit(null)}>{text('common.cancel')}</button>}</div>
      <form key={formKey} className="form-grid two-columns" onSubmit={submit}>
        <label>{text('field.name')}<input name="name" required maxLength={160} defaultValue={selected?.name} /></label>
        <label>{text('field.type')}<select name="type" aria-label={text('field.type')} defaultValue={selected?.type ?? 'AGENCY'}>
          {Object.values(OrganizationType).map(type => <option key={type} value={type}>{text(`organizationType.${type}`)}</option>)}
        </select></label>
        <label>{text('field.brand')}<input name="brandName" maxLength={160} defaultValue={selected?.brandName ?? ''} /></label>
        <label>{text('field.legal')}<input name="taxLegalLabel" maxLength={250} defaultValue={selected?.taxLegalLabel ?? ''} /></label>
        <div className="checks full">
          <label><input type="checkbox" name="active" defaultChecked={selected?.active ?? true} />{text('common.active')}</label>
          <label><input type="checkbox" name="spendVisible" defaultChecked={selected?.spendVisible ?? false} />{text('field.spendVisible')}</label>
          <label><input type="checkbox" name="revenueShareVisible" defaultChecked={selected?.revenueShareVisible ?? false} />{text('field.revenueVisible')}</label>
        </div>
        <p className="hint full">{text('organization.visibilityHint')}</p>
        {error && <p role="alert" className="error full">{error}</p>}
        {message && <p role="status" className="success full">{message}</p>}
        <div><button className="button primary" disabled={busy}>{text(busy ? 'common.working' : 'common.save')}</button></div>
      </form>
    </section>
    <section className="card table-card"><div className="table-scroll"><table>
      <caption className="visually-hidden">{text('nav.organizations')}</caption>
      <thead><tr><th>{text('field.name')}</th><th>{text('field.type')}</th><th>{text('field.status')}</th><th>{text('common.actions')}</th></tr></thead>
      <tbody>{data.items.map(org => <tr key={org.id}><td><strong>{org.name}</strong><small>{org.brandName}</small></td>
        <td>{text(`organizationType.${org.type}`)}</td><td><span className={`badge ${org.active ? 'good' : ''}`}>{text(org.active ? 'common.active' : 'common.inactive')}</span></td>
        <td><button className="button quiet" disabled={busy} onClick={() => edit(org)} aria-label={`${text('common.edit')} ${org.name}`}>{text('common.edit')}</button></td></tr>)}</tbody>
    </table></div>{!data.items.length && <p className="empty-inline">{text('common.empty')}</p>}
      <Pager data={data} href="/admin/organizations" /></section>
  </div>;
}
export function Users({ data, organizations, invitationsEnabled = true }: {
  data: PageResult<ManagedUser>; organizations: PageResult<Organization>; invitationsEnabled?: boolean;
}) {
  const text = useText();
  const router = useRouter();
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [orgs, setOrgs] = useState(organizations.items);
  const [orgPage, setOrgPage] = useState(organizations.page);
  const [orgMore, setOrgMore] = useState(organizations.page * organizations.pageSize < organizations.total);
  const [orgId, setOrgId] = useState('');
  const [role, setRole] = useState<Role>('AGENCY');
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const chosenOrgId = useRef(orgId);
  const orgRequest = useRef<object | null>(null);
  useLayoutEffect(() => { chosenOrgId.current = orgId; }, [orgId]);
  useLayoutEffect(() => {
    // Refresh the server page before paint, retaining only the chosen off-page option.
    // Retained options must not advance the server's pagination cursor.
    orgRequest.current = null;
    setLoadingOrgs(false);
    const chosenId = chosenOrgId.current;
    setOrgs(previous => {
      const chosen = previous.find(org => org.id === chosenId);
      return chosen && !organizations.items.some(org => org.id === chosen.id)
        ? [...organizations.items, chosen] : organizations.items;
    });
    setOrgPage(organizations.page);
    setOrgMore(organizations.page * organizations.pageSize < organizations.total);
    return () => { orgRequest.current = null; };
  }, [organizations]);
  const currentOrg = orgs.find(org => org.id === orgId) ?? (selected?.organization.id === orgId ? selected.organization : undefined);
  const roles = currentOrg ? rolesForOrganization(currentOrg.type) : [];
  async function loadMore() {
    if (!orgMore || orgRequest.current) return;
    const request = {};
    orgRequest.current = request;
    setLoadingOrgs(true); setError('');
    try {
      const result = await api<PageResult<Organization>>(`/organizations?page=${orgPage + 1}&pageSize=${organizations.pageSize}`);
      if (orgRequest.current !== request) return;
      setOrgs(previous => [...new Map([...previous, ...result.items].map(org => [org.id, org])).values()]);
      setOrgPage(result.page); setOrgMore(result.page * result.pageSize < result.total);
    } catch (error) {
      if (orgRequest.current === request) setError(text(errorKey(error)));
    } finally {
      if (orgRequest.current === request) { orgRequest.current = null; setLoadingOrgs(false); }
    }
  }
  function edit(user: ManagedUser | null) {
    setSelected(user); setOrgId(user?.orgId ?? ''); setRole(user?.role ?? 'AGENCY');
    setFormKey(key => key + 1); setError(''); setMessage('');
    document.getElementById('user-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (!selected && !invitationsEnabled) || !roles.includes(role)) return;
    const values = new FormData(event.currentTarget);
    const name = String(values.get('name')).trim();
    const active = values.has('active');
    // Sending an unchanged `active: false` would revoke a still-pending invitation.
    const body = selected ? {
      ...(name !== selected.name ? { name } : {}),
      ...(orgId !== selected.orgId ? { orgId } : {}),
      ...(role !== selected.role ? { role } : {}),
      ...(active !== selected.active ? { active } : {}),
    } : { name, orgId, role, email: values.get('email') };
    setError(''); setMessage('');
    if (selected && !Object.keys(body).length) { setMessage(text('common.saved')); return; }
    setBusy(true);
    try {
      const result = await api<{ invitation?: { status: string } }>(selected ? `/users/${selected.id}` : '/users/invite', {
        method: selected ? 'PATCH' : 'POST', body,
      });
      if (result.invitation?.status === 'failed') {
        setError(text('user.deliveryFailed')); router.refresh();
      } else {
        setMessage(text(selected ? 'common.saved' : 'user.inviteSent'));
        setSelected(null); setOrgId(''); setFormKey(key => key + 1); router.refresh();
      }
    } catch (error) { setError(text(errorKey(error))); } finally { setBusy(false); }
  }
  return <div className="stack">
    <section className="card" id="user-editor">
      <div className="section-heading"><h2>{text(selected ? 'user.edit' : 'user.invite')}</h2>
        {selected && <button className="button quiet" disabled={busy} onClick={() => edit(null)}>{text('common.cancel')}</button>}</div>
      <form key={formKey} className="form-grid two-columns" onSubmit={submit}>
        <label>{text('field.name')}<input name="name" required maxLength={120} defaultValue={selected?.name} /></label>
        <label>{text('field.email')}<input name="email" type="email" required maxLength={254} disabled={!!selected} defaultValue={selected?.email} /></label>
        <label>{text('field.organization')}<select aria-label={text('field.organization')} value={orgId} required onChange={event => {
          setOrgId(event.target.value);
          const org = orgs.find(org => org.id === event.target.value);
          if (org) setRole(rolesForOrganization(org.type)[0] ?? 'AGENCY');
        }}><option value="">{text('common.select')}</option>
          {selected && !orgs.some(org => org.id === selected.orgId) && <option value={selected.orgId}>{selected.organization.name}</option>}
          {orgs.map(org => <option key={org.id} value={org.id} disabled={!org.active || !rolesForOrganization(org.type).length}>{org.name}</option>)}
        </select></label>
        <label>{text('field.role')}<select aria-label={text('field.role')} value={roles.includes(role) ? role : ''} required onChange={event => setRole(event.target.value as Role)}>
          <option value="">{text('common.select')}</option>{roles.map(role => <option key={role} value={role}>{text(`role.${role}`)}</option>)}
        </select></label>
        {orgMore && <div className="full"><button type="button" className="button quiet" disabled={loadingOrgs} onClick={loadMore}>{text('organization.loadMore')}</button></div>}
        {selected && <div className="checks full"><label><input type="checkbox" name="active" defaultChecked={selected.active} />{text('common.active')}</label></div>}
        <p className="hint full">{text('user.inviteHint')}</p>
        {!invitationsEnabled && <p className="hint full" role="note">{text('user.invitesDisabled')}</p>}
        {error && <p className="error full" role="alert">{error}</p>}
        {message && <p className="success full" role="status">{message}</p>}
        <div><button className="button primary" disabled={busy || (!selected && !invitationsEnabled) || !roles.includes(role)}>{text(busy ? 'common.working' : selected ? 'common.save' : 'user.sendInvite')}</button></div>
      </form>
    </section>
    <section className="card table-card"><div className="table-scroll"><table>
      <caption className="visually-hidden">{text('nav.organizations.users')}</caption>
      <thead><tr><th>{text('field.name')}</th><th>{text('field.organization')}</th><th>{text('field.role')}</th><th>{text('field.status')}</th><th>{text('common.actions')}</th></tr></thead>
      <tbody>{data.items.map(user => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td>
        <td>{user.organization.name}</td><td>{text(`role.${user.role}`)}</td><td><span className={`badge ${user.active ? 'good' : ''}`}>{text(user.active ? 'common.active' : 'common.inactive')}</span></td>
        <td><button className="button quiet" disabled={busy} onClick={() => edit(user)} aria-label={`${text('common.edit')} ${user.name}`}>{text('common.edit')}</button></td></tr>)}</tbody>
    </table></div>{!data.items.length && <p className="empty-inline">{text('common.empty')}</p>}
      <Pager data={data} href="/admin/organizations/users" /></section>
  </div>;
}
export function AuditTable({ data }: { data: PageResult<AuditRecord> }) {
  const text = useText();
  return <section className="card table-card"><div className="table-scroll"><table>
    <caption className="visually-hidden">{text('nav.settings.auditLog')}</caption>
    <thead><tr><th>{text('field.time')}</th><th>{text('field.action')}</th><th>{text('field.record')}</th><th>{text('common.details')}</th></tr></thead>
    <tbody>{data.items.map(entry => <tr key={entry.id}><td><time dateTime={entry.timestamp}>{entry.timestamp.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}</time></td>
      <td><code>{entry.action}</code></td><td><span>{entry.entityType}</span><small>{entry.entityId}</small></td><td>
        <details><summary>{text('common.details')}</summary><dl>
          <dt>{text('audit.actor')}</dt><dd>{entry.userId ?? text('audit.system')}</dd>
          <dt>{text('audit.before')}</dt><dd><pre>{JSON.stringify(entry.before, null, 2)}</pre></dd>
          <dt>{text('audit.after')}</dt><dd><pre>{JSON.stringify(entry.after, null, 2)}</pre></dd>
          <dt>{text('audit.metadata')}</dt><dd><pre>{JSON.stringify(entry.metadata, null, 2)}</pre></dd>
        </dl></details></td></tr>)}</tbody>
  </table></div>{!data.items.length && <p className="empty-inline">{text('common.empty')}</p>}
    <Pager data={data} href="/admin/settings/audit-log" /></section>;
}
