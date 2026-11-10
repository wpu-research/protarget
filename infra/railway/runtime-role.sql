-- psql variable is read from the environment, never a command argument or log.
\getenv runtime_password APP_DB_PASSWORD
SELECT 'CREATE ROLE protarget_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'protarget_app') \gexec
SELECT format('ALTER ROLE protarget_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',
  :'runtime_password') \gexec
