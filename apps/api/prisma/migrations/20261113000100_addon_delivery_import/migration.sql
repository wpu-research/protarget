-- Ek özellik "oynatma kaydı" (varsayılan kapalı): CSV içe aktarma, kaynak etiketli teslimat satırları.
-- CreateEnum
CREATE TYPE "DeliverySource" AS ENUM ('CMS_VERIFIED', 'OPERATOR_DECLARED', 'DECLARED_IMPRESSION');

-- CreateTable
CREATE TABLE "delivery_import_batches" (
    "id" UUID NOT NULL,
    "source" "DeliverySource" NOT NULL,
    "filename" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "note" TEXT,
    "rowCount" INTEGER NOT NULL,
    "acceptedCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_records" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "source" "DeliverySource" NOT NULL,
    "campaignId" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "creativeId" UUID,
    "playedAt" TIMESTAMPTZ NOT NULL,
    "count" INTEGER NOT NULL,
    "impressions" DECIMAL(18,4),
    "durationSeconds" DECIMAL(8,3),
    "externalId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ,
    "voidReason" TEXT,
    "voidedById" UUID,

    CONSTRAINT "delivery_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_import_batches_source_fileSha256_key" ON "delivery_import_batches"("source", "fileSha256");

-- CreateIndex
CREATE INDEX "delivery_records_campaignId_playedAt_idx" ON "delivery_records"("campaignId", "playedAt");

-- CreateIndex
CREATE INDEX "delivery_records_screenId_playedAt_idx" ON "delivery_records"("screenId", "playedAt");

-- CreateIndex
CREATE INDEX "delivery_records_dedupeKey_idx" ON "delivery_records"("dedupeKey");

-- AddForeignKey
ALTER TABLE "delivery_import_batches" ADD CONSTRAINT "delivery_import_batches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "delivery_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "creatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Kural kısıtları
ALTER TABLE "delivery_import_batches"
  ADD CONSTRAINT "delivery_import_batches_counts_check" CHECK ("rowCount" >= 0 AND "acceptedCount" >= 0 AND "duplicateCount" >= 0 AND "acceptedCount" + "duplicateCount" <= "rowCount"),
  ADD CONSTRAINT "delivery_import_batches_sha_check" CHECK ("fileSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "delivery_records"
  ADD CONSTRAINT "delivery_records_count_check" CHECK ("count" BETWEEN 1 AND 999999),
  ADD CONSTRAINT "delivery_records_impressions_check" CHECK (("source" = 'DECLARED_IMPRESSION') = ("impressions" IS NOT NULL) AND ("impressions" IS NULL OR "impressions" > 0)),
  ADD CONSTRAINT "delivery_records_void_check" CHECK (("voidedAt" IS NULL) = ("voidReason" IS NULL) AND ("voidedAt" IS NULL) = ("voidedById" IS NULL));

-- İptal edilmemiş satırlar arasında tekilleştirme
CREATE UNIQUE INDEX "delivery_records_dedupeKey_active_key" ON "delivery_records"("dedupeKey") WHERE "voidedAt" IS NULL;

-- Salt eklenir: silme yok; güncelleme yalnız bir kez iptal (voidedAt/voidReason/voidedById) için.
CREATE FUNCTION delivery_records_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'delivery_records is append-only' USING ERRCODE = '23514';
  END IF;
  IF OLD."voidedAt" IS NOT NULL
     OR (to_jsonb(NEW) - 'voidedAt' - 'voidReason' - 'voidedById') <> (to_jsonb(OLD) - 'voidedAt' - 'voidReason' - 'voidedById') THEN
    RAISE EXCEPTION 'delivery_records rows can only be voided once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER delivery_records_append_only BEFORE UPDATE OR DELETE ON "delivery_records"
  FOR EACH ROW EXECUTE FUNCTION delivery_records_append_only();
CREATE FUNCTION delivery_import_batches_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'delivery_import_batches is append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER delivery_import_batches_append_only BEFORE UPDATE OR DELETE ON "delivery_import_batches"
  FOR EACH ROW EXECUTE FUNCTION delivery_import_batches_append_only();
