'use client';

import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { CreativeStatus, isBookingStatus, type CampaignScreenRow, type CreativeSummary, type PageResult } from '@protarget/shared';
import type { MessageKey } from '@protarget/i18n';
import { RequestError } from '@/lib/client';
import { errorKey, useLocale, useText } from './Locale';

export function Feedback({ error, message }: { error?: MessageKey | ''; message?: MessageKey | '' }) {
  const text = useText();
  return <>{error && <p role="alert" className="error full">{text(error)}</p>}
    {message && <p role="status" className="success full">{text(message)}</p>}</>;
}
export type BookingErrorContext = 'cms' | 'creativeLink';
/** API error -> localized message; booking-specific codes first (and, per context, the server message), then the shared mapping. */
export function bookingError(error: unknown, context?: BookingErrorContext): MessageKey {
  if (error instanceof RequestError) {
    const message = error.serverMessage.toLowerCase();
    if (context === 'cms') {
      // Server reason codes first; the message patterns below only serve responses without a reason.
      const reason = error.details?.reason;
      if (reason === 'CMS_STATUS_NOT_ALLOWED') return 'booking.error.cmsStatus';
      if (reason === 'PERFORMED_IN_FUTURE') return 'booking.error.future';
      if (reason === 'PERFORMED_BEFORE_BOOKING') return 'booking.error.cmsBeforeBooking';
      if (reason === 'SCREEN_NOT_IN_BOOKING') return 'booking.error.cmsScreen';
      if (reason === 'NOTE_REQUIRED') return 'booking.error.noteRequired';
      if (error.status === 409 && error.code === 'INVALID_STATE_TRANSITION' && !error.details?.reason) return 'booking.error.conflict';
      if (error.code === 'VALIDATION_FAILED') {
        if (/future/.test(message)) return 'booking.error.future';
        if (/preced|before/.test(message)) return 'booking.error.cmsBeforeBooking';
        if (/not part of this booking/.test(message)) return 'booking.error.cmsScreen';
        if (/\bnote\b/.test(message)) return 'booking.error.noteRequired';
      }
    }
    if (context === 'creativeLink' && error.status === 409 && error.code !== 'DUPLICATE_CREATIVE' && /revoked/.test(message)) return 'booking.error.creativeRevoked';
    if (error.code === 'DUPLICATE_CREATIVE' && error.details?.status === 'REVOKED') return 'booking.error.duplicateRevoked';
    const keys: Record<string, MessageKey> = {
      DUPLICATE_CREATIVE: 'booking.error.duplicate', UPLOAD_UNCONFIRMED: 'booking.error.uploadUnconfirmed', STORAGE_UNAVAILABLE: 'booking.error.storage',
      PAYLOAD_TOO_LARGE: 'booking.error.tooLarge', CAMPAIGN_NOT_READY: 'booking.error.notReady',
      INVALID_STATE_TRANSITION: 'booking.error.conflict', VALIDATION_FAILED: 'booking.error.validation',
    };
    if (keys[error.code]) return keys[error.code];
  }
  return errorKey(error);
}
export function Stamp({ value, zone, dateOnly = false }: { value: string; zone: string; dateOnly?: boolean }) {
  const locale = useLocale();
  return <time dateTime={value} title={value}>{new Intl.DateTimeFormat(locale, {
    timeZone: zone, year: 'numeric', month: 'short', day: 'numeric',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
  }).format(new Date(value))}</time>;
}
export function Unknown({ value, fallback = 'booking.unknown', suffix = '' }: {
  value: string | number | null | undefined; fallback?: MessageKey; suffix?: string;
}) {
  const text = useText();
  return <>{value == null || value === '' ? <span className="muted">{text(fallback)}</span> : `${value}${suffix}`}</>;
}
export function BookingStatusBadge({ status, flightEnded = false }: { status: string; flightEnded?: boolean }) {
  const text = useText();
  const known = isBookingStatus(status);
  return <>
    <span className={`badge status-${status.toLowerCase()}`}>{known ? text(`booking.status.${status}`) : status}</span>
    {flightEnded && <span className="badge warn">{text('booking.flightEnded')}</span>}
  </>;
}
/** Every LIVE/PAUSED label and every CMS operation carries this note: declarations, not playback proof. */
export function OperatorNote({ inline = false }: { inline?: boolean }) {
  const text = useText();
  return inline ? <small className="operator-note">{text('booking.operatorDeclaration')}</small>
    : <p className="operator-note block" role="note">{text('booking.operatorDeclaration')}</p>;
}
type Query = Record<string, string | undefined>;
function queryString(filters: Query, page: number) {
  const values = new URLSearchParams({ page: String(page) });
  for (const [key, value] of Object.entries(filters)) if (value) values.set(key, value);
  return values.toString();
}
export function ListPager({ data, href, filters = {} }: {
  data: Pick<PageResult<unknown>, 'page' | 'pageSize' | 'total'>; href: string; filters?: Query;
}) {
  const text = useText();
  return <nav className="pager" aria-label={text('common.page', { page: data.page, total: data.total })}>
    <span>{text('common.page', { page: data.page, total: data.total })}</span><div>
      {data.page > 1 && <Link className="button quiet" href={`${href}?${queryString(filters, data.page - 1)}`}>{text('common.previous')}</Link>}
      {data.page * data.pageSize < data.total && <Link className="button quiet" href={`${href}?${queryString(filters, data.page + 1)}`}>{text('common.next')}</Link>}
    </div></nav>;
}
export function ButtonPager({ data, onPage, busy }: {
  data: Pick<PageResult<unknown>, 'page' | 'pageSize' | 'total'>; onPage: (page: number) => void; busy?: boolean;
}) {
  const text = useText();
  return <nav className="pager" aria-label={text('common.page', { page: data.page, total: data.total })}>
    <span>{text('common.page', { page: data.page, total: data.total })}</span><div>
      <button type="button" className="button quiet" disabled={busy || data.page <= 1} onClick={() => onPage(data.page - 1)}>{text('common.previous')}</button>
      <button type="button" className="button quiet" disabled={busy || data.page * data.pageSize >= data.total} onClick={() => onPage(data.page + 1)}>{text('common.next')}</button>
    </div></nav>;
}
const REJECTION_CODES = ['NO_VISUAL_STREAM', 'UNKNOWN_DIMENSIONS', 'IMAGE_DECODE_MISMATCH', 'NOT_MP4_CONTAINER',
  'VIDEO_CODEC_NOT_H264', 'UNKNOWN_DURATION', 'UNSUPPORTED_TYPE', 'UNREADABLE_MEDIA'] as const;
