-- 088_metrics_provenance_guard.sql
--
-- public.metrics is written by the server only (docs/platform D1/D2).
--
-- Before: migration 023 let the company owner INSERT/UPDATE metric rows
-- through PostgREST (policies metrics_insert_own / metrics_update_own), and
-- staff could UPDATE any row (metrics_admin_update). The row carries
-- `source`, `confidence` and `provenance`, so a browser could store e.g.
-- source='document', confidence=1.0 for a number nobody uploaded — and every
-- downstream view (catalog, KPI tiles, Point A inputs, history) would treat it
-- as a fact.
--
-- After: `anon` / `authenticated` have no INSERT / UPDATE / DELETE (nor
-- TRUNCATE, which bypasses RLS) on public.metrics. Materialisation runs on
-- the server with the service role AFTER lib/tenancy authorised the company:
--   POST /api/v1/metrics/materialize, POST /api/v1/point-a/aggregate
--   (lib/metrics/materialize-tenant.ts, lib/point-a/aggregator.ts writeClient).
-- The INSERT/UPDATE policies are dropped as well: without the grant they grant
-- nothing, and if a grant ever came back they would reopen the hole.
--
-- Unchanged: SELECT (metrics_select_own, metrics_admin_select,
-- metrics_tenant_select), Realtime, the metric_value_history trigger (085,
-- SECURITY DEFINER — still records every service-role write).
-- Also: TRUNCATE on metric_value_history revoked from API roles (085 revoked
-- INSERT/UPDATE/DELETE only; TRUNCATE ignores RLS).
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/088_metrics_provenance_guard.sql
-- Verify:            node scripts/verify-migration-088.js

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.metrics FROM anon, authenticated;

DROP POLICY IF EXISTS metrics_insert_own   ON public.metrics;
DROP POLICY IF EXISTS metrics_update_own   ON public.metrics;
DROP POLICY IF EXISTS metrics_admin_update ON public.metrics;

DO $$
BEGIN
  IF to_regclass('public.metric_value_history') IS NOT NULL THEN
    EXECUTE 'REVOKE TRUNCATE ON public.metric_value_history FROM anon, authenticated';
  END IF;
END $$;

COMMENT ON TABLE public.metrics IS
  'Materialised metric values (latest per key/period/source). Written only by the service role after tenant authorisation (088); history in metric_value_history.';

NOTIFY pgrst, 'reload schema';
