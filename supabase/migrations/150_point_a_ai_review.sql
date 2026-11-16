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
--                        http_502; stale …) — NULL after a complete analysis
--   ai_model             the model(s) that answered the last generation
--   ai_generated_at      time of the last generation attempt (complete,
--                        partial or failed)
--   ai_started_at        when the CURRENT attempt was started (ai_status
--                        'processing'): an attempt older than 15 min is stale —
--                        failed with ai_error 'stale', «Повторить» is offered
--                        (lib/point-a/ai-claim.ts); also the retry cooldown
--
--   The expert's review of the AI text (the task and its SLA: migration 152):
--   ai_reviewed_at       «Проверено экспертом» — when
--   ai_reviewed_by       who (profiles.id; SET NULL when the profile is deleted)
--   ai_reviewed_by_name  the name shown to the client («Проверено экспертом: …»)
--   ai_expert_edits      the expert's corrections laid OVER the AI text
--                        (lib/point-a/ai-review.ts AiExpertEdits: executive_summary,
--                        industry_context, strategic_priorities, growth_roadmap,
--                        blocks.<key>.<field>, note) — the AI text itself stays
--                        in ai_analysis untouched
--
-- Idempotent and safe on an environment where some of these columns already
-- exist (added by hand, with data of any length / shape — ревью R3-PA M2):
--   • an existing column is left as it is (type, data); only the columns
--     created HERE get the comment marker «[150]», and only those are dropped
--     by the rollback (rollback/150_point_a_ai_review.down.sql);
--   • every constraint first looks for rows that would break it (only a column
--     that existed before 150 can have any — ours are all NULL):
--       – none → added and VALIDATEd (cannot fail);
--       – a CHECK with violating old rows → NOT added, a NOTICE says so: a
--         CHECK is evaluated on every UPDATE of a row, so even NOT VALID it would
--         make the next recalculation fail when it retires such a row
--         (is_current = false). Clean the data, re-run 150;
--       – the foreign key with orphan old rows → added NOT VALID (a key is
--         checked only when it changes — other updates of those rows work) and
--         left unvalidated, with a NOTICE;
--   • a constraint is added only over columns of a type it can read (text /
--     varchar, jsonb, timestamptz, uuid for the key); otherwise a NOTICE.
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
      ('ai_started_at',       'TIMESTAMPTZ', 'R3-PA: when the current AI analysis attempt started (processing older than 15 min = stale)'),
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
END $$;

DO $$
DECLARE
  -- name → the columns it reads, the type each must have, its kind and condition.
  k record;
  ok boolean;
  col text;
  bad boolean;
BEGIN
  FOR k IN
    SELECT * FROM (VALUES
      ('diagnostics_ai_reviewed_by_fkey', ARRAY['ai_reviewed_by'], ARRAY['uuid'], 'fk',
       'ai_reviewed_by IS NULL OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = ai_reviewed_by)'),
      ('diagnostics_ai_error_len', ARRAY['ai_error'], ARRAY['text|character varying'], 'check',
       'ai_error IS NULL OR length(ai_error) <= 500'),
      ('diagnostics_ai_expert_edits_object', ARRAY['ai_expert_edits'], ARRAY['jsonb'], 'check',
       'ai_expert_edits IS NULL OR jsonb_typeof(ai_expert_edits) = ''object'''),
      ('diagnostics_ai_review_complete', ARRAY['ai_reviewed_at', 'ai_reviewed_by_name'], ARRAY['timestamp with time zone', 'text|character varying'], 'check',
       'ai_reviewed_at IS NULL OR ai_reviewed_by_name IS NOT NULL')
    ) AS t(name, cols, types, kind, cond)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = k.name AND conrelid = 'public.diagnostics'::regclass) THEN
      CONTINUE;
    END IF;
    -- every column it reads exists with a type it can read
    ok := true;
    FOR i IN 1 .. array_length(k.cols, 1) LOOP
      col := k.cols[i];
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'diagnostics' AND column_name = col
           AND data_type = ANY (string_to_array(k.types[i], '|'))
      ) THEN
        ok := false;
      END IF;
    END LOOP;
    IF NOT ok THEN
      RAISE NOTICE '150: % not added — a column it reads has another type', k.name;
      CONTINUE;
    END IF;
    -- Rows that would break it: only in columns that existed before 150 (ours are all NULL).
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.diagnostics WHERE NOT (%s))', k.cond) INTO bad;
    IF k.kind = 'fk' THEN
      -- A foreign key is checked only when the key itself changes: NOT VALID is safe
      -- with old orphans (other updates of those rows still work).
      ALTER TABLE public.diagnostics
        ADD CONSTRAINT diagnostics_ai_reviewed_by_fkey FOREIGN KEY (ai_reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
      IF bad THEN
        RAISE NOTICE '150: % stays NOT VALID — old rows point to missing profiles', k.name;
      ELSE
        ALTER TABLE public.diagnostics VALIDATE CONSTRAINT diagnostics_ai_reviewed_by_fkey;
      END IF;
    ELSIF bad THEN
      -- A CHECK is evaluated on EVERY update of a row: a NOT VALID check over old
      -- violating rows would make retiring them (is_current = false on the next
      -- recalculation) fail. Not added; the data first.
      RAISE NOTICE '150: % not added — old rows violate it (clean them, then re-run 150)', k.name;
    ELSE
      EXECUTE format('ALTER TABLE public.diagnostics ADD CONSTRAINT %I CHECK (%s) NOT VALID', k.name, k.cond);
      EXECUTE format('ALTER TABLE public.diagnostics VALIDATE CONSTRAINT %I', k.name);
    END IF;
  END LOOP;
END $$;
