-- Additive migration: retain historical values, sources, identities and constraints.
ALTER TYPE "MultiplierSourceType" ADD VALUE 'MANUAL';

ALTER TABLE "screens"
  ADD COLUMN "cmsName" TEXT,
  ADD COLUMN "cmsVersion" TEXT,
  ADD COLUMN "cmsReference" TEXT,
  ADD COLUMN "notes" TEXT,
  ALTER COLUMN "playerType" SET DEFAULT 'EXTERNAL_SIGNAGE',
  ALTER COLUMN "dealEligible" SET DEFAULT false,
  ALTER COLUMN "resolutionWidth" DROP NOT NULL,
  ALTER COLUMN "resolutionHeight" DROP NOT NULL,
  ALTER COLUMN "orientation" DROP NOT NULL,
  ALTER COLUMN "loopLengthSec" DROP NOT NULL,
  ALTER COLUMN "defaultSlotLengthSec" DROP NOT NULL,
  ALTER COLUMN "defaultSlotLengthSec" DROP DEFAULT,
  ALTER COLUMN "operatingStart" DROP NOT NULL,
  ALTER COLUMN "operatingEnd" DROP NOT NULL;

-- NOT VALID preserves any legacy inconsistencies without rewriting history.
-- PostgreSQL still enforces this constraint for every new/updated row.
ALTER TABLE "screens" ADD CONSTRAINT "screens_slot_within_loop"
  CHECK ("defaultSlotLengthSec" IS NULL OR "loopLengthSec" IS NULL
    OR "defaultSlotLengthSec" <= "loopLengthSec") NOT VALID;
ALTER TABLE "screens" ADD CONSTRAINT "screens_operating_hours_valid"
  CHECK (
    ("operatingStart" IS NULL AND "operatingEnd" IS NULL) OR
    ("operatingStart" IS NOT NULL AND "operatingEnd" IS NOT NULL
      AND "operatingStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND "operatingEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND "operatingStart" <> "operatingEnd")
  ) NOT VALID;

ALTER TABLE "multiplier_profiles" ADD COLUMN "changeReason" TEXT;

-- Preserve legacy spelling while preventing new case/whitespace variants of its identity.
-- Abort on pre-existing canonical duplicates rather than silently relabel physical screens.
CREATE UNIQUE INDEX "screens_code_canonical_key" ON "screens" (upper(btrim("screenId")));

ALTER TABLE "multiplier_profiles" ADD CONSTRAINT "multiplier_manual_whole_screen"
  CHECK ("sourceType"::text <> 'MANUAL' OR (
    "daypartStart" IS NULL AND "daypartEnd" IS NULL AND cardinality("weekdays") = 0
    AND "specificityKey" = '' AND length(btrim("sourceRef")) > 0
    AND "changeReason" IS NOT NULL AND length(btrim("changeReason")) > 0
  )) NOT VALID;
