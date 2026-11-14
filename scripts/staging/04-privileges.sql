-- scripts/staging/04-privileges.sql — права anon/authenticated/service_role и др. как в проде.
--
-- Дамп сделан с --no-privileges, а объекты при загрузке создаёт роль postgres, поэтому
-- default privileges образа выдают anon/authenticated/service_role ВСЁ на всё. Здесь:
--   1) права на таблицы/представления/последовательности/функции public и market сбрасываются
--      к умолчанию PostgreSQL (владелец postgres; EXECUTE у PUBLIC для функций);
--   2) воспроизводятся ACL прода из acl-public-market.sql (снят с резервной копии Railway-прода
--      2026-11-05; набор таблиц и функций совпадает с дампом 12.11 — проверено).
-- Объекты расширений (vector, btree_gist, postgis…) не трогаются. Идемпотентно. Как supabase_admin.

\set ON_ERROR_STOP 1
RESET ROLE;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('%I.%I', n.nspname, c.relname) AS obj, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'market') AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM PUBLIC, anon, authenticated, service_role, aistart360_omnichannel_runtime, market_app',
                   CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.obj);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS f
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'market')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON ROUTINE %s FROM anon, authenticated, service_role, aistart360_omnichannel_runtime, market_app', r.f);
    EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO PUBLIC', r.f);
  END LOOP;
END $$;
REVOKE ALL ON SCHEMA market FROM PUBLIC, anon, authenticated, service_role;

\ir acl-public-market.sql
