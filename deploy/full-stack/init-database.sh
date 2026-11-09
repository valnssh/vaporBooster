#!/bin/sh
set -eu
# Official PostgreSQL entrypoint runs this once on an empty data volume.
# psql quotes the password as a SQL value; it never becomes executable SQL.
psql --username postgres --dbname postgres --set=keycloak_password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
CREATE ROLE keycloak LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'keycloak_password';
CREATE DATABASE keycloak OWNER keycloak;
SQL
