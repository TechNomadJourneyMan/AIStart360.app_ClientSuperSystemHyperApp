-- 156_archive_legacy_crm_integrations.down.sql — ROLLBACK of migration 156.
--
-- NOT part of the migration sequence (appliers read only supabase/migrations/*.sql).
-- Moves the legacy CRM table back from the `archive` schema to `public`, with its rows, indexes and
-- keys (SET SCHEMA), still closed to the API roles (084: REVOKE ALL, RLS on). The `archive` schema
-- is dropped only when it is empty (RESTRICT): anything else archived there later stays.
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/156_archive_legacy_crm_integrations.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('archive.crm_integrations') IS NOT NULL
     AND to_regclass('public.crm_integrations') IS NULL THEN
    ALTER TABLE archive.crm_integrations SET SCHEMA public;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.crm_integrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.crm_integrations FROM anon, authenticated;
    COMMENT ON TABLE public.crm_integrations IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'archive')
     AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'archive') THEN
    DROP SCHEMA archive RESTRICT;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
