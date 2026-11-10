-- Prisma şemasında ifade edilemeyen kurallar (Spec v2 §35).

-- audit_logs append-only: normal uygulama yoluyla UPDATE/DELETE yapılamaz.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- Geçerli flight.
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_flight_valid" CHECK ("endAt" > "startAt");

-- Multiplier > 0 ve geçerlilik aralığı tutarlı.
ALTER TABLE "multiplier_profiles" ADD CONSTRAINT "multiplier_value_positive" CHECK ("value" > 0);
ALTER TABLE "multiplier_profiles" ADD CONSTRAINT "multiplier_validity_valid" CHECK ("validTo" IS NULL OR "validTo" > "validFrom");

-- Deterministik impression hesabı: aynı ekranda, aynı spesifiklikte (daypart + gün seti aynı)
-- iki ONAYLI profil aynı anı kapsayamaz. Daha spesifik profil genel profilin üstüne binebilir.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "multiplier_profiles" ADD CONSTRAINT "multiplier_no_approved_overlap"
  EXCLUDE USING gist (
    "screenId" WITH =,
    "specificityKey" WITH =,
    tstzrange("validFrom", "validTo", '[)') WITH &&
  ) WHERE ("approvalStatus" = 'APPROVED');

-- Ekran ve ticari alan sınırları.
ALTER TABLE "screens" ADD CONSTRAINT "screens_dimensions_positive"
  CHECK ("resolutionWidth" > 0 AND "resolutionHeight" > 0 AND "loopLengthSec" > 0 AND "defaultSlotLengthSec" > 0);
ALTER TABLE "venues" ADD CONSTRAINT "venues_geo_range"
  CHECK (("lat" IS NULL OR "lat" BETWEEN -90 AND 90) AND ("lon" IS NULL OR "lon" BETWEEN -180 AND 180));
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_share_sum"
  CHECK ("publisherSharePct" IS NULL OR "protargetSharePct" IS NULL OR "publisherSharePct" + "protargetSharePct" = 100);
