-- 150_point_a_ai_review.down.sql — ROLLBACK of migration 150.
--
-- NOT part of the migration sequence (scripts/test-db/setup.mjs and go-live
-- checks read only supabase/migrations/*.sql, not sub-folders).
-- Drops the constraints of 150 and ONLY the columns migration 150 created
-- (their comment starts with «[150]»): a column that existed before 150 in an
-- environment (added by hand) is kept with its data.
-- Roll back migration 152 first (its functions read ai_reviewed_at / ai_generated_at).
-- Data lost with the dropped columns: the AI failure codes / model / times and
-- the expert's review and corrections of the AI analysis. ai_analysis and
-- ai_status are not touched. Roll the portal code back first (the code of
-- R3-PA reads and writes these columns; it tolerates their absence, writing
-- only ai_status then).
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/150_point_a_ai_review.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.diagnostics DROP CONSTRAINT IF EXISTS diagnostics_ai_review_complete;
ALTER TABLE public.diagnostics DROP CONSTRAINT IF EXISTS diagnostics_ai_expert_edits_object;
ALTER TABLE public.diagnostics DROP CONSTRAINT IF EXISTS diagnostics_ai_error_len;
ALTER TABLE public.diagnostics DROP CONSTRAINT IF EXISTS diagnostics_ai_reviewed_by_fkey;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT a.attname AS name
      FROM pg_attribute a
     WHERE a.attrelid = 'public.diagnostics'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname IN ('ai_error', 'ai_model', 'ai_generated_at', 'ai_started_at', 'ai_reviewed_at', 'ai_reviewed_by', 'ai_reviewed_by_name', 'ai_expert_edits')
       AND col_description(a.attrelid, a.attnum) LIKE '[150]%'
  LOOP
    EXECUTE format('ALTER TABLE public.diagnostics DROP COLUMN %I', c.name);
  END LOOP;
END $$;
