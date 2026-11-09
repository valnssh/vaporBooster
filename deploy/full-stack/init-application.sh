#!/bin/sh
set -eu
# Also run explicitly when upgrading an existing PostgreSQL volume.
: "${APP_DB_PASSWORD:?Run setup.py to generate the application database password}"
psql -X -q --set=ON_ERROR_STOP=1 --username postgres --dbname postgres --set=app_password="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE hoursbooster LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hoursbooster') \gexec
ALTER ROLE hoursbooster NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
SELECT 'CREATE DATABASE hoursbooster OWNER hoursbooster'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hoursbooster') \gexec
DO $$ BEGIN
  IF (SELECT datdba <> 'hoursbooster'::regrole FROM pg_database WHERE datname='hoursbooster') THEN
    RAISE EXCEPTION 'The hoursbooster database must have its own owner';
  END IF;
END $$;
REVOKE ALL ON DATABASE hoursbooster FROM PUBLIC;
REVOKE CONNECT ON DATABASE keycloak FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
\connect hoursbooster
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO hoursbooster;
SQL
