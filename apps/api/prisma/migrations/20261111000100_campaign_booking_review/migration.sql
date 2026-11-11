-- CR-1: CMS kanıtı tazeliği (planChangedAt), kreatif geri çekme (REVOKED), mükerrer/çatal koruması.
-- Yalnız eklemeli; veri silinmez.

-- AlterEnum
ALTER TYPE "CreativeStatus" ADD VALUE 'REVOKED';

-- AlterTable
ALTER TABLE "creatives" ADD COLUMN     "revocationReason" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMPTZ,
ADD COLUMN     "revokedById" UUID;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "planChangedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mevcut kampanyalar için planChangedAt, son güncelleme zamanından başlar.
UPDATE "campaigns" SET "planChangedAt" = "updatedAt";

-- Onaylanan kreatif değişmez; tek istisna gerekçeli APPROVED -> REVOKED geçişidir (üç geri çekme kolonuyla).
-- REVOKED satırı da dondurulur.
CREATE OR REPLACE FUNCTION creatives_approved_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'APPROVED' THEN
    IF NEW."status" = 'REVOKED' THEN
      IF (NEW."storageKey", NEW."checksum", NEW."mime", NEW."durationSeconds",
          NEW."width", NEW."height", NEW."sizeBytes", NEW."advertiserId")
          IS DISTINCT FROM (OLD."storageKey", OLD."checksum", OLD."mime", OLD."durationSeconds",
          OLD."width", OLD."height", OLD."sizeBytes", OLD."advertiserId")
         OR NEW."revokedAt" IS NULL OR NEW."revokedById" IS NULL OR NEW."revocationReason" IS NULL THEN
        RAISE EXCEPTION 'approved creative can only be revoked with a reason' USING ERRCODE = '23514';
      END IF;
    ELSIF (NEW."storageKey", NEW."checksum", NEW."mime", NEW."durationSeconds",
        NEW."width", NEW."height", NEW."sizeBytes", NEW."advertiserId", NEW."status")
        IS DISTINCT FROM (OLD."storageKey", OLD."checksum", OLD."mime", OLD."durationSeconds",
        OLD."width", OLD."height", OLD."sizeBytes", OLD."advertiserId", OLD."status") THEN
      RAISE EXCEPTION 'approved creative is immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."status" = 'REVOKED' THEN
    IF (NEW."storageKey", NEW."checksum", NEW."mime", NEW."durationSeconds", NEW."width", NEW."height", NEW."sizeBytes",
        NEW."advertiserId", NEW."status", NEW."revokedAt", NEW."revokedById", NEW."revocationReason")
        IS DISTINCT FROM (OLD."storageKey", OLD."checksum", OLD."mime", OLD."durationSeconds", OLD."width", OLD."height", OLD."sizeBytes",
        OLD."advertiserId", OLD."status", OLD."revokedAt", OLD."revokedById", OLD."revocationReason") THEN
      RAISE EXCEPTION 'revoked creative is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reddedilmemiş kreatifler için reklamveren başına tekil içerik; REJECTED kayıtlar mükerrer sayılmaz.
CREATE UNIQUE INDEX "creatives_advertiser_checksum_live_key" ON "creatives"("advertiserId", "checksum")
  WHERE "status" <> 'REJECTED' AND "checksum" IS NOT NULL;

-- Sürüm zinciri çatallanamaz: bir kreatifi reddedilmemiş yalnız tek sürüm devralır.
CREATE UNIQUE INDEX "creatives_replacesId_live_key" ON "creatives"("replacesId")
  WHERE "replacesId" IS NOT NULL AND "status" <> 'REJECTED';
