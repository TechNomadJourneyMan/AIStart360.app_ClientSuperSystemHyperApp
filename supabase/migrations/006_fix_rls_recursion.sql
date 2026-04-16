-- Fix infinite RLS recursion on profiles table
-- ─────────────────────────────────────────────
-- The old profiles_admin_select / profiles_admin_update policies used
-- EXISTS (SELECT 1 FROM profiles WHERE ...) sub-queries, which re-trigger
-- RLS on profiles itself → PostgreSQL 42P17 "infinite recursion".
--
-- Fix: create a SECURITY DEFINER helper function that reads profiles
-- without RLS, then use it in all role-checking policies.

CREATE OR REPLACE FUNCTION public.current_user_role()
  RETURNS TEXT
  LANGUAGE SQL STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- ── profiles ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_admin_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;

CREATE POLICY "profiles_admin_select" ON public.profiles
  FOR SELECT USING (
    public.current_user_role() IN ('super_admin', 'admin', 'manager')
  );

CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE USING (
    public.current_user_role() IN ('super_admin', 'admin')
  );

-- ── expert_comments ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "expert_create_own" ON public.expert_comments;
DROP POLICY IF EXISTS "expert_read_all"   ON public.expert_comments;
DROP POLICY IF EXISTS "expert_update_own" ON public.expert_comments;
DROP POLICY IF EXISTS "expert_delete_own" ON public.expert_comments;

CREATE POLICY "expert_create_own" ON public.expert_comments
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND public.current_user_role() IN ('expert','admin','super_admin')
  );

CREATE POLICY "expert_read_all" ON public.expert_comments
  FOR SELECT USING (
    public.current_user_role() IN ('expert','admin','super_admin')
  );

CREATE POLICY "expert_update_own" ON public.expert_comments
  FOR UPDATE USING (author_id = auth.uid());

CREATE POLICY "expert_delete_own" ON public.expert_comments
  FOR DELETE USING (author_id = auth.uid());
