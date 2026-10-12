-- 113_point_a_review_fixes.sql
--
-- Review fixes of Point A phase 2 (111):
--   point_a_recalc_queue.first_requested_at  ceiling of the debounce: a stream
--                                            of events postpones a recalculation
--                                            at most 2 minutes
--   TRUNCATE revoked from API roles on the data-layer / Point A tables
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/113_point_a_review_fixes.sql

ALTER TABLE public.point_a_recalc_queue
  ADD COLUMN IF NOT EXISTS first_requested_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'metric_facts', 'data_discrepancies', 'metric_overrides',
    'pa_templates', 'pa_company_config', 'point_a_snapshots', 'point_a_recalc_queue'
  ] LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
