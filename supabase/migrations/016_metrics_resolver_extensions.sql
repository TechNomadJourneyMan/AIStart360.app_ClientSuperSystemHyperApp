-- =============================================================================
-- AIStart360 — Migration 016: Metrics Resolver Extensions
-- Extends public.metrics for the Point A real-time intelligence layer.
-- Adds confidence + provenance + computed_at columns, allows additional
-- source values used by the resolver, and enables Supabase Realtime on
-- metrics / diagnostics / documents tables.
-- =============================================================================

-- 1. Add resolver columns (idempotent)
ALTER TABLE public.metrics
  ADD COLUMN IF NOT EXISTS confidence  DECIMAL(3,2)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  ADD COLUMN IF NOT EXISTS provenance  JSONB,
  ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.metrics.confidence  IS '0..1 — confidence that the materialized value reflects reality. Inherited from the picked source.';
COMMENT ON COLUMN public.metrics.provenance  IS 'JSON: { picked: MetricSource, considered: SourceAttempt[], notes?: string }';
COMMENT ON COLUMN public.metrics.computed_at IS 'When the resolver materialized this value. Distinct from recorded_at.';

-- 2. Relax source CHECK to include resolver-emitted source types.
--    Postgres auto-names column-level CHECKs as <table>_<column>_check.
ALTER TABLE public.metrics DROP CONSTRAINT IF EXISTS metrics_source_check;

-- Also drop any constraint whose definition references "source IN" — covers
-- alternative auto-names from older migrations.
DO $$
DECLARE c_name TEXT;
BEGIN
  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.metrics'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source IN %'
  LOOP
    EXECUTE format('ALTER TABLE public.metrics DROP CONSTRAINT %I', c_name);
  END LOOP;
END $$;

ALTER TABLE public.metrics
  ADD CONSTRAINT metrics_source_check
  CHECK (source IN (
    'survey',
    'document',
    'manual',
    'calculated',
    'resolver',
    'external',
    'prisma'
  ));

-- 3. Helpful index for "latest materialized value" lookups
CREATE INDEX IF NOT EXISTS metrics_computed_at_idx
  ON public.metrics(company_id, metric_key, computed_at DESC);

-- 4. Enable Supabase Realtime on metrics / diagnostics / documents
--    Wrapped in DO blocks so re-running the migration is safe.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.metrics;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.diagnostics;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

-- 5. Allow REPLICA IDENTITY FULL so realtime payloads include row context
ALTER TABLE public.metrics     REPLICA IDENTITY FULL;
ALTER TABLE public.diagnostics REPLICA IDENTITY FULL;
ALTER TABLE public.documents   REPLICA IDENTITY FULL;
