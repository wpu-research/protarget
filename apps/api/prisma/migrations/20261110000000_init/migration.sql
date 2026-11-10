-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('ADMIN', 'AGENCY', 'ADVERTISER', 'MEDIA_OWNER');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'AGENCY', 'ADVERTISER', 'SUPPORT');

-- CreateEnum
CREATE TYPE "VenueType" AS ENUM ('mall', 'metro', 'ferry', 'airport', 'street', 'office', 'other');

-- CreateEnum
CREATE TYPE "Orientation" AS ENUM ('LANDSCAPE', 'PORTRAIT');

-- CreateEnum
CREATE TYPE "PlayerType" AS ENUM ('PROTARGET_PLAYER', 'EXTERNAL_SIGNAGE');

-- CreateEnum
CREATE TYPE "PlayerHealth" AS ENUM ('ONLINE', 'WARNING', 'OFFLINE');

-- CreateEnum
CREATE TYPE "MultiplierSourceType" AS ENUM ('CAMERA', 'MUNICIPALITY', 'SENSOR', 'MANUAL_VERIFIED', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "CreativeStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'READY', 'LIVE', 'LIVE_WITH_EXTERNAL_ERROR', 'PAUSING', 'PAUSED', 'PAUSED_WITH_EXTERNAL_ERROR', 'RESUMING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('CPM', 'CPP', 'FIXED', 'PG');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('TRY', 'USD');

-- CreateEnum
CREATE TYPE "PgBillingBasis" AS ENUM ('CONTRACTED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "CampaignPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'GUARANTEED');

-- CreateEnum
CREATE TYPE "DistributionMode" AS ENUM ('EVEN', 'MANUAL');

-- CreateEnum
CREATE TYPE "PacingStatus" AS ENUM ('UNDERPACING', 'ON_TRACK', 'OVERPACING');

-- CreateEnum
CREATE TYPE "PlaybackResult" AS ENUM ('success', 'failed', 'skipped', 'corrupted', 'timeout');

-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('PMP', 'PREFERRED', 'PG', 'DIRECT');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('DRAFT', 'SENT', 'NEGOTIATING', 'ACCEPTED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ERROR');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL', 'SECURITY');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "brandName" TEXT,
    "taxLegalLabel" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "spendVisible" BOOLEAN NOT NULL DEFAULT false,
    "revenueShareVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT,
    "ssoId" TEXT,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_permissions" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "userId" UUID,
    "orgId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "VenueType" NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Turkey',
    "city" TEXT NOT NULL,
    "district" TEXT,
    "lat" DECIMAL(9,6),
    "lon" DECIMAL(9,6),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "ownerOrgId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screens" (
    "id" UUID NOT NULL,
    "screenId" TEXT NOT NULL,
    "screenIdLocked" BOOLEAN NOT NULL DEFAULT false,
    "venueId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT,
    "locationLabel" TEXT,
    "resolutionWidth" INTEGER NOT NULL,
    "resolutionHeight" INTEGER NOT NULL,
    "orientation" "Orientation" NOT NULL,
    "physicalSize" TEXT,
    "playerType" "PlayerType" NOT NULL,
    "os" TEXT,
    "loopLengthSec" INTEGER NOT NULL,
    "defaultSlotLengthSec" INTEGER NOT NULL DEFAULT 10,
    "operatingStart" TEXT NOT NULL,
    "operatingEnd" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "floorCpm" DECIMAL(18,4),
    "floorCpp" DECIMAL(18,4),
    "directRate" DECIMAL(18,4),
    "revenueSharePct" DECIMAL(5,2),
    "dealEligible" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastPlaybackAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "screens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screen_external_mappings" (
    "id" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "connector" TEXT NOT NULL,
    "externalInventoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screen_external_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "tokenHash" TEXT,
    "credentialVersion" INTEGER NOT NULL DEFAULT 0,
    "provisioningCodeHash" TEXT,
    "provisioningExpiresAt" TIMESTAMPTZ,
    "version" TEXT,
    "os" TEXT,
    "health" "PlayerHealth" NOT NULL DEFAULT 'OFFLINE',
    "lastHeartbeat" TIMESTAMPTZ,
    "diskFreeBytes" BIGINT,
    "currentManifestVersion" TEXT,
    "lastSuccessfulPlayback" TIMESTAMPTZ,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "forceRefresh" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multiplier_profiles" (
    "id" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "sourceType" "MultiplierSourceType" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ NOT NULL,
    "validTo" TIMESTAMPTZ,
    "daypartStart" TEXT,
    "daypartEnd" TEXT,
    "weekdays" INTEGER[],
    "specificityKey" TEXT NOT NULL DEFAULT '',
    "confidenceNote" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL,
    "createdBy" UUID NOT NULL,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMPTZ,
    "supersedesId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multiplier_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creatives" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "advertiserId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "durationSeconds" DECIMAL(8,3),
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" BIGINT,
    "checksum" TEXT,
    "status" "CreativeStatus" NOT NULL DEFAULT 'UPLOADED',
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "replacesId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "advertiserId" UUID NOT NULL,
    "agencyId" UUID,
    "internalOwnerId" UUID NOT NULL,
    "startAt" TIMESTAMPTZ NOT NULL,
    "endAt" TIMESTAMPTZ NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "notes" TEXT,
    "pricingModel" "PricingModel",
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "unitPrice" DECIMAL(18,4),
    "budget" DECIMAL(18,4),
    "contractedAmount" DECIMAL(18,4),
    "guaranteedImpressions" BIGINT,
    "contractedQuantity" BIGINT,
    "targetPlayouts" BIGINT,
    "overdeliveryTolerancePct" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "pgBillingBasis" "PgBillingBasis" NOT NULL DEFAULT 'CONTRACTED',
    "publisherSharePct" DECIMAL(5,2),
    "protargetSharePct" DECIMAL(5,2),
    "priority" "CampaignPriority" NOT NULL DEFAULT 'NORMAL',
    "distributionMode" "DistributionMode" NOT NULL DEFAULT 'EVEN',
    "maxPlayoutsPerHourPerScreen" INTEGER,
    "dealRequired" BOOLEAN NOT NULL DEFAULT false,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "pacingStatus" "PacingStatus",
    "pacingRatio" DECIMAL(8,4),
    "pacingCalculatedAt" TIMESTAMPTZ,
    "launchedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_screens" (
    "campaignId" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "allocationWeight" DECIMAL(9,4) NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "dailyCap" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_screens_pkey" PRIMARY KEY ("campaignId","screenId")
);

-- CreateTable
CREATE TABLE "campaign_creatives" (
    "campaignId" UUID NOT NULL,
    "creativeId" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_creatives_pkey" PRIMARY KEY ("campaignId","creativeId")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "screenId" UUID,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifests" (
    "id" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "manifestVersion" TEXT NOT NULL,
    "validUntil" TIMESTAMPTZ NOT NULL,
    "payload" JSONB NOT NULL,
    "builtAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMPTZ,

    CONSTRAINT "manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_slots" (
    "id" UUID NOT NULL,
    "slotCode" TEXT NOT NULL,
    "manifestId" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "creativeId" UUID NOT NULL,
    "validFrom" TIMESTAMPTZ NOT NULL,
    "validTo" TIMESTAMPTZ NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "fulfilled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "scheduled_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proof_of_play" (
    "id" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "campaignId" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "creativeId" UUID NOT NULL,
    "scheduledSlotCode" TEXT,
    "playedAt" TIMESTAMPTZ NOT NULL,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSeconds" DECIMAL(8,3) NOT NULL,
    "result" "PlaybackResult" NOT NULL,
    "offlineRecorded" BOOLEAN NOT NULL DEFAULT false,
    "playerVersion" TEXT,
    "clockDriftSuspected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "proof_of_play_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impression_events" (
    "id" UUID NOT NULL,
    "popId" UUID NOT NULL,
    "multiplierProfileId" UUID NOT NULL,
    "estimatedImpressions" DECIMAL(18,4) NOT NULL,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impression_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "internalId" TEXT NOT NULL,
    "type" "DealType" NOT NULL,
    "connector" TEXT NOT NULL,
    "sellerPlatform" TEXT,
    "dsp" TEXT,
    "buyerSeatId" TEXT,
    "currency" "Currency" NOT NULL,
    "cpm" DECIMAL(18,4),
    "guaranteedImpressions" BIGINT,
    "startAt" TIMESTAMPTZ,
    "endAt" TIMESTAMPTZ,
    "inventoryScope" TEXT,
    "externalId" TEXT,
    "status" "DealStatus" NOT NULL DEFAULT 'DRAFT',
    "rawExternalStatus" JSONB,
    "lastSyncedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_sync_logs" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "request" JSONB,
    "response" JSONB,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_delivery_reports" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "externalImpressions" BIGINT NOT NULL,
    "raw" JSONB,
    "fetchedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_delivery_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_errors" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "resolvedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_error_logs" (
    "id" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT,
    "details" JSONB,
    "occurredAt" TIMESTAMPTZ NOT NULL,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "daily_campaign_screen_delivery" (
    "date" DATE NOT NULL,
    "campaignId" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "playouts" INTEGER NOT NULL DEFAULT 0,
    "failedPlayouts" INTEGER NOT NULL DEFAULT 0,
    "estimatedImpressions" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "estimatedSpend" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "daily_campaign_screen_delivery_pkey" PRIMARY KEY ("date","campaignId","screenId")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_orgId_idx" ON "users"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "campaign_permissions_campaignId_idx" ON "campaign_permissions"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "screens_screenId_key" ON "screens"("screenId");

-- CreateIndex
CREATE INDEX "screens_venueId_idx" ON "screens"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "screen_external_mappings_screenId_connector_key" ON "screen_external_mappings"("screenId", "connector");

-- CreateIndex
CREATE UNIQUE INDEX "players_screenId_key" ON "players"("screenId");

-- CreateIndex
CREATE INDEX "multiplier_profiles_screenId_approvalStatus_validFrom_idx" ON "multiplier_profiles"("screenId", "approvalStatus", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "multiplier_profiles_screenId_version_key" ON "multiplier_profiles"("screenId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "creatives_code_key" ON "creatives"("code");

-- CreateIndex
CREATE INDEX "creatives_advertiserId_idx" ON "creatives"("advertiserId");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_code_key" ON "campaigns"("code");

-- CreateIndex
CREATE INDEX "campaigns_advertiserId_idx" ON "campaigns"("advertiserId");

-- CreateIndex
CREATE INDEX "campaigns_agencyId_idx" ON "campaigns"("agencyId");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaign_screens_screenId_idx" ON "campaign_screens"("screenId");

-- CreateIndex
CREATE INDEX "schedules_campaignId_idx" ON "schedules"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "manifests_manifestVersion_key" ON "manifests"("manifestVersion");

-- CreateIndex
CREATE INDEX "manifests_screenId_builtAt_idx" ON "manifests"("screenId", "builtAt");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_slots_slotCode_key" ON "scheduled_slots"("slotCode");

-- CreateIndex
CREATE INDEX "scheduled_slots_campaignId_validFrom_idx" ON "scheduled_slots"("campaignId", "validFrom");

-- CreateIndex
CREATE INDEX "scheduled_slots_screenId_validFrom_idx" ON "scheduled_slots"("screenId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "proof_of_play_eventId_key" ON "proof_of_play"("eventId");

-- CreateIndex
CREATE INDEX "proof_of_play_campaignId_playedAt_idx" ON "proof_of_play"("campaignId", "playedAt");

-- CreateIndex
CREATE INDEX "proof_of_play_screenId_playedAt_idx" ON "proof_of_play"("screenId", "playedAt");

-- CreateIndex
CREATE UNIQUE INDEX "impression_events_popId_calculationVersion_key" ON "impression_events"("popId", "calculationVersion");

-- CreateIndex
CREATE UNIQUE INDEX "deals_internalId_key" ON "deals"("internalId");

-- CreateIndex
CREATE INDEX "deals_campaignId_idx" ON "deals"("campaignId");

-- CreateIndex
CREATE INDEX "deal_sync_logs_dealId_createdAt_idx" ON "deal_sync_logs"("dealId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "external_delivery_reports_dealId_date_key" ON "external_delivery_reports"("dealId", "date");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "ops_errors_code_resolvedAt_idx" ON "ops_errors"("code", "resolvedAt");

-- CreateIndex
CREATE INDEX "ops_errors_createdAt_idx" ON "ops_errors"("createdAt");

-- CreateIndex
CREATE INDEX "player_error_logs_screenId_occurredAt_idx" ON "player_error_logs"("screenId", "occurredAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_permissions" ADD CONSTRAINT "campaign_permissions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_permissions" ADD CONSTRAINT "campaign_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_permissions" ADD CONSTRAINT "campaign_permissions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_ownerOrgId_fkey" FOREIGN KEY ("ownerOrgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screens" ADD CONSTRAINT "screens_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screen_external_mappings" ADD CONSTRAINT "screen_external_mappings_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multiplier_profiles" ADD CONSTRAINT "multiplier_profiles_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_internalOwnerId_fkey" FOREIGN KEY ("internalOwnerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_screens" ADD CONSTRAINT "campaign_screens_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_screens" ADD CONSTRAINT "campaign_screens_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_creatives" ADD CONSTRAINT "campaign_creatives_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_creatives" ADD CONSTRAINT "campaign_creatives_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "creatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_slots" ADD CONSTRAINT "scheduled_slots_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "manifests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_slots" ADD CONSTRAINT "scheduled_slots_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_slots" ADD CONSTRAINT "scheduled_slots_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proof_of_play" ADD CONSTRAINT "proof_of_play_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proof_of_play" ADD CONSTRAINT "proof_of_play_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impression_events" ADD CONSTRAINT "impression_events_popId_fkey" FOREIGN KEY ("popId") REFERENCES "proof_of_play"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impression_events" ADD CONSTRAINT "impression_events_multiplierProfileId_fkey" FOREIGN KEY ("multiplierProfileId") REFERENCES "multiplier_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_sync_logs" ADD CONSTRAINT "deal_sync_logs_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_delivery_reports" ADD CONSTRAINT "external_delivery_reports_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_error_logs" ADD CONSTRAINT "player_error_logs_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_campaign_screen_delivery" ADD CONSTRAINT "daily_campaign_screen_delivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_campaign_screen_delivery" ADD CONSTRAINT "daily_campaign_screen_delivery_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

