-- 150_point_a_ai_review.sql
--
-- R3-PA (Раунд 3, Точка А). The AI analysis of Point A (diagnostics.ai_analysis,
-- POST /api/v1/diagnostics/ai-analyze) becomes diagnosable and ready for the
-- expert's review (решение PO: гибрид — клиент сразу видит разбор как
-- «Черновик ИИ — эксперт проверит», эксперт потом проверяет и правит).
--
-- Columns of public.diagnostics (all nullable, no default, no backfill):
--
--   Diagnosis of the generation (written by ai-analyze and the fan-out):
--   ai_error             why the last generation failed, codes «part:kind»
--                        separated by «; » (summary:schema; blocksB:cut;
--                        http_502 …) — NULL after a complete analysis
--   ai_model             the model(s) that answered the last generation
--   ai_generated_at      time of the last generation attempt (complete,
--                        partial or failed)
--
--   The expert's review of the AI text (no SLA here — the expert task and its
--   SLA are a separate change on lib/expert-sla):
--   ai_reviewed_at       «Проверено экспертом» — when
--   ai_reviewed_by       who (profiles.id; SET NULL when the profile is deleted)
--   ai_reviewed_by_name  the name shown to the client («Проверено экспертом: …»)
--   ai_expert_edits      the expert's corrections laid OVER the AI text
--                        (lib/point-a/ai-review.ts AiExpertEdits: executive_summary,
--                        industry_context, strategic_priorities, growth_roadmap,
--                        blocks.<key>.<field>, note) — the AI text itself stays
--                        in ai_analysis untouched
--
-- Idempotent. A column that already exists (an environment where it was added
-- by hand) is left as it is: only the columns created HERE get the comment
-- marker «[150]», and only those are dropped by the rollback
-- (rollback/150_point_a_ai_review.down.sql). The checks are added only on
-- columns of the expected type.
-- RLS: nothing new — diagnostics has no UPDATE policy for API roles (writes
-- go through the service role after the route's own check); the existing
-- SELECT policies (own / tenant / admin + the «paid section» restriction of
-- 147) cover the new columns.
--
-- Apply (one transaction):
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/150_point_a_ai_review.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('ai_error',            'TEXT',        'R3-PA: why the last AI analysis failed («part:kind; …»), NULL after a complete one'),
      ('ai_model',            'TEXT',        'R3-PA: model(s) that answered the last AI analysis'),
      ('ai_generated_at',     'TIMESTAMPTZ', 'R3-PA: time of the last AI analysis attempt (complete, partial or failed)'),
      ('ai_reviewed_at',      'TIMESTAMPTZ', 'R3-PA: the AI analysis was checked by an expert — when'),
      ('ai_reviewed_by',      'UUID',        'R3-PA: the AI analysis was checked by an expert — who (profiles.id)'),
      ('ai_reviewed_by_name', 'TEXT',        'R3-PA: the expert''s name shown to the client («Проверено экспертом»)'),
      ('ai_expert_edits',     'JSONB',       'R3-PA: the expert''s corrections over the AI text (lib/point-a/ai-review.ts)')
    ) AS t(name, type, note)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'diagnostics' AND column_name = c.name
    ) THEN
      EXECUTE format('ALTER TABLE public.diagnostics ADD COLUMN %I %s', c.name, c.type);
      EXECUTE format('COMMENT ON COLUMN public.diagnostics.%I IS %L', c.name, '[150] ' || c.note);
    END IF;
  END LOOP;

  -- Who reviewed: a deleted profile keeps the review (and its name), loses the link.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diagnostics_ai_reviewed_by_fkey' AND conrelid = 'public.diagnostics'::regclass)
     AND (SELECT data_type FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'diagnostics' AND column_name = 'ai_reviewed_by') = 'uuid' THEN
    ALTER TABLE public.diagnostics
      ADD CONSTRAINT diagnostics_ai_reviewed_by_fkey FOREIGN KEY (ai_reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  -- The error is a short code list, never a provider body (it may echo client data).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diagnostics_ai_error_len' AND conrelid = 'public.diagnostics'::regclass)
     AND (SELECT data_type FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'diagnostics' AND column_name = 'ai_error') = 'text' THEN
    ALTER TABLE public.diagnostics ADD CONSTRAINT diagnostics_ai_error_len CHECK (ai_error IS NULL OR length(ai_error) <= 500) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diagnostics_ai_expert_edits_object' AND conrelid = 'public.diagnostics'::regclass)
     AND (SELECT data_type FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'diagnostics' AND column_name = 'ai_expert_edits') = 'jsonb' THEN
    ALTER TABLE public.diagnostics ADD CONSTRAINT diagnostics_ai_expert_edits_object CHECK (ai_expert_edits IS NULL OR jsonb_typeof(ai_expert_edits) = 'object') NOT VALID;
  END IF;

  -- «Проверено экспертом» needs both the time and the name shown to the client.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diagnostics_ai_review_complete' AND conrelid = 'public.diagnostics'::regclass)
     AND (SELECT data_type FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'diagnostics' AND column_name = 'ai_reviewed_at') = 'timestamp with time zone' THEN
    ALTER TABLE public.diagnostics ADD CONSTRAINT diagnostics_ai_review_complete
      CHECK (ai_reviewed_at IS NULL OR ai_reviewed_by_name IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- The new rows were all NULL when the checks were added: validating is a scan
-- that cannot fail; done here so the constraints are trusted by the planner.
DO $$
DECLARE
  n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['diagnostics_ai_error_len', 'diagnostics_ai_expert_edits_object', 'diagnostics_ai_review_complete'] LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = n AND conrelid = 'public.diagnostics'::regclass AND NOT convalidated) THEN
      EXECUTE format('ALTER TABLE public.diagnostics VALIDATE CONSTRAINT %I', n);
    END IF;
  END LOOP;
END $$;
