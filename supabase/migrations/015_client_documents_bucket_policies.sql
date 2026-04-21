-- Storage RLS for `client-documents` bucket used by the onboarding docs step
-- (/client/onboarding/documents). User upload failed with "Bucket not found"
-- because the bucket itself was missing AND no RLS existed.
--
-- Bucket created separately via Storage API (not SQL — buckets are managed
-- by supabase_storage_admin). This migration only wires the per-user RLS:
-- each user can only read/write objects under their own folder (userId/...).

DROP POLICY IF EXISTS client_docs_insert_own ON storage.objects;
DROP POLICY IF EXISTS client_docs_select_own ON storage.objects;
DROP POLICY IF EXISTS client_docs_delete_own ON storage.objects;

CREATE POLICY client_docs_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY client_docs_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY client_docs_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
