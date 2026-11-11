'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent } from 'react';
import {
  BOOKING_STATUSES, type CampaignPage, type CampaignValidation, type OrgRef, type ScheduleSlot,
} from '@protarget/shared';
import { useText } from './Locale';
import { BookingStatusBadge, ListPager, OperatorNote, Stamp } from './campaign-ui';

export const campaignBase = '/admin/campaigns';
type Filters = { status?: string; advertiserId?: string; search?: string; pageSize?: string };

export function CampaignList({ data, advertisers, filters }: { data: CampaignPage; advertisers: OrgRef[]; filters: Filters }) {
  const text = useText();
  const router = useRouter();
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = new URLSearchParams({ page: '1' });
    for (const key of ['status', 'advertiserId', 'search']) { const value = String(form.get(key) ?? '').trim(); if (value) values.set(key, value); }
    if (filters.pageSize) values.set('pageSize', filters.pageSize);
    router.push(`${campaignBase}?${values}`);
  }
  return <div className="stack inventory campaigns">
    <div className="inventory-actions"><Link className="button primary" href={`${campaignBase}/new`}>{text('booking.new')}</Link>
      <Link className="button quiet" href="/admin/creatives">{text('nav.campaigns.creatives')}</Link></div>
    <form className="card form-grid two-columns inventory-filters" onSubmit={filter} aria-label={text('booking.filters')}>
      <label>{text('field.status')}<select name="status" defaultValue={filters.status ?? ''}>
        <option value="">{text('inventory.all')}</option>
        {BOOKING_STATUSES.map(status => <option key={status} value={status}>{text(`booking.status.${status}`)}</option>)}
      </select></label>
      <label>{text('booking.advertiser')}<select name="advertiserId" defaultValue={filters.advertiserId ?? ''}>
        <option value="">{text('inventory.all')}</option>
        {advertisers.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
      </select></label>
      <label className="full">{text('booking.search')}<input name="search" maxLength={100} defaultValue={filters.search ?? ''} /></label>
      <div className="full"><button className="button quiet">{text('inventory.filter')}</button></div>
    </form>
    <section className="card table-card"><div className="table-scroll"><table>
      <caption className="visually-hidden">{text('nav.campaigns')}</caption>
      <thead><tr><th>{text('booking.code')}</th><th>{text('field.status')}</th><th>{text('booking.advertiser')}</th><th>{text('booking.flight')}</th>
        <th>{text('booking.counts')}</th><th>{text('common.actions')}</th></tr></thead>
      <tbody>{data.items.map(campaign => <tr key={campaign.id}>
        <td><strong>{campaign.code}</strong><small>{campaign.name}</small></td>
        <td><BookingStatusBadge status={campaign.status} flightEnded={campaign.flightEnded} />
          {(campaign.status === 'LIVE' || campaign.status === 'PAUSED') && <OperatorNote inline />}</td>
        <td>{campaign.advertiser.name}{campaign.agency && <small>{campaign.agency.name}</small>}</td>
        <td><Stamp value={campaign.startAt} zone={campaign.timezone} dateOnly /> – <Stamp value={campaign.endAt} zone={campaign.timezone} dateOnly />
          <small>{campaign.timezone}</small></td>
        <td>{text('booking.screensCount', { count: campaign.screenCount })}<small>{text('booking.creativesCount', { count: campaign.creativeCount })}</small></td>
        <td><Link className="button quiet" href={`${campaignBase}/${campaign.id}`} aria-label={`${text('common.details')} ${campaign.code}`}>{text('common.details')}</Link></td>
      </tr>)}</tbody>
    </table></div>{!data.items.length && <p className="empty-inline">{text('booking.empty')}</p>}
      <ListPager data={data} href={campaignBase} filters={filters} />
    </section>
  </div>;
}

/** Blockers stop READY/LIVE; warnings never do. Messages are localized by code; screens are listed by their codes. */
export function ValidationPanel({ validation, showCms = false }: { validation: CampaignValidation | null; showCms?: boolean }) {
  const text = useText();
  if (!validation) return <p className="hint" role="status">{text('common.working')}</p>;
  const clean = !validation.blockers.length && !validation.warnings.length && !(showCms && validation.missingCmsUpload.length);
  return <div className="validation" data-testid="validation">
    <section aria-label={text('booking.blockers')}>
      <h3>{text('booking.blockers')} <span className="badge">{validation.blockers.length}</span></h3>
      {validation.blockers.length ? <ul className="issue-list">{validation.blockers.map(issue => <li key={issue.code} data-code={issue.code} className="issue blocker">
        {text(`validation.blocker.${issue.code}`)}{!!issue.screens.length && <small>{text('booking.screensLabel')}: {issue.screens.join(', ')}</small>}</li>)}</ul>
        : <p className="hint">{text('booking.noBlockers')}</p>}
    </section>
    <section aria-label={text('booking.warnings')}>
      <h3>{text('booking.warnings')} <span className="badge">{validation.warnings.length}</span></h3>
      {validation.warnings.length ? <ul className="issue-list">{validation.warnings.map(issue => <li key={issue.code} data-code={issue.code} className="issue warning">
        {text(`validation.warning.${issue.code}`)}{!!issue.screens.length && <small>{text('booking.screensLabel')}: {issue.screens.join(', ')}</small>}</li>)}</ul>
        : <p className="hint">{text('booking.noWarnings')}</p>}
    </section>
    {showCms && !!validation.missingCmsUpload.length && <section aria-label={text('booking.missingCms')}>
      <h3>{text('booking.missingCms')}</h3>
      <p className="issue blocker" data-code="MISSING_CMS_UPLOAD">{text('booking.missingCmsHint')} <small>{validation.missingCmsUpload.join(', ')}</small></p>
    </section>}
    {clean && <p className="hint">{text('booking.allClear')}</p>}
    <p className="hint"><Stamp value={validation.checkedAt} zone="UTC" /></p>
  </div>;
}

export function ScheduleTable({ schedule, timezone }: { schedule: ScheduleSlot[]; timezone: string }) {
  const text = useText();
  if (!schedule.length) return <p className="empty-inline">{text('booking.noSchedule')}</p>;
  const days = [1, 2, 3, 4, 5, 6, 7] as const;
  return <div className="table-scroll"><table>
    <caption className="visually-hidden">{text('booking.tab.schedule')}</caption>
    <thead><tr><th>{text('booking.day')}</th><th>{text('booking.dayparts', { zone: timezone })}</th></tr></thead>
    <tbody>{days.map(day => {
      const slots = schedule.filter(slot => slot.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
      return <tr key={day}><td><strong>{text(`weekday.${day}`)}</strong></td>
        <td>{slots.length ? slots.map(slot => <span key={`${slot.startTime}-${slot.endTime}`} className="badge slot">{slot.startTime}–{slot.endTime}{slot.endTime <= slot.startTime ? ` (${text('booking.overnight')})` : ''}</span>)
          : <span className="muted">{text('booking.noDay')}</span>}</td></tr>;
    })}</tbody></table></div>;
}
