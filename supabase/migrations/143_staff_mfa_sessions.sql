-- 143_staff_mfa_sessions.sql
--
-- SR-01 (P1): staff / expert rights in RLS require a live GoTrue session that
-- passed the portal's second factor. Tests:
-- tests/integration/db/staff-mfa-sessions.test.ts.
--
-- Before: the portal's 2FA lived only in an app cookie (aistart360_mfa,
-- lib/mfa/step-up.ts). GoTrue tokens are always aal1, so a staff member's
-- stolen password was enough: POST /auth/v1/token?grant_type=password with the
-- public anon key → JWT → PostgREST with every staff right of 140. And a JWT
-- of a revoked session (sign-out, «завершить все сессии», SR-04 clean-up)
-- kept those rights until its `exp` (up to an hour).
--
-- After:
--   * public.staff_mfa_sessions(session_id, user_id, verified_at, expires_at,
--     method): one row per GoTrue session that passed the step-up. Written by
--     the server only (service role) at the moment the step-up cookie is
--     issued (lib/mfa/step-up-session.ts), with the cookie's lifetime; RLS on,
--     no policies, no grants to anon / authenticated.
--   * public.staff_session_ok() — the caller's session (JWT `session_id`):
--       (a) exists in auth.sessions for auth.uid() and is not past not_after
--           (GoTrue deletes the row on sign-out / revoke), AND
--       (b) when system_settings.staff_require_mfa is on OR the caller has a
--           second factor (user_security.totp_enabled, a passkey, or the
--           app_metadata flags), a non-expired staff_mfa_sessions row of this
--           session and user exists.
--   * current_staff_role(), is_active_expert(), staff_sees_all_clients() — the
--     three helpers that read staff_roles / profiles.role — answer NULL /
--     FALSE unless staff_session_ok(). Everything else of 140
--     (is_platform_admin, is_platform_staff, staff_assigned_user_ids,
--     expert_assigned_user_ids, staff_can_read_company, can_read_company's
--     staff branch, accessible_company_ids' staff branches, every rewritten
--     policy) is built on them and follows.
--     staff_session_ok() is evaluated only for a person who HAS a staff /
--     expert row (CASE over the joined row), so clients pay nothing.
--
-- Not changed: client / owner / company-member / partner policies (clients
-- lose nothing); the service role (BYPASSRLS, auth.uid() NULL — the helpers
-- were already NULL for it); data.
--
-- Requires the GoTrue table auth.sessions (id, user_id, not_after) readable by
-- the migration role — checked first, the migration aborts otherwise.
-- Idempotent (CREATE … IF NOT EXISTS, CREATE OR REPLACE). One implicit
-- transaction (apply-migration.js sends one multi-statement query).
-- Rollback: supabase/migrations/rollback/143_staff_mfa_sessions.down.sql
-- Apply AFTER 140 (it replaces 140's helper bodies):
--   node scripts/apply-migration.js supabase/migrations/143_staff_mfa_sessions.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ─── 0. Preconditions ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION '143: auth.sessions does not exist — GoTrue too old or not Supabase';
  END IF;
  IF NOT has_table_privilege(current_user, 'auth.sessions', 'SELECT') THEN
    RAISE EXCEPTION '143: role % cannot SELECT auth.sessions — staff_session_ok() would fail for every staff member', current_user;
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'sessions'
         AND column_name IN ('id', 'user_id', 'not_after')) <> 3 THEN
    RAISE EXCEPTION '143: auth.sessions lacks id / user_id / not_after';
  END IF;
  IF to_regprocedure('public.current_staff_role()') IS NULL THEN
    RAISE EXCEPTION '143: apply 140_staff_rls_from_staff_roles.sql first';
  END IF;
END $$;

-- ─── 1. Step-up records ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_mfa_sessions (
  session_id  UUID        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  method      TEXT,
  CONSTRAINT staff_mfa_sessions_expiry CHECK (expires_at > verified_at)
);
CREATE INDEX IF NOT EXISTS staff_mfa_sessions_user_idx ON public.staff_mfa_sessions (user_id);
COMMENT ON TABLE public.staff_mfa_sessions IS
  '143 (SR-01): GoTrue sessions (JWT session_id) that passed the portal second factor. Server (service role) only; read by staff_session_ok().';

