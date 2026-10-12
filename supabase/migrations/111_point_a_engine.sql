-- 111_point_a_engine.sql
--
-- Point A, phase 2 (docs/superpowers/specs/2026-10-12-point-a-full-design.md §2)
-- and the review fixes of the data layer (110):
--
--   metric_overrides.basis_signature  what a manual value was decided against;
--                                     new data of the period reopens it
--   replace_metric_facts()            facts of a company replaced atomically,
--                                     serialised per company
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/111_point_a_engine.sql

-- ─── Data layer fixes ───────────────────────────────────────────────────────
ALTER TABLE public.metric_overrides ADD COLUMN IF NOT EXISTS basis_signature TEXT;

CREATE OR REPLACE FUNCTION public.replace_metric_facts(p_company_id TEXT, p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('metric_facts:' || p_company_id));
  DELETE FROM public.metric_facts WHERE company_id = p_company_id;
  INSERT INTO public.metric_facts (
    company_id, metric_key, period_key, period_year, period_quarter, period_month, value, unit,
    source_kind, source_ref, source_refs, confidence, flags, is_current, observed_at, note, computed_at
  )
  SELECT p_company_id, r.metric_key, r.period_key, r.period_year, r.period_quarter, r.period_month, r.value, r.unit,
         r.source_kind, r.source_ref, COALESCE(r.source_refs, '{}'), COALESCE(r.confidence, 0), COALESCE(r.flags, '{}'),
         COALESCE(r.is_current, false), r.observed_at, r.note, COALESCE(r.computed_at, now())
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS r(
    metric_key TEXT, period_key TEXT, period_year INT, period_quarter SMALLINT, period_month SMALLINT,
    value NUMERIC, unit TEXT, source_kind TEXT, source_ref TEXT, source_refs TEXT[], confidence NUMERIC,
    flags TEXT[], is_current BOOLEAN, observed_at TIMESTAMPTZ, note TEXT, computed_at TIMESTAMPTZ
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.replace_metric_facts(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_metric_facts(TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
