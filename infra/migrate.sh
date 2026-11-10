#!/bin/sh
set -eu
# Migration credentials belong only to this one-shot service, not the API/web.
export PGHOST=postgres PGPORT=5432 PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD"
for database in "$POSTGRES_DB" "${POSTGRES_DB}_test"; do
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${database}"
  export PGDATABASE="$database"
  pnpm --filter @protarget/api exec prisma migrate deploy
  psql --no-psqlrc -v ON_ERROR_STOP=1 -f infra/runtime-grants.sql
done
