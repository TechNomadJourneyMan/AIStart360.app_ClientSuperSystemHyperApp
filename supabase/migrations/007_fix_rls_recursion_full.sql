-- Full RLS recursion audit: replace every EXISTS-on-profiles pattern with
-- public.current_user_role() from migration 006. Previous migration only
-- fixed profiles + expert_comments; this one does the remaining 7 policies.
--
-- Affected tables: companies, survey_answers, documents, metrics, diagnostics.
-- Each currently has an "<table>_admin_select" policy that re-queries profiles
-- → same 42P17 infinite-recursion risk.

-- ── companies ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "companies_admin_select" ON public.companies;

CREATE POLICY "companies_admin_select" ON public.companies
  FOR SELECT USING (
    public.current_user_role() IN ('super_admin', 'admin', 'manager', 'analyst')
  );

-- ── survey_answers ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "survey_admin_select" ON public.survey_answers;
DROP POLICY IF EXISTS "survey_admin_insert" ON public.survey_answers;
DROP POLICY IF EXISTS "survey_admin_update" ON public.survey_answers;

CREATE POLICY "survey_admin_select" ON public.survey_answers
  FOR SELECT USING (
    public.current_user_role() IN ('super_admin', 'admin', 'manager', 'analyst')
  );

CREATE POLICY "survey_admin_insert" ON public.survey_answers
  FOR INSERT WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin', 'manager', 'analyst')
  );

CREATE POLICY "survey_admin_update" ON public.survey_answers
  FOR UPDATE USING (
    public.current_user_role() IN ('super_admin', 'admin', 'manager', 'analyst')
  );

-- ── documents ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "documents_admin_select" ON public.documents;

CREATE POLICY "documents_admin_select" ON public.documents
  FOR SELECT USING (
    public.current_user_role() IN ('super_admin', 'admin', 'manager', 'analyst')
  );

-- ── metrics (guarded: table may not exist on all envs) ─────────────────────
DO $$
BEGIN
  IF to_regclass('public.metrics') IS NOT NULL THEN
    DROP POLICY IF EXISTS "metrics_admin_select" ON public.metrics;
    CREATE POLICY "metrics_admin_select" ON public.metrics
      FOR SELECT USING (
        public.current_user_role() IN ('super_admin', 'admin', 'manager', 'analyst')
      );
  END IF;
END $$;

-- ── diagnostics ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "diagnostics_admin_select" ON public.diagnostics;

CREATE POLICY "diagnostics_admin_select" ON public.diagnostics
  FOR SELECT USING (
    public.current_user_role() IN ('super_admin', 'admin', 'manager', 'analyst')
  );
