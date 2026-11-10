#!/bin/sh
set -eu
psql --no-psqlrc --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
\getenv app_password APP_DB_PASSWORD
\getenv database POSTGRES_DB
SELECT format('CREATE ROLE protarget_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'protarget_app') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database' || '_test', current_user)
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'database' || '_test') \gexec
SQL
