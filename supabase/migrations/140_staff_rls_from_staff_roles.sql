-- 140_staff_rls_from_staff_roles.sql
--
-- R-002 (P0) + R-004 (P1): staff rights in RLS come from staff_roles only, and
-- client data of a company is visible to staff / experts within their client
-- scope. Tests: tests/integration/db/staff-rls-scope.test.ts.
--
-- Before: current_user_role() / is_platform_staff() / is_platform_admin() and
-- ~30 policies read the legacy profiles.role. An approved profile with the
-- legacy role admin / super_admin / manager / analyst and NO staff_roles row
-- (099 decided such accounts get no panel access) still read every client
-- through PostgREST, and manager / analyst could write other users'
-- survey_answers. can_read_company() opened every company to support,
-- crm_manager, super_expert and to every approved expert.
--
-- After:
--   * current_staff_role()  — staff_roles.role of the caller, only while the
--     profile is 'approved' (pending_approval, requires_clarification,
--     rejected, blocked, archived → NULL; same rule as lib/admin/giga-actor.ts).
--   * is_platform_admin()   — staff_roles super_admin / admin.
--   * is_active_expert()    — approved profile with role 'expert' (experts are
--     not a staff_roles role; they keep their expert path, scoped below).
--   * is_platform_staff()   — staff_roles with users.sensitive (super_admin,
--     admin, super_expert, crm_manager, support — the 096 set) OR an active
--     expert. Legacy profile roles admin/super_admin/manager/analyst no longer
--     count. Keep in sync with ROLE_PERMISSIONS in lib/admin/rbac.ts.
--   * staff_sees_all_clients() — sensitive staff whose effective scope is
--     'all': super_admin / admin / crm_manager always (ALWAYS_ALL_SCOPE in
--     rbac.ts), super_expert / support when staff_roles.client_scope = 'all'.
--   * staff_assigned_user_ids() — clients whose user_assignments.assignee_id is
--     the caller, for sensitive staff and active experts.
--   * expert_assigned_user_ids() — the same, for active experts only (the
--     legacy policies that listed 'expert').
--   * staff_can_read_company(company) — staff_sees_all_clients() or the owner
--     of the company is assigned to the caller. can_read_company() and
--     accessible_company_ids() use it instead of is_platform_staff().
--   * Every policy that listed profiles.role values is rewritten:
--       legacy {super_admin, admin[, manager, analyst]} → is_platform_admin()
--       legacy '... expert'                             → + assigned clients of
--                                                          an active expert
--     manager / analyst map to nothing (their writes were the bug; analysts
--     have no users.sensitive since 096). Staff admins (staff_roles
--     super_admin / admin) keep / get these staff paths — the panel already
--     shows them everything (RBAC), the profile role no longer matters.
--   * Global is_platform_staff() checks on company data are AND-ed with the
--     scope: report_version_reviews, integration_connections / _facts.
--   * profiles_guard_privileged_columns trusts is_platform_admin() instead of
--     current_user_role().
--   * current_user_role() stays (cabinet routing role, unused by policies);
--     its comment says it is not an authorization source.
--
-- Not changed: data (profiles, staff_roles, user_assignments); triggers that
-- bypass for is_platform_staff() (their RLS gate is now scoped); partner_*
-- policies (is_platform_staff(), now without legacy roles).
--
-- Idempotent: CREATE OR REPLACE FUNCTION; DROP POLICY IF EXISTS + CREATE
-- POLICY; each table is skipped when it does not exist. One implicit
-- transaction (apply-migration.js sends one multi-statement query).
-- Rollback: supabase/migrations/rollback/140_staff_rls_from_staff_roles.down.sql
-- Apply (PO rule: on push to main, after the checks in the A2 report):
--   node scripts/apply-migration.js supabase/migrations/140_staff_rls_from_staff_roles.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ─── 1. Helpers ─────────────────────────────────────────────────────────────

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

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.current_staff_role() IN ('super_admin', 'admin'), FALSE)
$$;

