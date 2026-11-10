-- psql variable is read from the environment, never a command argument or log.
\getenv runtime_password APP_DB_PASSWORD
SELECT 'CREATE ROLE protarget_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'protarget_app') \gexec
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = 'protarget_app'::regrole) THEN
    RAISE EXCEPTION 'Unexpected runtime role membership; resolve before deployment';
  END IF;
END $$;
SELECT format('ALTER ROLE protarget_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'runtime_password') \gexec
