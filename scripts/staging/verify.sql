-- scripts/staging/verify.sql — сверка staging после загрузки (только счётчики, без значений).
SET search_path = public, extensions;
\pset footer off

\echo '=== таблицы по схемам ==='
SELECT schemaname, count(*) AS tables FROM pg_tables WHERE schemaname IN ('public', 'market', 'auth', 'storage') GROUP BY 1 ORDER BY 1;

\echo '=== ключевые таблицы: строки ==='
SELECT 'auth.users' t, count(*) FROM auth.users UNION ALL
SELECT 'auth.identities', count(*) FROM auth.identities UNION ALL
SELECT 'public.profiles', count(*) FROM public.profiles UNION ALL
SELECT 'public.companies', count(*) FROM public.companies UNION ALL
SELECT 'public.survey_answers', count(*) FROM public.survey_answers UNION ALL
SELECT 'public.survey_answer_history', count(*) FROM public.survey_answer_history UNION ALL
SELECT 'public.documents', count(*) FROM public.documents UNION ALL
SELECT 'public.metrics', count(*) FROM public.metrics UNION ALL
SELECT 'public.diagnostics', count(*) FROM public.diagnostics UNION ALL
SELECT 'public.gri_assessments', count(*) FROM public.gri_assessments UNION ALL
SELECT 'public.point_a_values', count(*) FROM public.point_a_values UNION ALL
SELECT 'public.patient_segments', count(*) FROM public.patient_segments UNION ALL
SELECT 'public.schema_migrations', count(*) FROM public.schema_migrations UNION ALL
SELECT 'market.companies', count(*) FROM market.companies UNION ALL
SELECT 'storage.buckets', count(*) FROM storage.buckets UNION ALL
SELECT 'storage.objects', count(*) FROM storage.objects;

\echo '=== RLS: таблицы public без RLS ==='
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity ORDER BY 1;
SELECT count(*) FILTER (WHERE c.relrowsecurity) AS rls_on, count(*) AS total
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

\echo '=== объекты ==='
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies_public,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'market') AS policies_market,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage') AS policies_storage,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')) AS functions_public,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'market') AND NOT t.tgisinternal) AS triggers_public_market,
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_created') AS trg_on_auth_user_created,
  (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime') AS realtime_tables;

\echo '=== права (сколько таблиц public доступно ролям) ==='
SELECT r AS role,
  count(*) FILTER (WHERE has_table_privilege(r, c.oid, 'SELECT')) AS can_select,
  count(*) FILTER (WHERE has_table_privilege(r, c.oid, 'INSERT')) AS can_insert
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
     unnest(ARRAY['anon', 'authenticated', 'service_role']) r
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
GROUP BY r ORDER BY r;
