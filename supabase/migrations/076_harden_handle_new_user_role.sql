-- ============================================================================
-- 076: Harden handle_new_user — close the signup privilege-escalation hole
--
-- PROBLEM (002_fix_user_trigger_status.sql:13-19). The trigger copied the role
-- straight out of raw_user_meta_data and auto-approved everyone who was not a
-- 'client':
--
--     v_role   := COALESCE(NEW.raw_user_meta_data->>'role', 'client');
--     ...
--     v_status := COALESCE(NEW.raw_user_meta_data->>'status', 'approved');
--
-- raw_user_meta_data is CLIENT-CONTROLLED and the Supabase anon key is public,
-- so a direct POST /auth/v1/signup with data:{"role":"super_admin"} minted an
-- APPROVED super_admin. That bypasses app/api/auth/register (whose zod schema
-- allows only client|owner) and satisfies the middleware giga gate, which lets
-- role='super_admin' + status='approved' into /admin-giga-panel
-- (middleware.ts: hasApprovedPersonalGigaAccess).
--
-- FIX, following the Supabase trust model — user_metadata is untrusted input,
-- app_metadata can only be written through the GoTrue admin API with the
-- service-role key and is NOT settable through /auth/v1/signup:
--   * self-service roles are whitelisted to client|owner — exactly the pair the
--     public registration form offers; anything else falls back to 'client';
--   * privileged roles (super_admin/admin/manager/analyst/expert) are honoured
--     ONLY from raw_app_meta_data, i.e. only from
--     admin.createUser({ app_metadata: { role: ... } });
--   * status is ALWAYS 'pending_approval' unless raw_app_meta_data says
--     otherwise — nobody can arrive pre-approved through public signup.
-- Even if the app_metadata boundary ever leaked, the role whitelist is the
-- primary defence and still holds on its own.
--
-- APPLICATION IMPACT (checked against the code on 2026-07-29):
--   * app/api/auth/register — createUser(user_metadata:{role:'client'|'owner',
--     status:'pending_approval'}), then approves through applyApprovalDecision()
--     (service-role UPDATE of profiles.status, lib/users/approval.ts). Both
--     roles are on the self-service whitelist and the route already passes
--     'pending_approval', so its behaviour is UNCHANGED.
--   * app/api/dev/register — dev-only backdoor (NODE_ENV != 'production' AND
--     ENABLE_DEV_AUTH_ROUTES=1). It may request any role; the trigger now
--     writes 'client', but the route immediately upserts public.profiles with
--     the requested role over the service role, so the FINAL ROLE IS UNCHANGED.
--     The one difference: the profile lands as 'pending_approval' instead of
--     'approved'. Middleware gates status only for role='client' and for the
--     personal super_admin giga entry, so this is visible solely for a dev
--     super_admin — approve it from the giga panel, or have that route pass
--     app_metadata:{role, status:'approved'} to admin.createUser.
--   * OAuth signups carry no 'role' in metadata → client/pending_approval, the
--     same as before.
--
-- Idempotent: CREATE OR REPLACE + guarded re-grant. Touches no existing row.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- Roles a user is allowed to pick for themselves at signup. Mirrors the zod
  -- enum in app/api/auth/register/route.ts — keep the two in sync.
  c_self_roles CONSTANT TEXT[] := ARRAY['client', 'owner'];
  -- Everything profiles_role_check accepts (001_onboarding_system.sql:27).
  c_all_roles CONSTANT TEXT[] := ARRAY[
    'super_admin', 'admin', 'manager', 'analyst', 'client', 'expert', 'owner'
  ];
  -- Everything profiles_status_check accepts (059_admin_actor_and_block_status).
  c_all_statuses CONSTANT TEXT[] := ARRAY[
    'pending_approval', 'approved', 'rejected', 'requires_clarification',
    'blocked', 'archived'
  ];

  v_trusted_role   TEXT;
  v_trusted_status TEXT;
  v_claimed_role   TEXT;
  v_role           TEXT;
  v_status         TEXT;
BEGIN
  -- TRUSTED channel: app_metadata is writable only through the GoTrue admin
  -- API (service-role key); /auth/v1/signup cannot set it.
  v_trusted_role   := NULLIF(NEW.raw_app_meta_data->>'role', '');
  v_trusted_status := NULLIF(NEW.raw_app_meta_data->>'status', '');

  -- UNTRUSTED channel: whatever the signup caller put into `data`.
  v_claimed_role   := NULLIF(NEW.raw_user_meta_data->>'role', '');

  IF v_trusted_role IS NOT NULL AND v_trusted_role = ANY (c_all_roles) THEN
    v_role := v_trusted_role;
  ELSIF v_claimed_role IS NOT NULL AND v_claimed_role = ANY (c_self_roles) THEN
    v_role := v_claimed_role;
  ELSE
    -- Absent, unknown or privileged claim → least privilege. Never raise here:
    -- this runs inside GoTrue's INSERT on auth.users, and an exception would
    -- turn a rejected role claim into a failed signup.
    v_role := 'client';
  END IF;

  -- Approval is an ADMIN decision, never a signup parameter. Only the
  -- service-role channel may pre-set a status; everyone else starts pending.
  IF v_trusted_status IS NOT NULL AND v_trusted_status = ANY (c_all_statuses) THEN
    v_status := v_trusted_status;
  ELSE
    v_status := 'pending_approval';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NEW.email),
    v_role,
    v_status
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates public.profiles on auth.users INSERT. Self-service roles are limited to client|owner (raw_user_meta_data); privileged roles and any non-pending status are honoured only from raw_app_meta_data (service-role only).';

-- 065_omnichannel_runtime_role.sql locked this SECURITY DEFINER function down to
-- the auth daemon. CREATE OR REPLACE keeps the existing ACL — re-assert it so
-- this file is self-contained and safe to run on a DB that never got 065.
DO $handle_new_user_grants$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
  END IF;
END
$handle_new_user_grants$;

-- Read-only sanity check: the function is useless without its trigger. We do
-- not (re)create it here — that needs ownership of auth.users; 001 owns it.
DO $handle_new_user_trigger_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_auth_user_created'
      AND tgrelid = 'auth.users'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE WARNING '[076] trigger on_auth_user_created is MISSING on auth.users — profiles rows are not created on signup; re-apply 001_onboarding_system.sql.';
  END IF;
END
$handle_new_user_trigger_check$;

-- ── Post-apply audit (run MANUALLY, this migration changes no existing row) ──
-- Accounts that could only have come from the old escalation path — a
-- privileged role that never went through the admin API. Review each one and
-- demote/block by hand; do NOT bulk-update blindly, real staff live here too.
--
--   SELECT p.id, p.email, p.role, p.status, p.created_at,
--          u.raw_user_meta_data->>'role' AS claimed_role,
--          u.raw_app_meta_data->>'role'  AS trusted_role
--   FROM public.profiles p
--   JOIN auth.users u ON u.id = p.id
--   WHERE p.role NOT IN ('client', 'owner')
--     AND COALESCE(u.raw_app_meta_data->>'role', '') = ''
--   ORDER BY p.created_at DESC;
