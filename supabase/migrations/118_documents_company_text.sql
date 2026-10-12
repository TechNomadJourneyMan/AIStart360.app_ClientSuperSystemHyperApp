-- 118_documents_company_text.sql
--
-- Two defects of public.documents found on production (2026-10-12):
--
-- 1. documents.company_id was UUID while companies.id is TEXT. The upload
--    pipeline (lib/documents/repository.ts, raw SQL with a text parameter)
--    failed every insert of a company document:
--      42804 column "company_id" is of type uuid but expression is of type text
--    → «Ошибка сервера (HTTP 500)» on /client/onboarding/documents. Companies
--    whose id is not a UUID could not have documents at all. The column
--    becomes TEXT (values kept, ::text), like every other company_id.
--
-- 2. A policy documents_all_anon (ALL, USING true, WITH CHECK true, role anon)
--    and full table grants to anon: anyone with the public anon key could
--    read, change and delete every document row (parsed financial data, file
--    paths). Not created by any migration in the repository. Removed; anon
--    gets no privileges on documents. The app reads documents with a user
--    session (authenticated) or the service role only.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/118_documents_company_text.sql

-- ─── 2. anon ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS documents_all_anon ON public.documents;
REVOKE ALL ON public.documents FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.documents FROM authenticated;

-- ─── 1. company_id → TEXT ───────────────────────────────────────────────────
-- The tenant policy depends on the column; re-created unchanged in meaning.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'company_id') = 'uuid' THEN
    DROP POLICY IF EXISTS documents_tenant_select ON public.documents;
    ALTER TABLE public.documents ALTER COLUMN company_id TYPE TEXT USING company_id::text;
  END IF;
END $$;

DROP POLICY IF EXISTS documents_tenant_select ON public.documents;
CREATE POLICY documents_tenant_select ON public.documents FOR SELECT
  USING (company_id IS NOT NULL AND public.can_read_company(company_id));

NOTIFY pgrst, 'reload schema';
