-- Restore "own" RLS policies for authenticated clients.
-- Root cause: migration 007 dropped/recreated admin policies but the original
-- `documents_select_own` from migration 001 was lost in the process, leaving
-- authenticated clients with no SELECT policy → they see zero of their own docs.
--
-- Prod has mixed user_id column types across tables:
--   documents.user_id   = text
--   companies.user_id   = uuid
--   survey_answers.user_id = uuid
-- We cast both sides to text in every comparison for safety.

-- ── documents ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "documents_select_own" ON public.documents;
DROP POLICY IF EXISTS "documents_insert_own" ON public.documents;
DROP POLICY IF EXISTS "documents_update_own" ON public.documents;
DROP POLICY IF EXISTS "documents_delete_own" ON public.documents;

CREATE POLICY "documents_select_own" ON public.documents
  FOR SELECT TO authenticated
  USING (user_id::text = auth.uid()::text);

CREATE POLICY "documents_insert_own" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "documents_update_own" ON public.documents
  FOR UPDATE TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "documents_delete_own" ON public.documents
  FOR DELETE TO authenticated
  USING (user_id::text = auth.uid()::text);

-- ── companies ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "companies_select_own" ON public.companies;
DROP POLICY IF EXISTS "companies_insert_own" ON public.companies;
DROP POLICY IF EXISTS "companies_update_own" ON public.companies;

CREATE POLICY "companies_select_own" ON public.companies
  FOR SELECT TO authenticated
  USING (user_id::text = auth.uid()::text);

CREATE POLICY "companies_insert_own" ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "companies_update_own" ON public.companies
  FOR UPDATE TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ── survey_answers ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "survey_select_own" ON public.survey_answers;
DROP POLICY IF EXISTS "survey_insert_own" ON public.survey_answers;
DROP POLICY IF EXISTS "survey_update_own" ON public.survey_answers;

CREATE POLICY "survey_select_own" ON public.survey_answers
  FOR SELECT TO authenticated
  USING (user_id::text = auth.uid()::text);

CREATE POLICY "survey_insert_own" ON public.survey_answers
  FOR INSERT TO authenticated
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "survey_update_own" ON public.survey_answers
  FOR UPDATE TO authenticated
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);
