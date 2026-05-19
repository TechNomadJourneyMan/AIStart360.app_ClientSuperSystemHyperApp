-- =============================================================================
-- AIStart360 — Migration 017: Reconcile public.documents with parsing pipeline
-- The original 001_onboarding_system.sql declared parsed_data / parse_error /
-- n8n_execution_id columns, but the prod schema drifted and these never
-- materialised. They are required by:
--   • app/api/v1/onboarding/documents/[id]/process/route.ts
--   • lib/functions/parse-document.ts (Inngest)
--   • lib/metrics/source-adapters.ts (resolver document-source adapter)
-- Migration 017 is additive and idempotent — safe to re-run.
-- =============================================================================

-- 1. parsed_data — the JSONB blob written by the AI extractor.
--    Shape: { summary, fields: ParsedDataField[], raw_text_preview,
--              extracted_at, model_used }  (see lib/documents/extract.ts)
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS parsed_data JSONB;

COMMENT ON COLUMN public.documents.parsed_data
  IS 'Structured extraction payload from lib/documents/extract.ts — {summary, fields[], raw_text_preview, extracted_at, model_used}.';

-- 2. parse_error — captured when parse_status = ''error''.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS parse_error TEXT;

-- 3. n8n_execution_id — legacy field for Inngest / n8n correlation.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS n8n_execution_id TEXT;

-- 4. Reconcile parse_status CHECK with values actually used in prod.
--    Prod has historic rows with parse_status = ''completed'' (treated as a
--    success terminal alongside ''parsed''). Migration 017 widens the
--    allowed set instead of rewriting data.
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_parse_status_check;

DO $$
DECLARE c_name TEXT;
BEGIN
  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.documents'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%parse_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.documents DROP CONSTRAINT %I', c_name);
  END LOOP;
END $$;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_parse_status_check
  CHECK (parse_status IN ('queued','processing','parsed','completed','error'));

-- 5. Index for "pending parses" admin views.
CREATE INDEX IF NOT EXISTS documents_parse_status_idx
  ON public.documents(parse_status)
  WHERE parse_status IN ('queued','processing','error');

-- 6. Field-level metric_id index — supports "find all docs that contributed
--    to a given metric id" admin queries. Uses a GIN expression on the
--    parsed_data.fields[*].metric_id paths.
CREATE INDEX IF NOT EXISTS documents_parsed_data_metric_ids_idx
  ON public.documents USING GIN ((parsed_data -> 'fields'));