ALTER TABLE public.staff_mfa_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_mfa_sessions FROM PUBLIC;
REVOKE ALL ON public.staff_mfa_sessions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_mfa_sessions TO service_role;

-- ─── 2. The session gate ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_session_ok()
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_raw  TEXT := auth.jwt() ->> 'session_id';
  v_sid  UUID;
  v_set  JSONB;
  v_need BOOLEAN;
BEGIN
  IF v_uid IS NULL OR v_raw IS NULL
     OR v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN FALSE;
  END IF;
  v_sid := v_raw::uuid;

  -- (a) the session is alive: GoTrue deletes the row on sign-out / revoke.
  IF NOT EXISTS (
    SELECT 1 FROM auth.sessions s
     WHERE s.id = v_sid AND s.user_id = v_uid
       AND (s.not_after IS NULL OR s.not_after > now())
  ) THEN
    RETURN FALSE;
  END IF;

  -- (b) a second factor is required for this person: the platform setting
  -- (true or {"enabled": true}, as lib/settings/registry.ts coerces it) or
  -- any factor of their own.
  SELECT st.value INTO v_set FROM public.system_settings st WHERE st.key = 'staff_require_mfa';
  v_need := coalesce(v_set = 'true'::jsonb OR (jsonb_typeof(v_set) = 'object' AND v_set -> 'enabled' = 'true'::jsonb), FALSE)
    OR EXISTS (SELECT 1 FROM public.user_security us WHERE us.user_id = v_uid AND us.totp_enabled)
    OR EXISTS (SELECT 1 FROM public.webauthn_credentials w WHERE w.user_id = v_uid)
    OR EXISTS (
      SELECT 1 FROM auth.users u
       WHERE u.id = v_uid
         AND (   u.raw_app_meta_data ->> 'mfa_totp' = 'true'
              OR u.raw_app_meta_data ->> 'mfa_webauthn' = 'true')
    );
  IF NOT v_need THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.staff_mfa_sessions m
     WHERE m.session_id = v_sid AND m.user_id = v_uid AND m.expires_at > now()
  );
END;
$$;
COMMENT ON FUNCTION public.staff_session_ok() IS
  '143 (SR-01): the caller''s GoTrue session is alive and, when a second factor applies to them (staff_require_mfa or an own factor), passed the portal step-up (staff_mfa_sessions). Gate of every staff / expert RLS helper.';

-- ─── 3. Staff helpers of 140, gated ─────────────────────────────────────────
-- CASE over the joined row: the gate runs only when a staff / expert row
-- exists (a variable-free qual would become a one-time filter evaluated for
-- every client too).

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.staff_session_ok() THEN s.role END
    FROM public.staff_roles s
    JOIN public.profiles p ON p.id = s.user_id
   WHERE s.user_id = auth.uid()
     AND p.status = 'approved'
$$;
COMMENT ON FUNCTION public.current_staff_role() IS
  '140/143: staff_roles.role of auth.uid() while the profile is approved AND staff_session_ok(), else NULL. The only source of staff rights in RLS.';

CREATE OR REPLACE FUNCTION public.is_active_expert()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT public.staff_session_ok()
      FROM public.profiles p
     WHERE p.id = auth.uid() AND p.role = 'expert' AND p.status = 'approved'
  ), FALSE)
$$;

CREATE OR REPLACE FUNCTION public.staff_sees_all_clients()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT public.staff_session_ok()
      FROM public.staff_roles s
      JOIN public.profiles p ON p.id = s.user_id
     WHERE s.user_id = auth.uid()
       AND p.status = 'approved'
       AND (
            s.role IN ('super_admin', 'admin', 'crm_manager')
         OR (s.role IN ('super_expert', 'support') AND s.client_scope = 'all')
       )
  ), FALSE)
$$;

-- CREATE OR REPLACE keeps the grants of 140; the new function gets the same.
REVOKE EXECUTE ON FUNCTION public.staff_session_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_session_ok() TO anon, authenticated, service_role;
