-- CreateEnum
CREATE TYPE "CampaignGoal" AS ENUM ('PLAYOUTS', 'IMPRESSIONS');

-- CreateEnum
CREATE TYPE "CmsOperationType" AS ENUM ('CMS_UPLOADED', 'PLAYBACK_STARTED', 'PLAYBACK_PAUSED', 'PLAYBACK_RESUMED', 'PLAYBACK_STOPPED', 'NOTE');

-- AlterTable
ALTER TABLE "creatives" ADD COLUMN     "approvedAt" TIMESTAMPTZ,
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "durationManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "uploadedById" UUID,
ADD COLUMN     "videoCodec" TEXT;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "primaryGoal" "CampaignGoal",
ADD COLUMN     "targetImpressions" BIGINT;

-- CreateTable
CREATE TABLE "campaign_cms_operations" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "type" "CmsOperationType" NOT NULL,
    "performedAt" TIMESTAMPTZ NOT NULL,
    "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID NOT NULL,
    "cmsReference" TEXT,
    "note" TEXT,

    CONSTRAINT "campaign_cms_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_cms_operations_campaignId_screenId_performedAt_idx" ON "campaign_cms_operations"("campaignId", "screenId", "performedAt");

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cms_operations" ADD CONSTRAINT "campaign_cms_operations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cms_operations" ADD CONSTRAINT "campaign_cms_operations_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_cms_operations" ADD CONSTRAINT "campaign_cms_operations_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Booking hedefleri ve ticari alanlar: yeni/değişen satırlarda zorunlu; NOT VALID mevcut satırları taramaz/silmez.
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_targets_positive"
  CHECK (("targetPlayouts" IS NULL OR "targetPlayouts" > 0) AND ("targetImpressions" IS NULL OR "targetImpressions" > 0)) NOT VALID;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_commercial_ranges"
  CHECK (("unitPrice" IS NULL OR "unitPrice" > 0) AND ("budget" IS NULL OR "budget" > 0)
    AND ("contractedAmount" IS NULL OR "contractedAmount" > 0)
    AND ("guaranteedImpressions" IS NULL OR "guaranteedImpressions" > 0)
    AND ("contractedQuantity" IS NULL OR "contractedQuantity" > 0)
    AND "overdeliveryTolerancePct" BETWEEN 0 AND 100
    AND ("publisherSharePct" IS NULL OR "publisherSharePct" BETWEEN 0 AND 100)
    AND ("protargetSharePct" IS NULL OR "protargetSharePct" BETWEEN 0 AND 100)
    AND ("maxPlayoutsPerHourPerScreen" IS NULL OR "maxPlayoutsPerHourPerScreen" > 0)) NOT VALID;
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_booking_shape"
  CHECK ("dayOfWeek" BETWEEN 1 AND 7 AND "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "startTime" <> "endTime") NOT VALID;
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_metadata_positive"
  CHECK (("durationSeconds" IS NULL OR "durationSeconds" > 0) AND ("width" IS NULL OR "width" > 0)
    AND ("height" IS NULL OR "height" > 0) AND ("sizeBytes" IS NULL OR "sizeBytes" > 0)) NOT VALID;

-- Kampanyaya yalnız aynı reklamverenin kreatifi bağlanabilir.
CREATE OR REPLACE FUNCTION campaign_creative_same_advertiser() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "campaigns" c JOIN "creatives" k ON k."advertiserId" = c."advertiserId"
                 WHERE c."id" = NEW."campaignId" AND k."id" = NEW."creativeId") THEN
    RAISE EXCEPTION 'creative advertiser must match campaign advertiser' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER campaign_creatives_same_advertiser
  BEFORE INSERT OR UPDATE ON "campaign_creatives"
  FOR EACH ROW EXECUTE FUNCTION campaign_creative_same_advertiser();

-- Onaylanan kreatifin dosyası ve ölçülen metadata'sı değişmez.
CREATE OR REPLACE FUNCTION creatives_approved_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'APPROVED' AND (NEW."storageKey", NEW."checksum", NEW."mime", NEW."durationSeconds",
      NEW."width", NEW."height", NEW."sizeBytes", NEW."advertiserId", NEW."status")
      IS DISTINCT FROM (OLD."storageKey", OLD."checksum", OLD."mime", OLD."durationSeconds",
      OLD."width", OLD."height", OLD."sizeBytes", OLD."advertiserId", OLD."status") THEN
    RAISE EXCEPTION 'approved creative is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER creatives_approved_no_change
  BEFORE UPDATE ON "creatives"
  FOR EACH ROW EXECUTE FUNCTION creatives_approved_immutable();

-- CMS işlem kaydı salt eklenir ve yalnız kampanyada seçili ekran için yazılır.
CREATE OR REPLACE FUNCTION campaign_cms_operations_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'campaign_cms_operations is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER campaign_cms_operations_no_update_delete
  BEFORE UPDATE OR DELETE ON "campaign_cms_operations"
  FOR EACH ROW EXECUTE FUNCTION campaign_cms_operations_immutable();
CREATE TRIGGER campaign_cms_operations_no_truncate
  BEFORE TRUNCATE ON "campaign_cms_operations"
  FOR EACH STATEMENT EXECUTE FUNCTION campaign_cms_operations_immutable();

CREATE OR REPLACE FUNCTION campaign_cms_operation_screen_selected() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "campaign_screens" s
                 WHERE s."campaignId" = NEW."campaignId" AND s."screenId" = NEW."screenId") THEN
    RAISE EXCEPTION 'screen is not part of the campaign' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER campaign_cms_operations_screen_selected
  BEFORE INSERT ON "campaign_cms_operations"
  FOR EACH ROW EXECUTE FUNCTION campaign_cms_operation_screen_selected();

CREATE INDEX "creatives_advertiser_checksum_idx" ON "creatives"("advertiserId", "checksum");
