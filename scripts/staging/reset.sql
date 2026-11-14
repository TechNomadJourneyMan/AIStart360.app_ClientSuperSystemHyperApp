-- scripts/staging/reset.sql — очистить STAGING перед повторной заливкой (load.sh).
-- ТОЛЬКО staging: работает лишь на базе с меткой COMMENT ON DATABASE … 'aistart360-staging'
-- и только с явным подтверждением:
--   psql "<staging>" -v ON_ERROR_STOP=1 -v confirm=staging -1 -f scripts/staging/reset.sql
-- Удаляет: все объекты public (кроме объектов расширений), схему market, пользователей auth
-- (с identities/сессиями), бакеты и политики storage, триггер on_auth_user_created.
-- Роли, расширения в public/extensions, схемы auth/storage (их ведут GoTrue/Storage) остаются.

\set ON_ERROR_STOP 1
\if :{?confirm}
\else
  \echo 'reset.sql: нужен -v confirm=staging'
  \quit
\endif
SELECT :'confirm' = 'staging' AS ok \gset
\if :ok
\else
  \echo 'reset.sql: confirm должен быть staging'
  \quit
\endif

DO $$
BEGIN
  IF coalesce(shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database'), '')
     <> 'aistart360-staging' THEN
    RAISE EXCEPTION 'reset.sql: база не помечена как staging — стоп';
  END IF;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DELETE FROM auth.users;  -- identities, sessions, refresh_tokens, mfa_* — каскадом (FK GoTrue)
TRUNCATE auth.flow_state, auth.audit_log_entries, auth.one_time_tokens;

DROP POLICY IF EXISTS client_docs_delete_own ON storage.objects;
DROP POLICY IF EXISTS client_docs_insert_own ON storage.objects;
DROP POLICY IF EXISTS client_docs_select_own ON storage.objects;
DROP POLICY IF EXISTS documents_bucket_delete_own ON storage.objects;
DROP POLICY IF EXISTS documents_bucket_insert_own ON storage.objects;
DROP POLICY IF EXISTS documents_bucket_select_own ON storage.objects;
DROP POLICY IF EXISTS documents_bucket_update_own ON storage.objects;
DELETE FROM storage.objects WHERE bucket_id IN ('sales-imports', 'knowledge-documents', 'cms-media', 'client-documents', 'report-pdfs', 'documents');
DELETE FROM storage.buckets WHERE id IN ('sales-imports', 'knowledge-documents', 'cms-media', 'client-documents', 'report-pdfs', 'documents');

DROP SCHEMA IF EXISTS market CASCADE;

DO $$
DECLARE r record;
BEGIN
  -- таблицы/представления/последовательности public (кроме объектов расширений)
  FOR r IN
    SELECT format('%I.%I', n.nspname, c.relname) AS obj,
           CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE'
                          WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END AS kind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND NOT c.relispartition
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    ORDER BY c.relkind DESC
  LOOP
    EXECUTE format('DROP %s IF EXISTS %s CASCADE', r.kind, r.obj);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP ROUTINE IF EXISTS %s CASCADE', r.f);
  END LOOP;
  FOR r IN
    SELECT format('%I.%I', n.nspname, t.typname) AS ty FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'c') AND (t.typrelid = 0 OR (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS %s CASCADE', r.ty);
  END LOOP;
END $$;

\echo 'reset.sql: staging очищен — теперь scripts/staging/load.sh'
