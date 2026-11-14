-- Staging: подготовка пустой базы self-hosted Supabase к загрузке копии прода.
-- Запускать как supabase_admin (суперпользователь образа supabase/postgres).
-- Идемпотентно. Ничего не читает из прода, данных не содержит.

\set ON_ERROR_STOP 1

-- 1. Предохранитель: только пустая база (auth.users = 0), иначе — стоп.
DO $$
DECLARE has_rows boolean;
BEGIN
  IF (SELECT count(*) FROM auth.users) > 0 THEN
    RAISE EXCEPTION 'staging: в auth.users уже есть строки — загрузка остановлена (сначала reset.sql)';
  END IF;
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.profiles)' INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'staging: public.profiles не пуст — загрузка остановлена';
    END IF;
  END IF;
END $$;

-- 1б. Метка staging: её проверяют anonymize.sql и reset.sql (ставится только на пустую базу).
COMMENT ON DATABASE postgres IS 'aistart360-staging';

-- 2. Роли, на которые ссылаются политики и гранты прода. В staging — без входа.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aistart360_omnichannel_runtime') THEN
    CREATE ROLE aistart360_omnichannel_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'market_app') THEN
    CREATE ROLE market_app NOLOGIN;
  END IF;
END $$;

-- 3. Схема market (владелец postgres, как в проде).
CREATE SCHEMA IF NOT EXISTS market AUTHORIZATION postgres;

-- 4. Расширения в тех же схемах, что в проде.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector     WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS citext     WITH SCHEMA market;
CREATE EXTENSION IF NOT EXISTS pg_trgm    WITH SCHEMA market;
CREATE EXTENSION IF NOT EXISTS unaccent   WITH SCHEMA market;
CREATE EXTENSION IF NOT EXISTS postgis    WITH SCHEMA market;
CREATE EXTENSION IF NOT EXISTS pgcrypto   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
