-- Ek özellik "kapasite" (varsayılan kapalı): geçici slot tutma. Booking'i engellemez.
-- CreateTable
CREATE TABLE "screen_holds" (
    "id" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ NOT NULL,
    "endAt" TIMESTAMPTZ NOT NULL,
    "slots" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ,
    "releaseReason" TEXT,

    CONSTRAINT "screen_holds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "screen_holds_range_check" CHECK ("endAt" > "startAt"),
    CONSTRAINT "screen_holds_slots_check" CHECK ("slots" BETWEEN 1 AND 100),
    CONSTRAINT "screen_holds_label_check" CHECK (char_length(btrim("label")) BETWEEN 1 AND 120),
    CONSTRAINT "screen_holds_release_check" CHECK (("releasedAt" IS NULL) = ("releaseReason" IS NULL))
);

-- CreateIndex
CREATE INDEX "screen_holds_screenId_startAt_idx" ON "screen_holds"("screenId", "startAt");

-- AddForeignKey
ALTER TABLE "screen_holds" ADD CONSTRAINT "screen_holds_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screen_holds" ADD CONSTRAINT "screen_holds_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
