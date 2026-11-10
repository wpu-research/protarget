/** Veritabanı enum'larıyla (apps/api/prisma/schema.prisma) birebir aynı tutulur. */

export const Role = {
  ADMIN: 'ADMIN',
  AGENCY: 'AGENCY',
  ADVERTISER: 'ADVERTISER',
  SUPPORT: 'SUPPORT',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Hiçbir mutation yapamayan, yalnız kendi kapsamını gören roller. */
export const READ_ONLY_ROLES: readonly Role[] = [Role.AGENCY, Role.ADVERTISER];

export const OrganizationType = {
  ADMIN: 'ADMIN',
  AGENCY: 'AGENCY',
  ADVERTISER: 'ADVERTISER',
  MEDIA_OWNER: 'MEDIA_OWNER',
} as const;
export type OrganizationType = (typeof OrganizationType)[keyof typeof OrganizationType];

export const CampaignStatus = {
  DRAFT: 'DRAFT',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  READY: 'READY',
  LIVE: 'LIVE',
  LIVE_WITH_EXTERNAL_ERROR: 'LIVE_WITH_EXTERNAL_ERROR',
  PAUSING: 'PAUSING',
  PAUSED: 'PAUSED',
  PAUSED_WITH_EXTERNAL_ERROR: 'PAUSED_WITH_EXTERNAL_ERROR',
  RESUMING: 'RESUMING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

/** İzinli durum geçişleri. Buradaki tabloda olmayan geçiş 409 döner. */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  DRAFT: ['READY_FOR_REVIEW', 'CANCELLED'],
  READY_FOR_REVIEW: ['READY', 'DRAFT', 'CANCELLED'],
  READY: ['LIVE', 'DRAFT', 'CANCELLED'],
  LIVE: ['PAUSING', 'COMPLETED'],
  LIVE_WITH_EXTERNAL_ERROR: ['PAUSING', 'LIVE', 'COMPLETED'],
  PAUSING: ['PAUSED', 'PAUSED_WITH_EXTERNAL_ERROR'],
  PAUSED: ['RESUMING', 'CANCELLED', 'COMPLETED'],
  PAUSED_WITH_EXTERNAL_ERROR: ['RESUMING', 'PAUSED', 'CANCELLED', 'COMPLETED'],
  RESUMING: ['LIVE', 'LIVE_WITH_EXTERNAL_ERROR'],
  COMPLETED: ['LIVE'], // yalnız admin "reopen"; audit log zorunlu
  CANCELLED: [],
};

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

/** Manifest'e girebilen durumlar. */
export const DELIVERING_STATUSES: readonly CampaignStatus[] = ['LIVE', 'LIVE_WITH_EXTERNAL_ERROR'];

export const CreativeStatus = {
  UPLOADED: 'UPLOADED',
  VALIDATING: 'VALIDATING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type CreativeStatus = (typeof CreativeStatus)[keyof typeof CreativeStatus];

export const PricingModel = { CPM: 'CPM', CPP: 'CPP', FIXED: 'FIXED', PG: 'PG' } as const;
export type PricingModel = (typeof PricingModel)[keyof typeof PricingModel];

export const Currency = { TRY: 'TRY', USD: 'USD' } as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

export const DealType = { PMP: 'PMP', PREFERRED: 'PREFERRED', PG: 'PG', DIRECT: 'DIRECT' } as const;
export type DealType = (typeof DealType)[keyof typeof DealType];

export const DealStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  NEGOTIATING: 'NEGOTIATING',
  ACCEPTED: 'ACCEPTED',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
} as const;
export type DealStatus = (typeof DealStatus)[keyof typeof DealStatus];

export const PlaybackResult = {
  SUCCESS: 'success',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CORRUPTED: 'corrupted',
  TIMEOUT: 'timeout',
} as const;
export type PlaybackResult = (typeof PlaybackResult)[keyof typeof PlaybackResult];

export const MultiplierSourceType = {
  CAMERA: 'CAMERA',
  MUNICIPALITY: 'MUNICIPALITY',
  SENSOR: 'SENSOR',
  MANUAL_VERIFIED: 'MANUAL_VERIFIED',
  THIRD_PARTY: 'THIRD_PARTY',
} as const;
export type MultiplierSourceType = (typeof MultiplierSourceType)[keyof typeof MultiplierSourceType];

export const PacingStatus = {
  UNDERPACING: 'UNDERPACING',
  ON_TRACK: 'ON_TRACK',
  OVERPACING: 'OVERPACING',
} as const;
export type PacingStatus = (typeof PacingStatus)[keyof typeof PacingStatus];

export const PlayerHealth = { ONLINE: 'ONLINE', WARNING: 'WARNING', OFFLINE: 'OFFLINE' } as const;
export type PlayerHealth = (typeof PlayerHealth)[keyof typeof PlayerHealth];

export const VenueType = ['mall', 'metro', 'ferry', 'airport', 'street', 'office', 'other'] as const;
export type VenueType = (typeof VenueType)[number];
