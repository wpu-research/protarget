import type { CampaignStatus, CreativeStatus, Currency, PricingModel } from './enums';
import type { PageResult } from './foundation';

/** Manuel CMS modelinde kullanılan sade durum alt kümesi (bkz. tech-spec-campaign-booking). */
export const BOOKING_STATUSES = ['DRAFT', 'READY', 'LIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  DRAFT: ['READY', 'CANCELLED'],
  READY: ['LIVE', 'DRAFT', 'CANCELLED'],
  LIVE: ['PAUSED', 'COMPLETED'],
  PAUSED: ['LIVE', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
/** Bu geçişlerde gerekçe zorunludur. */
export const BOOKING_REASON_REQUIRED: readonly `${BookingStatus}>${BookingStatus}`[] = [
  'LIVE>PAUSED', 'PAUSED>LIVE', 'DRAFT>CANCELLED', 'READY>CANCELLED', 'PAUSED>CANCELLED',
];
export function isBookingStatus(status: string): status is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(status);
}
export function canBookingTransition(from: string, to: string): boolean {
  return isBookingStatus(from) && isBookingStatus(to) && BOOKING_TRANSITIONS[from].includes(to);
}
/** Plan (ekran/kreatif/takvim/ticari/hedef) yalnız bu durumlarda değişebilir. */
export const BOOKING_PLAN_EDITABLE: readonly BookingStatus[] = ['DRAFT', 'READY'];
/** LIVE/PAUSED iken yalnız not ve bitişi ileri uzatma. */
export const BOOKING_LIMITED_EDIT: readonly BookingStatus[] = ['LIVE', 'PAUSED'];

export const CampaignGoal = { PLAYOUTS: 'PLAYOUTS', IMPRESSIONS: 'IMPRESSIONS' } as const;
export type CampaignGoal = (typeof CampaignGoal)[keyof typeof CampaignGoal];

export const CmsOperationType = {
  CMS_UPLOADED: 'CMS_UPLOADED',
  PLAYBACK_STARTED: 'PLAYBACK_STARTED',
  PLAYBACK_PAUSED: 'PLAYBACK_PAUSED',
  PLAYBACK_RESUMED: 'PLAYBACK_RESUMED',
  PLAYBACK_STOPPED: 'PLAYBACK_STOPPED',
  NOTE: 'NOTE',
} as const;
export type CmsOperationType = (typeof CmsOperationType)[keyof typeof CmsOperationType];

export const VALIDATION_BLOCKERS = [
  'NO_SCREENS', 'INACTIVE_SCREENS', 'NO_APPROVED_CREATIVE', 'INVALID_FLIGHT', 'NO_GOAL', 'NO_SCHEDULE',
  'MISSING_MULTIPLIER', 'NO_PLAYBACK_WINDOW', 'CREATIVE_TOO_LONG', 'INVALID_COMMERCIAL',
] as const;
export const VALIDATION_WARNINGS = [
  'OPERATING_HOURS_UNKNOWN', 'TIMEZONE_MISMATCH', 'SLOT_LENGTH_UNKNOWN', 'RESOLUTION_MISMATCH',
  'NO_COMMERCIAL_TERMS', 'UNAPPROVED_CREATIVES', 'FLIGHT_ENDED',
] as const;
export type ValidationBlocker = (typeof VALIDATION_BLOCKERS)[number];
export type ValidationWarning = (typeof VALIDATION_WARNINGS)[number];

export interface CampaignIssue<C extends string> {
  code: C;
  /** İlgili ekranların insan-okur kodları (varsa). */
  screens: string[];
}
export interface CampaignValidation {
  blockers: CampaignIssue<ValidationBlocker>[];
  warnings: CampaignIssue<ValidationWarning>[];
  /** LIVE için ek koşul: CMS_UPLOADED kaydı olmayan aktif ekranlar. */
  missingCmsUpload: string[];
  checkedAt: string;
}

export interface OrgRef { id: string; name: string; type: string }
export interface UserRef { id: string; name: string }

export interface CampaignCommercial {
  pricingModel: PricingModel | null;
  currency: Currency;
  unitPrice: string | null;
  budget: string | null;
  contractedAmount: string | null;
  guaranteedImpressions: string | null;
  contractedQuantity: string | null;
  overdeliveryTolerancePct: string;
  pgBillingBasis: 'CONTRACTED' | 'DELIVERED';
  publisherSharePct: string | null;
  protargetSharePct: string | null;
}
export interface CampaignSummary {
  id: string; code: string; name: string; status: CampaignStatus;
  advertiser: OrgRef; agency: OrgRef | null; internalOwner: UserRef;
  startAt: string; endAt: string; timezone: string;
  primaryGoal: CampaignGoal | null;
  /** BigInt değerleri string döner. */
  targetPlayouts: string | null; targetImpressions: string | null;
  screenCount: number; creativeCount: number;
  /** Bitiş geçmiş ama kampanya hâlâ LIVE/PAUSED: otomatik tamamlama yok. */
  flightEnded: boolean;
  createdAt: string; updatedAt: string;
}
export interface CampaignScreenRow {
  screenId: string; code: string; name: string; venueName: string; city: string;
  active: boolean; venueActive: boolean; timezone: string;
  resolutionWidth: number | null; resolutionHeight: number | null; orientation: 'LANDSCAPE' | 'PORTRAIT' | null;
  operatingStart: string | null; operatingEnd: string | null;
  loopLengthSec: number | null; defaultSlotLengthSec: number | null;
  /** Şu an geçerli onaylı çarpan (yoksa null). */
  currentMultiplier: string | null;
  /** Kampanya planı ∩ çalışma saati; saat/saat dilimi bilinmiyorsa null. */
  weeklyWindowHours: string | null;
  /** Bu ekran için son beyan edilen CMS işlemi. */
  lastCmsOperation: { type: CmsOperationType; performedAt: string } | null;
  cmsUploaded: boolean;
}
export interface ScheduleSlot { dayOfWeek: number; startTime: string; endTime: string }
export interface CreativeSummary {
  id: string; code: string; advertiserId: string; originalFilename: string; mime: string;
  /** null: dosya türü tanınmadı (REJECTED). */
  kind: 'VIDEO' | 'IMAGE' | null;
  durationSeconds: string | null; durationManual: boolean; width: number | null; height: number | null;
  sizeBytes: string | null; checksum: string | null; videoCodec: string | null;
  status: CreativeStatus; rejectionReason: string | null; version: number; replacesId: string | null;
  uploadedBy: UserRef | null; approvedBy: UserRef | null; approvedAt: string | null;
  createdAt: string;
}
export interface CampaignDetail extends CampaignSummary {
  notes: string | null;
  maxPlayoutsPerHourPerScreen: number | null;
  commercial: CampaignCommercial;
  screens: CampaignScreenRow[];
  creatives: CreativeSummary[];
  schedule: ScheduleSlot[];
  launchedAt: string | null; completedAt: string | null;
}
export interface CmsOperation {
  id: string; screenId: string; screenCode: string; type: CmsOperationType;
  performedAt: string; recordedAt: string; actor: UserRef;
  cmsReference: string | null; note: string | null;
  /** Her zaman 'OPERATOR_DECLARED': doğrulanmış oynatma değildir. */
  source: 'OPERATOR_DECLARED';
}
export type CampaignPage = PageResult<CampaignSummary>;
export type CreativePage = PageResult<CreativeSummary>;
export type CmsOperationPage = PageResult<CmsOperation>;

/** Yükleme sınırları (API ve web aynı değeri kullanır). */
export const CREATIVE_MAX_BYTES = 200 * 1024 * 1024;
export const CREATIVE_MIME_TYPES = ['video/mp4', 'image/png', 'image/jpeg'] as const;
