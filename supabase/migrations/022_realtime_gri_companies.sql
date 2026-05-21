-- =============================================================================
-- AIStart360 — Migration 022: Realtime for gri_assessments + companies
--
-- Migration 016 enabled supabase_realtime on metrics/diagnostics/documents.
-- The /metrics page also subscribes to gri_assessments (introduced in 021)
-- and companies (revenue targets live there per migration 018). Without
-- being added to the publication, client-side useRealtimeSync bindings would
-- never fire, leaving the page stale after GRI submissions / target updates.
--
-- Idempotent — safe to re-run.
-- =============================================================================

-- 1. Add tables to the publication ------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'gri_assessments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.gri_assessments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'companies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.companies;
  END IF;
END
$$;

-- 2. REPLICA IDENTITY FULL so updates carry the full row ---------------------
ALTER TABLE public.gri_assessments REPLICA IDENTITY FULL;
ALTER TABLE public.companies        REPLICA IDENTITY FULL;

-- 3. PostgREST schema cache reload ------------------------------------------
NOTIFY pgrst, 'reload schema';
