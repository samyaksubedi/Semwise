#!/bin/sh
# Runs once, when the production database volume is first created (docker-entrypoint-initdb.d).
# POSTGRES_USER owns the tables and runs migrations; the API and the worker connect as the app
# role, which is not a superuser and cannot bypass row-level security (they refuse to start
# otherwise). The password comes from APP_DB_PASSWORD and is never written to a file.
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE semwise_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO semwise_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO semwise_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO semwise_app;
SQL