type RejectionCode = (typeof REJECTION_CODES)[number];
export function RejectionReason({ reason }: { reason: string }) {
  const text = useText();
  const known = (REJECTION_CODES as readonly string[]).includes(reason);
  return <span>{known ? text(`creative.reason.${reason as RejectionCode}`) : reason}{known && <small> <code>{reason}</code></small>}</span>;
}
function megabytes(bytes: string | null) {
  if (!bytes) return null;
  const value = Number(bytes);
  return Number.isFinite(value) ? `${(value / 1024 / 1024).toFixed(2)} MB` : null;
}
export function CreativeStatusBadge({ status }: { status: string }) {
  const text = useText();
  const known = Object.values(CreativeStatus).find(item => item === status);
  return <span className={`badge creative-${status.toLowerCase()}`}>{known ? text(`creative.status.${known}`) : status}</span>;
}
/** Measured metadata only; anything the server could not measure is shown as unknown. */
export function CreativeFacts({ creative }: { creative: CreativeSummary }): ReactNode {
  const text = useText();
  const duration = creative.durationSeconds == null ? null : `${Number(creative.durationSeconds)} ${text('creative.seconds')}`;
  return <dl className="inventory-facts creative-facts">
    <div><dt>{text('creative.kind')}</dt><dd>{creative.kind ? text(`creative.kind.${creative.kind}`) : <Unknown value={null} />}</dd></div>
    <div><dt>{text('creative.duration')}</dt><dd><Unknown value={duration} />{duration && creative.durationManual && <small> {text('creative.durationManual')}</small>}
      {duration && !creative.durationManual && <small> {text('creative.durationMeasured')}</small>}</dd></div>
    <div><dt>{text('creative.resolution')}</dt><dd><Unknown value={creative.width && creative.height ? `${creative.width}×${creative.height}` : null} /></dd></div>
    <div><dt>{text('creative.size')}</dt><dd><Unknown value={megabytes(creative.sizeBytes)} /></dd></div>
    <div><dt>{text('creative.codec')}</dt><dd><Unknown value={creative.videoCodec} fallback={creative.kind === 'IMAGE' ? 'creative.notApplicable' : 'booking.unknown'} /></dd></div>
    <div><dt>{text('creative.checksum')}</dt><dd><code>{creative.checksum ? creative.checksum.slice(0, 16) : text('booking.unknown')}</code></dd></div>
    {creative.rejectionReason && <div className="full"><dt>{text('creative.rejectionReason')}</dt><dd><RejectionReason reason={creative.rejectionReason} /></dd></div>}
    {creative.status === 'REVOKED' && <div className="full"><dt>{text('creative.revocationReason')}</dt>
      <dd>{creative.revocationReason ?? text('booking.unknown')}
        {(creative.revokedBy || creative.revokedAt) && <small> {creative.revokedBy && `${text('creative.revokedBy')}: ${creative.revokedBy.name}`} {creative.revokedAt && <Stamp value={creative.revokedAt} zone="UTC" />}</small>}</dd></div>}
  </dl>;
}

