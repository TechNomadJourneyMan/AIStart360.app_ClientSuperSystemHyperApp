-- 099_owner_super_admin.sql
--
-- Access after the removal of the shared-password «break-glass» entry and of
-- the legacy /admin, /users and owner screens (docs/platform/09-security.md
-- P2-4, docs/platform/07-admin-control-center.md). Idempotent; safe to re-run.
--
--   1. The platform owner's personal account (technomadjourneyman@gmail.com)
--      becomes super_admin: profiles.role = 'super_admin', status 'approved',
--      plus an explicit staff_roles row. Without it nobody could open the GIGA
--      panel once break-glass is gone. If the account does not exist yet, a
--      NOTICE says so and nothing changes — sign in once and re-run.
--   2. Other super_admin accounts (profiles.role or staff_roles) are LISTED in
--      a NOTICE and left untouched: demote them by hand in GIGA → «Сотрудники»
--      if they should not keep access.
--   3. Approved profiles with the legacy role 'admin' and no staff_roles row
--      opened only the removed /admin screens. The owner decided that only
--      the owner has panel access for now, so they get NOTHING: they are
--      LISTED in a NOTICE. Grant access one by one in GIGA → «Сотрудники».
--   4. 'owner' is a legacy role that now behaves like 'client' in the app.
--      Public sign-up can no longer ask for it: handle_new_user (083) is
--      redefined so user metadata always yields a pending client. Existing
--      owner profiles are counted in a NOTICE, not changed.
--   5. The retired break_glass_enabled platform setting row is removed.
--
-- Apply: node scripts/apply-migration.js supabase/migrations/099_owner_super_admin.sql

-- ─── 1–3: owner super_admin, report of other staff ─────────────────────────
DO $$
DECLARE
  v_owner_email CONSTANT TEXT := 'technomadjourneyman@gmail.com';
  v_owner   UUID;
  v_others  TEXT;
  v_admins  TEXT;
  v_owners  BIGINT;
BEGIN
  SELECT u.id INTO v_owner
  FROM auth.users u
  WHERE lower(u.email) = v_owner_email
  ORDER BY u.created_at NULLS LAST
  LIMIT 1;

  IF v_owner IS NULL THEN
    RAISE NOTICE '099: % not found in auth.users — super_admin NOT granted. Sign in with that account once, then re-run this migration.', v_owner_email;
  ELSE
    INSERT INTO public.profiles (id, email, full_name, role, status, approved_at)
    SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'full_name', u.email), 'super_admin', 'approved', now()
    FROM auth.users u
    WHERE u.id = v_owner
    ON CONFLICT (id) DO UPDATE
      SET role        = 'super_admin',
          status      = 'approved',
          approved_at = COALESCE(public.profiles.approved_at, now())
      WHERE public.profiles.role IS DISTINCT FROM 'super_admin'
         OR public.profiles.status IS DISTINCT FROM 'approved';

    INSERT INTO public.staff_roles (user_id, role, granted_by)
    VALUES (v_owner, 'super_admin', 'migration:099')
    ON CONFLICT (user_id) DO UPDATE
      SET role = 'super_admin', granted_by = 'migration:099', updated_at = now()
      WHERE public.staff_roles.role IS DISTINCT FROM 'super_admin';

    RAISE NOTICE '099: % is super_admin (profiles + staff_roles).', v_owner_email;
  END IF;

  SELECT string_agg(DISTINCT COALESCE(u.email, x.id::text), ', ')
  INTO v_others
  FROM (
    SELECT p.id FROM public.profiles p WHERE p.role = 'super_admin'
    UNION
    SELECT s.user_id FROM public.staff_roles s WHERE s.role = 'super_admin'
  ) x
  LEFT JOIN auth.users u ON u.id = x.id
  WHERE v_owner IS NULL OR x.id <> v_owner;

  IF v_others IS NULL THEN
    RAISE NOTICE '099: no other super_admin accounts.';
  ELSE
    RAISE NOTICE '099: OTHER super_admin accounts (left unchanged — review in GIGA → Сотрудники): %', v_others;
  END IF;

  SELECT string_agg(COALESCE(u.email, p.id::text), ', ')
  INTO v_admins
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'admin'
    AND p.status = 'approved'
    AND NOT EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = p.id);

  IF v_admins IS NOT NULL THEN
    RAISE NOTICE '099: legacy admin profiles WITHOUT panel access (not granted — add in GIGA → Сотрудники if needed): %', v_admins;
  END IF;

  SELECT count(*) INTO v_owners FROM public.profiles WHERE role = 'owner';
  RAISE NOTICE '099: % profile(s) with the legacy role owner — treated as clients by the app, not changed.', v_owners;
END;
$$;

-- ─── 4: sign-up never yields 'owner' ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trusted_role   TEXT := NEW.raw_app_meta_data->>'role';
  v_trusted_status TEXT := NEW.raw_app_meta_data->>'status';
  v_role           TEXT;
  v_status         TEXT;
BEGIN
  IF v_trusted_role IN ('super_admin', 'admin', 'manager', 'analyst', 'client', 'expert') THEN
    -- app_metadata is writable only with the service-role key.
    v_role   := v_trusted_role;
    v_status := CASE
      WHEN v_trusted_status IN ('pending_approval', 'approved', 'rejected') THEN v_trusted_status
      ELSE 'pending_approval'
    END;
  ELSE
    -- user_metadata is attacker-controlled on public signup: always a pending
    -- client (the legacy 'owner' self-registration was removed in 099).
    v_role   := 'client';
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

-- ─── 5: retired setting ─────────────────────────────────────────────────────
DELETE FROM public.system_settings WHERE key = 'break_glass_enabled';
