-- Ek özellik "satış araçları" (varsayılan kapalı): sürümlü liste fiyatı ve hazır paketler.
-- CreateTable
CREATE TABLE "screen_rates" (
    "id" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "dailyRate" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "validFrom" TIMESTAMPTZ NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screen_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_packages" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sales_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_package_screens" (
    "packageId" UUID NOT NULL,
    "screenId" UUID NOT NULL,

    CONSTRAINT "sales_package_screens_pkey" PRIMARY KEY ("packageId","screenId")
);

-- CreateIndex
CREATE UNIQUE INDEX "screen_rates_screenId_validFrom_key" ON "screen_rates"("screenId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "sales_packages_name_key" ON "sales_packages"("name");

-- CreateIndex
CREATE INDEX "sales_package_screens_screenId_idx" ON "sales_package_screens"("screenId");

-- AddForeignKey
ALTER TABLE "screen_rates" ADD CONSTRAINT "screen_rates_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screen_rates" ADD CONSTRAINT "screen_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_package_screens" ADD CONSTRAINT "sales_package_screens_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "sales_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_package_screens" ADD CONSTRAINT "sales_package_screens_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Kural kısıtları
ALTER TABLE "screen_rates" ADD CONSTRAINT "screen_rates_rate_check" CHECK ("dailyRate" > 0);
ALTER TABLE "sales_packages" ADD CONSTRAINT "sales_packages_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120);

-- Fiyat sürümleri salt eklenir: değişiklik yeni sürümle yapılır.
CREATE FUNCTION screen_rates_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'screen_rates is append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER screen_rates_append_only BEFORE UPDATE OR DELETE ON "screen_rates"
  FOR EACH ROW EXECUTE FUNCTION screen_rates_append_only();
