-- 144_access_request_dedup.down.sql — ROLLBACK of migration 144.
--
-- NOT part of the migration sequence (scripts/test-db/setup.mjs and go-live
-- checks read only supabase/migrations/*.sql, not sub-folders).
-- Drops the unique index; no data is changed. After it the application check
-- (lib/access/upgrade-requests.ts) still prevents duplicates of open paid-access
-- requests, only the race of two simultaneous clicks is no longer closed.
--   node scripts/apply-migration.js supabase/migrations/rollback/144_access_request_dedup.down.sql

SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS public.admin_requests_open_paywall_per_user;
