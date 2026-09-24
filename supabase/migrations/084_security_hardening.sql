-- =============================================================================
-- 084: Security hardening (пакет 0, аудит 2026-09-23 — F-001, F-002, F-006)
--
-- 1) F-001 handle_new_user: новый аккаунт ВСЕГДА client + pending_approval.
--    Раньше триггер (002) брал role/status из raw_user_meta_data, которые
--    присылает сам регистрирующийся: POST /auth/v1/signup с anon-ключом и
--    data:{role:'super_admin'} создавал одобренного super_admin. Теперь
--    метаданные используются только для full_name.
--
-- 1b) Роль 'owner' убрана из продукта (решение владельца 2026-09-24):
--    оставшиеся owner-профили становятся client, profiles_role_check
--    пересоздаётся без 'owner'.
--
-- 2) F-002 guard-триггер на profiles: role, status, tier, feature_flags может
--    менять только service_role (серверные маршруты с аудитом) или прямое
--    подключение к БД (postgres / миграции). Любая попытка из пользовательской
--    сессии (anon / authenticated через PostgREST) — исключение 42501.
--    Политика profiles_admin_update (006) удалена: она позволяла profiles.role
--    = 'admin' менять любые колонки любого профиля, включая role → super_admin.
--    Легитимных записей через неё в коде не осталось (все админские правки идут
--    service-role маршрутами).
--
-- 3) F-006 RLS + REVOKE на Prisma-таблицах и таблицах из 033
--    (mini_gri_leads, shared_reports, subscriptions, payment_transactions).
--    Prisma ходит под владельцем (postgres) и RLS не видит; приложение читает
--    эти таблицы только service-role клиентом. anon/authenticated доступ
--    закрыт полностью. Таблица `companies` НЕ трогается: Prisma-модель
--    Company смотрит в ту же физическую таблицу, что и Supabase-овская
--    companies из 001, у которой рабочие RLS-политики для клиентов.
--
-- Идемпотентна: CREATE OR REPLACE / DROP ... IF EXISTS / to_regclass-проверки.
-- =============================================================================

-- ─── 1. handle_new_user ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- role/status из метаданных НЕ читаются: их задаёт сам регистрирующийся.
  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NEW.email),
    'client',
    'pending_approval'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Привилегии как в 065: вызывает только GoTrue.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
  END IF;
END $$;

-- ─── 1b. Роль owner удалена ──────────────────────────────────────────────────
-- До guard-триггера (миграция и так идёт от владельца БД, без JWT).

UPDATE public.profiles SET role = 'client' WHERE role = 'owner';

DO $$
DECLARE
  c RECORD;
BEGIN
  -- Имя inline-CHECK из 001 — profiles_role_check, но на всякий случай
  -- снимаем любой CHECK на profiles, который ограничивает только role.
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'manager', 'analyst', 'client', 'expert'));

-- ─── 2. Guard привилегированных колонок profiles ─────────────────────────────

CREATE OR REPLACE FUNCTION public.profiles_protect_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_claims_raw TEXT;
  v_claim_role TEXT;
BEGIN
  -- to_jsonb: tier / feature_flags появились в 048 — так триггер не падает,
  -- даже если колонок нет.
  IF NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND (to_jsonb(NEW) -> 'tier') IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'tier')
     AND (to_jsonb(NEW) -> 'feature_flags') IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'feature_flags')
  THEN
    RETURN NEW;
  END IF;

  v_claims_raw := NULLIF(current_setting('request.jwt.claims', true), '');
  v_claim_role := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    CASE WHEN v_claims_raw IS NULL THEN NULL ELSE v_claims_raw::jsonb ->> 'role' END
  );

  -- Серверные маршруты (service-role ключ).
  IF v_claim_role = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Прямое подключение к БД (psql, миграции, SECURITY DEFINER-функции без
  -- пользовательского JWT). Роли PostgREST сюда не попадают.
  IF v_claim_role IS NULL
     AND auth.uid() IS NULL
     AND current_user NOT IN ('anon', 'authenticated', 'authenticator')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'profiles: role, status, tier и feature_flags меняются только сервером'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.profiles_protect_privileged_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_protect_privileged_columns ON public.profiles;
CREATE TRIGGER profiles_protect_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_privileged_columns();

-- Admin через PostgREST больше не правит чужие профили (S2).
DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;

-- ─── 3. RLS + REVOKE: Prisma-таблицы и 033 ───────────────────────────────────

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    -- prisma/schema.prisma (@@map), кроме companies — см. шапку
    'organizations', 'financial_snapshots', 'users', 'accounts', 'sessions',
    'verification_tokens', 'clients', 'reports', 'projects', 'notifications',
    'activity_logs', 'pulse_metrics', 'gri_reports', 'report_documents',
    'admin_requests', 'comments', 'crm_integrations', 'audit_logs',
    'diagnostic_runs', 'document_summaries', 'document_chunks',
    -- 033_app_share_payments_leads.sql (они же в Prisma)
    'mini_gri_leads', 'shared_reports', 'subscriptions', 'payment_transactions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
