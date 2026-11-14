-- 143_staff_mfa_sessions.down.sql — ROLLBACK of migration 143.
--
-- NOT part of the migration sequence (scripts/test-db/setup.mjs and go-live
-- checks read only supabase/migrations/*.sql, not sub-folders).
-- Restores the three helper bodies exactly as 140 left them and drops the
-- session gate and its table. Re-opens SR-01 (staff RLS rights by password
-- alone through PostgREST) — use only if 143 locks staff out and a forward fix
-- is not possible in time. The app keeps writing staff_mfa_sessions until it
-- is rolled back too; after this file those writes fail (table gone) and the
-- step-up is refused (fail closed) — roll the app back first, or re-create the
-- table without the gate (sections 1 of 143) if only the gate must go.
--   node scripts/apply-migration.js supabase/migrations/rollback/143_staff_mfa_sessions.down.sql

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.role
    FROM public.staff_roles s
    JOIN public.profiles p ON p.id = s.user_id
   WHERE s.user_id = auth.uid()
     AND p.status = 'approved'
$$;
COMMENT ON FUNCTION public.current_staff_role() IS
  '140: staff_roles.role of auth.uid() while the profile is approved, else NULL. The only source of staff rights in RLS.';

CREATE OR REPLACE FUNCTION public.is_active_expert()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.role = 'expert' AND p.status = 'approved'
  )
$$;

CREATE OR REPLACE FUNCTION public.staff_sees_all_clients()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.staff_roles s
      JOIN public.profiles p ON p.id = s.user_id
     WHERE s.user_id = auth.uid()
       AND p.status = 'approved'
       AND (
            s.role IN ('super_admin', 'admin', 'crm_manager')
         OR (s.role IN ('super_expert', 'support') AND s.client_scope = 'all')
       )
  )
$$;

DROP FUNCTION IF EXISTS public.staff_session_ok();
DROP TABLE IF EXISTS public.staff_mfa_sessions;