-- Keep the role list in sync with ROLE_PERMISSIONS[...].has('users.sensitive') in lib/admin/rbac.ts.
CREATE OR REPLACE FUNCTION public.is_platform_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.current_staff_role() IN ('super_admin', 'admin', 'super_expert', 'crm_manager', 'support'), FALSE)
      OR public.is_active_expert()
$$;

-- Effective scope 'all' (effectiveClientScope in lib/admin/rbac.ts).
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

CREATE OR REPLACE FUNCTION public.staff_assigned_user_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ua.user_id
    FROM public.user_assignments ua
   WHERE ua.assignee_id = auth.uid()
     AND public.is_platform_staff()
$$;

CREATE OR REPLACE FUNCTION public.expert_assigned_user_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ua.user_id
    FROM public.user_assignments ua
   WHERE ua.assignee_id = auth.uid()
     AND public.is_active_expert()
$$;

CREATE OR REPLACE FUNCTION public.staff_can_read_company(p_company_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_company_id IS NOT NULL AND auth.uid() IS NOT NULL AND (
       public.staff_sees_all_clients()
    OR EXISTS (
         SELECT 1 FROM public.companies c
          WHERE c.id = p_company_id
            AND c.user_id IN (SELECT public.staff_assigned_user_ids())
       )
  )
$$;

-- Owner of a diagnostic (point_b_* rows hang off diagnostics), without the
-- diagnostics RLS of the caller.
CREATE OR REPLACE FUNCTION public.diagnostic_owner(p_diagnostic_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.user_id FROM public.diagnostics d WHERE d.id = p_diagnostic_id
$$;

CREATE OR REPLACE FUNCTION public.can_read_company(p_company_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_company_id IS NOT NULL AND auth.uid() IS NOT NULL AND (
       public.company_member_role(p_company_id) IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id AND c.user_id = auth.uid())
    OR public.partner_role_for_company(p_company_id) IS NOT NULL
    OR public.staff_can_read_company(p_company_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.accessible_company_ids()
RETURNS SETOF TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.companies c
  WHERE public.staff_sees_all_clients()
  UNION
  SELECT c.id FROM public.companies c
  WHERE c.user_id IN (SELECT public.staff_assigned_user_ids())
  UNION
  SELECT m.company_id FROM public.company_members m
  WHERE m.user_id = auth.uid() AND m.status = 'active'
  UNION
  SELECT c.id FROM public.companies c WHERE c.user_id = auth.uid()
  UNION
  SELECT c.id FROM public.companies c
  JOIN public.partner_members pm ON pm.partner_id = c.partner_id AND pm.status = 'active'
  JOIN public.partner_organizations po ON po.id = c.partner_id AND po.status = 'active'
  WHERE pm.user_id = auth.uid()
$$;

COMMENT ON FUNCTION public.current_user_role() IS
  '140: legacy cabinet-routing role from profiles.role. NOT an authorization source — RLS uses current_staff_role() / is_platform_admin() / is_platform_staff().';

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.current_staff_role()', 'public.is_active_expert()', 'public.is_platform_admin()',
    'public.is_platform_staff()', 'public.staff_sees_all_clients()', 'public.staff_assigned_user_ids()',
    'public.expert_assigned_user_ids()', 'public.staff_can_read_company(text)', 'public.diagnostic_owner(uuid)',
    'public.can_read_company(text)', 'public.accessible_company_ids()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', f);
  END LOOP;
END $$;

-- ─── 2. profiles guard: admins from staff_roles ─────────────────────────────
CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- The service role, migrations (postgres) and platform admins are trusted.
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.is_platform_admin() THEN
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

  -- A user may unlink Telegram (set any of these to NULL), but only the bot
  -- webhook / link flow (service role) binds.
  IF (NEW.telegram_chat_id               IS NOT NULL AND NEW.telegram_chat_id               IS DISTINCT FROM OLD.telegram_chat_id)
  OR (NEW.telegram_user_id               IS NOT NULL AND NEW.telegram_user_id               IS DISTINCT FROM OLD.telegram_user_id)
  OR (NEW.telegram_username              IS NOT NULL AND NEW.telegram_username              IS DISTINCT FROM OLD.telegram_username)
  OR (NEW.telegram_linked_at             IS NOT NULL AND NEW.telegram_linked_at             IS DISTINCT FROM OLD.telegram_linked_at)
  OR (NEW.telegram_link_token_hash       IS NOT NULL AND NEW.telegram_link_token_hash       IS DISTINCT FROM OLD.telegram_link_token_hash)
  OR (NEW.telegram_link_token_expires_at IS NOT NULL AND NEW.telegram_link_token_expires_at IS DISTINCT FROM OLD.telegram_link_token_expires_at)
  OR (NEW.telegram_link_code             IS NOT NULL AND NEW.telegram_link_code             IS DISTINCT FROM OLD.telegram_link_code) THEN
    RAISE EXCEPTION 'profiles: telegram binding is set by the bot only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- ─── 3. Policies that read profiles.role ────────────────────────────────────
-- Arguments of each policy: table, name, command, roles, USING, WITH CHECK.
-- The argument-free helpers are wrapped in (SELECT …) so they run once per
-- statement (initplan), not per row.
DO $$
DECLARE
  -- legacy {super_admin, admin, manager, analyst} / {super_admin, admin, manager}
  adm_user    CONSTANT TEXT := '(SELECT public.is_platform_admin())';
  -- legacy lists that included 'expert', keyed by a client user id column
  adm_exp_uid CONSTANT TEXT := '((SELECT public.is_platform_admin()) OR user_id IN (SELECT public.expert_assigned_user_ids()))';
  adm_exp_cid CONSTANT TEXT := '((SELECT public.is_platform_admin()) OR client_id IN (SELECT public.expert_assigned_user_ids()))';
  adm_exp_dia CONSTANT TEXT := '((SELECT public.is_platform_admin()) OR public.diagnostic_owner(diagnostic_id) IN (SELECT public.expert_assigned_user_ids()))';
  p RECORD;
BEGIN
  FOR p IN
    SELECT * FROM (VALUES
      ('action_items',            'action_items_staff_all',         'ALL',    'authenticated', adm_exp_uid, adm_exp_uid),
      ('assistant_events',        'assistant_events_select_admin',  'SELECT', 'public',        adm_exp_uid, NULL),
      ('assistant_runs',          'assistant_runs_select_admin',    'SELECT', 'public',        adm_exp_uid, NULL),
      ('companies',               'companies_admin_select',         'SELECT', 'public',        adm_user,    NULL),
      ('crm_clients',             'crm_clients_sel_staff',          'SELECT', 'public',        adm_user,    NULL),
      ('crm_interactions',        'crm_interactions_sel_staff',     'SELECT', 'public',        adm_user,    NULL),
      ('crm_reminders',           'crm_reminders_sel_staff',        'SELECT', 'public',        adm_user,    NULL),
      ('diagnostics',             'diagnostics_admin_select',       'SELECT', 'public',        adm_user,    NULL),
      ('documents',               'documents_admin_select',         'SELECT', 'public',        adm_user,    NULL),
      ('expert_cases',            'expert_cases_select_admin',      'SELECT', 'public',        adm_exp_uid, NULL),
      ('expert_cases',            'expert_cases_update_admin',      'UPDATE', 'public',        adm_exp_uid, adm_exp_uid),
      ('expert_comments',         'expert_read_all',                'SELECT', 'public',        adm_exp_cid, NULL),
      ('expert_comments',         'expert_create_own',              'INSERT', 'public',        NULL,
                                  '(author_id = (SELECT auth.uid()) AND ' || adm_exp_cid || ')'),
      ('gri_assessments',         'gri_assessments_select_admin',   'SELECT', 'public',        adm_user,    NULL),
      ('gri_assessments',         'gri_assessments_update_admin',   'UPDATE', 'public',        adm_user,    NULL),
      ('gri_calc_sessions',       'gri_calc_sessions_select_admin', 'SELECT', 'public',        adm_user,    NULL),
      ('gri_pulse_responses',     'gri_pulse_select_admin',         'SELECT', 'public',        adm_user,    NULL),
      ('growth_bundles',          'growth_bundles_staff_read',      'SELECT', 'public',        adm_exp_cid, NULL),
      ('market_analysis_answers', 'market_answers_select_admin',    'SELECT', 'public',        adm_user,    NULL),
      ('market_snapshots',        'market_snapshots_select_admin',  'SELECT', 'public',        adm_user,    NULL),
      ('metrics',                 'metrics_admin_select',           'SELECT', 'public',        adm_user,    NULL),
      ('patient_segments',        'patient_segments_staff_read',    'SELECT', 'public',        adm_exp_cid, NULL),
      ('point_a_insights',        'point_a_insights_select_admin',  'SELECT', 'public',        adm_exp_uid, NULL),
      ('point_a_insights',        'point_a_insights_insert_admin',  'INSERT', 'public',        NULL,        adm_exp_uid),
      ('point_a_insights',        'point_a_insights_update_admin',  'UPDATE', 'public',        adm_exp_uid, NULL),
      ('point_b_analysis',        'point_b_staff_read',             'SELECT', 'authenticated', adm_exp_dia, NULL),
      ('point_b_versions',        'point_b_versions_staff_all',     'ALL',    'authenticated', adm_exp_dia, adm_exp_dia),
      -- Plain call, not the (SELECT …) initplan: profiles_update_own's WITH CHECK
      -- sub-selects profiles, and a sub-link in a profiles SELECT policy then
      -- makes the planner report «infinite recursion detected in policy».
      ('profiles',                'profiles_admin_select',          'SELECT', 'public',        'public.is_platform_admin()', NULL),
      ('revenue_losses',          'revenue_losses_staff_read',      'SELECT', 'public',        adm_exp_cid, NULL),
      ('survey_answers',          'survey_admin_select',            'SELECT', 'public',        adm_user,    NULL),
      ('survey_answers',          'survey_admin_insert',            'INSERT', 'public',        NULL,        adm_user),
      ('survey_answers',          'survey_admin_update',            'UPDATE', 'public',        adm_user,    NULL),
      -- Global staff reads of company data: within the scope only.
      ('report_version_reviews',  'report_version_reviews_select',  'SELECT', 'public',
                                  '(public.is_platform_staff() AND public.can_read_company(company_id))', NULL),
      ('integration_connections', 'integration_connections_staff_read', 'SELECT', 'authenticated',
                                  '(public.is_platform_staff() IS TRUE AND public.can_read_company(company_id) IS TRUE)', NULL),
      ('integration_facts',       'integration_facts_staff_read',   'SELECT', 'authenticated',
                                  '(public.is_platform_staff() IS TRUE AND public.can_read_company(company_id) IS TRUE)', NULL)
    ) AS t(tbl, pol, cmd, rol, using_expr, check_expr)
  LOOP
    IF to_regclass('public.' || p.tbl) IS NULL THEN
      RAISE NOTICE '140: table % missing — policy % skipped', p.tbl, p.pol;
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.pol, p.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO %s%s%s',
      p.pol, p.tbl, p.cmd, p.rol,
      CASE WHEN p.using_expr IS NULL THEN '' ELSE ' USING (' || p.using_expr || ')' END,
      CASE WHEN p.check_expr IS NULL THEN '' ELSE ' WITH CHECK (' || p.check_expr || ')' END);
  END LOOP;
END $$;