/** Screen facts shared by the picker and the detail tab. Unknown stays unknown; no invented capacity. */
export function ScreenHeadCells() {
  const text = useText();
  return <><th>{text('booking.venue')}</th><th>{text('booking.multiplier')}</th><th>{text('booking.hours')}</th>
    <th>{text('booking.loopSlot')}</th><th>{text('booking.weeklyWindow')}</th></>;
}
export function ScreenCells({ row }: { row: CampaignScreenRow }) {
  const text = useText();
  const hours = row.operatingStart && row.operatingEnd ? `${row.operatingStart}–${row.operatingEnd}` : null;
  return <>
    <td>{row.venueName}<small>{row.city} · {row.timezone}</small>
      {(!row.active || !row.venueActive) && <small><span className="badge warn">{text('common.inactive')}</span></small>}</td>
    <td><Unknown value={row.currentMultiplier} /></td>
    <td><Unknown value={hours} /></td>
    <td><Unknown value={row.loopLengthSec == null ? null : `${row.loopLengthSec} ${text('creative.seconds')}`} />
      <small><Unknown value={row.defaultSlotLengthSec == null ? null : `${row.defaultSlotLengthSec} ${text('creative.seconds')}`} /></small></td>
    <td><Unknown value={row.weeklyWindowHours} fallback="booking.notComputable" suffix={row.weeklyWindowHours == null ? '' : ` ${text('booking.hoursUnit')}`} /></td>
  </>;
}

/** Midnight (00:00) is the end of the day, not a crossing into the next one. */
export function isOvernight(start: string, end: string) { return !!start && !!end && end < start && end !== '00:00'; }
/** CMS upload evidence for one screen: fresh, outdated after a plan change (G1), or missing. */
export function CmsStateBadge({ row }: { row: CampaignScreenRow }) {
  const text = useText();
  if (row.cmsUploaded) return <span className="badge good">{text('booking.cmsUploaded')}</span>;
  if (row.cmsUploadStale) return <span className="badge warn" data-state="stale">{text('booking.cmsStale')}</span>;
  return <span className="badge">{text('booking.cmsMissing')}</span>;
}
/** Modal confirmation. Escape and the cancel button close it; focus starts on the dialog. */
export function ConfirmDialog({ title, confirmLabel, busy = false, error, onConfirm, onCancel, children }: {
  title: MessageKey; confirmLabel: MessageKey; busy?: boolean; error?: MessageKey | ''; onConfirm: () => void; onCancel: () => void; children: ReactNode;
}) {
  const text = useText();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <div className="dialog-backdrop"><div ref={ref} tabIndex={-1} className="dialog card" role="dialog" aria-modal="true" aria-label={text(title)}
    onKeyDown={event => { if (event.key === 'Escape' && !busy) onCancel(); }}>
    <h2>{text(title)}</h2>{children}
    <Feedback error={error} />
    <div className="inventory-actions"><button type="button" className="button primary" disabled={busy} onClick={onConfirm}>{text(busy ? 'common.working' : confirmLabel)}</button>
      <button type="button" className="button quiet" disabled={busy} onClick={onCancel}>{text('common.cancel')}</button></div>
  </div></div>;
}
