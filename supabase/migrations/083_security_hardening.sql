-- 083_security_hardening.sql
--
-- Closes the database-level findings of the 2026-10-06 platform audit
-- (docs/platform/09-security.md). Idempotent; safe to re-run.
--
--   S1 (P0)  handle_new_user trusted `role`/`status` from raw_user_meta_data,
--            which the caller of GoTrue /signup controls: any non-client role
--            was auto-approved, so a self-registered `super_admin` became a
--            working GIGA staff account. Now: user metadata may only ask for
--            client|owner and always starts pending_approval. Elevated roles
--            come only from raw_app_meta_data (settable by the service role)
--            or from a later service-role upsert, as every server path does.
--   S2 (P1)  profiles_update_own pinned only role/status. Clients could PATCH
--            their own tier, feature_flags and approval stamps. A trigger now
--            rejects those changes unless the caller is the service role or
--            platform admin. Telegram binding may only be cleared by the user.
--   S3 (P1)  Prisma-owned tables in `public` had no RLS: with Supabase's
--            default grants they were readable through PostgREST with the
--            public anon key (users.passwordHash, NextAuth tokens, CRM tokens,
--            share tokens, leads). RLS ON with no policies + REVOKE: Prisma
--            (table owner) and the service role keep full access.
--   S4 (P1)  v_pending_users / v_client_diagnostics ran with owner rights and
--            bypassed RLS. Unused by code → switched to security_invoker and
--            revoked from anon/authenticated.
--   L1       schema_migrations ledger; scripts/apply-migration.js records here.
--
-- Apply: node scripts/apply-migration.js supabase/migrations/083_security_hardening.sql

-- ─── L1: migration ledger ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  file        TEXT PRIMARY KEY,
  checksum    TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schema_migrations FROM anon, authenticated;

-- ─── S1: signup trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trusted_role   TEXT := NEW.raw_app_meta_data->>'role';
  v_trusted_status TEXT := NEW.raw_app_meta_data->>'status';
  v_claimed_role   TEXT := NEW.raw_user_meta_data->>'role';
  v_role           TEXT;
  v_status         TEXT;
BEGIN
  IF v_trusted_role IN ('super_admin', 'admin', 'manager', 'analyst', 'client', 'expert', 'owner') THEN
    -- app_metadata is writable only with the service-role key.
    v_role   := v_trusted_role;
    v_status := CASE
      WHEN v_trusted_status IN ('pending_approval', 'approved', 'rejected') THEN v_trusted_status
      ELSE 'pending_approval'
    END;
  ELSE
    -- user_metadata is attacker-controlled on public signup: never elevate.
    v_role   := CASE WHEN v_claimed_role = 'owner' THEN 'owner' ELSE 'client' END;
    v_status := 'pending_approval';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    v_role,
    v_status
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

-- ─── S2: protected profile columns ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- The service role, migrations (postgres) and platform admins are trusted.
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.current_user_role() IN ('super_admin', 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.role          IS DISTINCT FROM OLD.role
  OR NEW.status        IS DISTINCT FROM OLD.status
  OR NEW.tier          IS DISTINCT FROM OLD.tier
  OR NEW.feature_flags IS DISTINCT FROM OLD.feature_flags
  OR NEW.approved_at   IS DISTINCT FROM OLD.approved_at
  OR NEW.approved_by   IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'profiles: column is not self-editable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A user may unlink Telegram, but only the bot webhook (service role) binds.
  IF NEW.telegram_chat_id IS NOT NULL
     AND NEW.telegram_chat_id IS DISTINCT FROM OLD.telegram_chat_id THEN
    RAISE EXCEPTION 'profiles: telegram binding is set by the bot only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_privileged_columns ON public.profiles;
CREATE TRIGGER profiles_guard_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_privileged_columns();

-- ─── S3: Prisma-owned tables are server-only ────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations', 'financial_snapshots', 'users', 'accounts', 'sessions',
    'verification_tokens', 'clients', 'reports', 'projects', 'notifications',
    'activity_logs', 'pulse_metrics', 'gri_reports', 'report_documents',
    'admin_requests', 'comments', 'crm_integrations', 'audit_logs',
    'diagnostic_runs', 'document_summaries', 'document_chunks',
    'mini_gri_leads', 'shared_reports', 'subscriptions', 'payment_transactions'
  ] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

-- ─── S4: views that bypassed RLS ────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.v_pending_users') IS NOT NULL THEN
    ALTER VIEW public.v_pending_users SET (security_invoker = true);
    REVOKE ALL ON public.v_pending_users FROM anon, authenticated;
  END IF;
  IF to_regclass('public.v_client_diagnostics') IS NOT NULL THEN
    ALTER VIEW public.v_client_diagnostics SET (security_invoker = true);
    REVOKE ALL ON public.v_client_diagnostics FROM anon, authenticated;
  END IF;
END $$;

-- Trigger functions without a pinned search_path (R15).
ALTER FUNCTION public.set_updated_at() SET search_path = public;

NOTIFY pgrst, 'reload schema';
