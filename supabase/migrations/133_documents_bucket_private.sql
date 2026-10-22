-- 133_documents_bucket_private.sql
--
-- SECURITY: the Storage bucket `documents` was PUBLIC (storage.buckets.public
-- = true): anyone holding `…/storage/v1/object/public/documents/<path>` could
-- download client files (questionnaire step 6 sales scripts, medical patient
-- bases, financial reports, contracts) without signing in. Worse, the storage
-- policies on it (documents_read / documents_upload / documents_delete) were
-- granted to `anon` with only `bucket_id = 'documents'`: an anonymous caller
-- with the public anon key could LIST, UPLOAD and DELETE any object in it.
--
-- After this migration:
--   * the bucket is private — public URLs return 400/404;
--   * an authenticated user reads / writes / deletes ONLY objects in their own
--     folder `<auth.uid()>/…` (the same rule as `client-documents`, 015);
--   * anon has no access at all;
--   * staff and the server read through the service role only — the portal
--     route GET /api/v1/files/documents checks access (owner / GIGA staff with
--     users.view + users.sensitive inside their client scope / expert for
--     client accounts / reader of the owner's company) and redirects to a
--     signed URL that lives 10 minutes.
--
-- NOTE: legacy ROOT-LEVEL objects (no `<uid>/` folder, e.g.
-- `1775818815053_Contract …docx`) match no owner policy: after this migration
-- they are readable ONLY via the service role (Supabase dashboard / server).
-- The portal route does not serve them.
--
-- Apply order: deploy the code first (questionnaire uploads go to the private
-- `client-documents` bucket and every link goes through the route, which works
-- whether the bucket is public or private), then apply this migration. Applied
-- first, the still-deployed old code would keep writing public URLs that no
-- longer open.
--
-- Idempotent: safe to re-run. If the SQL role may not update storage.buckets
-- in an environment, make the bucket private via the dashboard / Storage API
-- (updateBucket('documents', { public: false })) and re-run — the policy part
-- and the check below still apply.

BEGIN;

UPDATE storage.buckets SET public = false WHERE id = 'documents' AND public IS DISTINCT FROM false;

-- The old wide-open policies (anon + authenticated, any path).
DROP POLICY IF EXISTS documents_read   ON storage.objects;
DROP POLICY IF EXISTS documents_upload ON storage.objects;
DROP POLICY IF EXISTS documents_delete ON storage.objects;
DROP POLICY IF EXISTS documents_update ON storage.objects;

-- Owner-only policies (re-created on every run).
DROP POLICY IF EXISTS documents_bucket_select_own ON storage.objects;
DROP POLICY IF EXISTS documents_bucket_insert_own ON storage.objects;
DROP POLICY IF EXISTS documents_bucket_update_own ON storage.objects;
DROP POLICY IF EXISTS documents_bucket_delete_own ON storage.objects;

CREATE POLICY documents_bucket_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

CREATE POLICY documents_bucket_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

CREATE POLICY documents_bucket_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

CREATE POLICY documents_bucket_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- Fail the migration (and roll back) if the bucket is still public or any
-- policy on the bucket is still granted to anon / public.
DO $$
DECLARE
  still_public boolean;
  open_policies int;
BEGIN
  SELECT public INTO still_public FROM storage.buckets WHERE id = 'documents';
  IF still_public THEN
    RAISE EXCEPTION '133: bucket "documents" is still public';
  END IF;

  SELECT count(*) INTO open_policies
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%''documents''%'
    AND (roles && ARRAY['anon', 'public']::name[]);
  IF open_policies > 0 THEN
    RAISE EXCEPTION '133: % storage policies on bucket "documents" still allow anon/public', open_policies;
  END IF;
END $$;

COMMIT;
