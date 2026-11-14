-- scripts/staging/03-post.sql — то, что живёт вне схем public/market:
-- бакеты storage (только строки бакетов, файлов в staging нет), политики storage.objects,
-- триггер on_auth_user_created. Определения — из резервной копии прода (12.11.2026).
-- Запуск как supabase_admin. Идемпотентно.

\set ON_ERROR_STOP 1
RESET ROLE;

-- Бакеты. Колонки versioning_status/lifecycle_* есть только в более новой версии Storage — не задаём.
INSERT INTO storage.buckets (id, name, owner, created_at, updated_at, public, avif_autodetection, file_size_limit, allowed_mime_types, owner_id, type) VALUES
 ('sales-imports', 'sales-imports', NULL, '2026-09-10 11:47:18.818577+00', '2026-09-10 11:47:18.818577+00', false, false, 52428800, NULL, NULL, 'STANDARD'),
 ('knowledge-documents', 'knowledge-documents', NULL, '2026-09-10 11:47:18.818577+00', '2026-09-10 11:47:18.818577+00', false, false, 52428800, NULL, NULL, 'STANDARD'),
 ('cms-media', 'cms-media', NULL, '2026-09-17 11:55:24.70334+00', '2026-09-17 11:55:24.70334+00', true, false, 26214400, '{image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,application/pdf}', NULL, 'STANDARD'),
 ('client-documents', 'client-documents', NULL, '2026-04-21 11:49:42.767421+00', '2026-04-21 11:49:42.767421+00', false, false, 52428800, NULL, NULL, 'STANDARD'),
 ('report-pdfs', 'report-pdfs', NULL, '2026-10-08 11:04:01.671472+00', '2026-10-08 11:04:01.671472+00', false, false, 20971520, '{application/pdf}', NULL, 'STANDARD'),
 ('documents', 'documents', NULL, '2026-04-10 10:53:19.012356+00', '2026-04-10 10:53:19.012356+00', false, false, 20971520, '{application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword}', NULL, 'STANDARD')
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Политики storage.objects (7 шт., как в проде).
DROP POLICY IF EXISTS client_docs_delete_own ON storage.objects;
DROP POLICY IF EXISTS client_docs_insert_own ON storage.objects;
DROP POLICY IF EXISTS client_docs_select_own ON storage.objects;
DROP POLICY IF EXISTS documents_bucket_delete_own ON storage.objects;
DROP POLICY IF EXISTS documents_bucket_insert_own ON storage.objects;
DROP POLICY IF EXISTS documents_bucket_select_own ON storage.objects;
DROP POLICY IF EXISTS documents_bucket_update_own ON storage.objects;
CREATE POLICY client_docs_delete_own ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'client-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY client_docs_insert_own ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'client-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY client_docs_select_own ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'client-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY documents_bucket_delete_own ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY documents_bucket_insert_own ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY documents_bucket_select_own ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
CREATE POLICY documents_bucket_update_own ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text))) WITH CHECK (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

-- Новый пользователь auth → строка в public.profiles (функция public.handle_new_user из дампа).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
