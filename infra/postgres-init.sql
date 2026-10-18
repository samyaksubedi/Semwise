-- Runs once, when the local database volume is first created.
--
-- Two roles:
--   semwise      owns the tables and runs migrations (MIGRATION_DATABASE_URL)
--   semwise_app  what the API and worker connect as (DATABASE_URL). It is not a superuser and
--                cannot bypass row-level security, so the RLS policies really apply to it.
-- And a separate database for automated tests (semwise_test), so they never touch local data.

CREATE ROLE semwise_app LOGIN PASSWORD 'semwise_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE DATABASE semwise_test OWNER semwise;

\connect semwise
GRANT USAGE ON SCHEMA public TO semwise_app;
ALTER DEFAULT PRIVILEGES FOR ROLE semwise IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO semwise_app;
ALTER DEFAULT PRIVILEGES FOR ROLE semwise IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO semwise_app;

\connect semwise_test
GRANT USAGE ON SCHEMA public TO semwise_app;
ALTER DEFAULT PRIVILEGES FOR ROLE semwise IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO semwise_app;
ALTER DEFAULT PRIVILEGES FOR ROLE semwise IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO semwise_app;
