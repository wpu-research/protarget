-- Additive Phase 0 migration. No later-phase table or audit trigger is removed.
CREATE TABLE "sessions" (
  "id" UUID NOT NULL PRIMARY KEY,
  "familyId" UUID NOT NULL,
  "userId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "orgId" UUID NOT NULL,
  "role" "Role" NOT NULL,
  "accessTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "revokedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "sessions_access_hash" CHECK ("accessTokenHash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "sessions_familyId_key" ON "sessions"("familyId");
CREATE UNIQUE INDEX "sessions_accessTokenHash_key" ON "sessions"("accessTokenHash");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

ALTER TABLE "refresh_tokens" ADD COLUMN "sessionId" UUID,
  ADD COLUMN "usedAt" TIMESTAMPTZ,
  ADD CONSTRAINT "refresh_tokens_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE;
CREATE INDEX "refresh_tokens_sessionId_idx" ON "refresh_tokens"("sessionId");
-- Legacy tokens cannot authenticate without a tracked session; explicitly revoke them.
UPDATE "refresh_tokens" SET "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP)
  WHERE "sessionId" IS NULL;

CREATE TABLE "invitations" (
  "id" UUID NOT NULL PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "acceptedAt" TIMESTAMPTZ,
  "revokedAt" TIMESTAMPTZ,
  "deliveryStatus" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invitations_token_hash" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "invitations_delivery_status" CHECK ("deliveryStatus" IN ('pending', 'sent', 'failed'))
);
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");
CREATE INDEX "invitations_userId_idx" ON "invitations"("userId");
CREATE TABLE "auth_rate_limits" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "startedAt" TIMESTAMPTZ NOT NULL
);

-- Abort rather than silently merging existing identities that normalize to the same address.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" GROUP BY lower(btrim("email")) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Resolve duplicate normalized user emails before applying identity migration';
  END IF;
END $$;
UPDATE "users" SET "email" = lower(btrim("email"));
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized"
  CHECK ("email" = lower(btrim("email")));
