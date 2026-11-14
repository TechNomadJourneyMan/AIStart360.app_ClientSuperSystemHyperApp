-- 140_staff_rls_from_staff_roles.down.sql — ROLLBACK of migration 140.
--
-- NOT part of the migration sequence (scripts/test-db/setup.mjs and
-- go-live checks read only supabase/migrations/*.sql, not sub-folders).
-- Restores the function bodies and policies exactly as they were after 139
-- (generated from a database built with migrations 001–139). Re-opens R-002 /
-- R-004 — use only if 140 breaks a legitimate screen and a forward fix is not
-- possible in time.
--   node scripts/apply-migration.js supabase/migrations/rollback/140_staff_rls_from_staff_roles.down.sql
-- (apply-migration.js records the file in schema_migrations under this name.)

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.is_platform_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'approved'
      AND (
        p.role IN ('super_admin', 'admin', 'manager', 'analyst', 'expert')
        OR EXISTS (
          SELECT 1 FROM public.staff_roles s
          WHERE s.user_id = p.id
            AND s.role IN ('super_admin', 'admin', 'super_expert', 'crm_manager', 'support')
        )
      )
  )
$function$

;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'approved'
      AND (
        p.role IN ('super_admin', 'admin')
        OR EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = p.id AND s.role IN ('super_admin', 'admin'))
      )
  )
$function$

;

CREATE OR REPLACE FUNCTION public.can_read_company(p_company_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_company_id IS NOT NULL AND auth.uid() IS NOT NULL AND (
       public.company_member_role(p_company_id) IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id AND c.user_id = auth.uid())
    OR public.partner_role_for_company(p_company_id) IS NOT NULL
    OR public.is_platform_staff()
  )
$function$

;

CREATE OR REPLACE FUNCTION public.accessible_company_ids()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id FROM public.companies c
  WHERE public.is_platform_staff()
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
$function$

;

CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;

COMMENT ON FUNCTION public.current_user_role() IS NULL;

DROP POLICY IF EXISTS action_items_staff_all ON public.action_items;
CREATE POLICY action_items_staff_all ON public.action_items AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['expert'::text, 'admin'::text, 'super_admin'::text]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['expert'::text, 'admin'::text, 'super_admin'::text]))))));

DROP POLICY IF EXISTS assistant_events_select_admin ON public.assistant_events;
CREATE POLICY assistant_events_select_admin ON public.assistant_events AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text, 'expert'::text]))))));

DROP POLICY IF EXISTS assistant_runs_select_admin ON public.assistant_runs;
CREATE POLICY assistant_runs_select_admin ON public.assistant_runs AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text, 'expert'::text]))))));

DROP POLICY IF EXISTS companies_admin_select ON public.companies;
CREATE POLICY companies_admin_select ON public.companies AS PERMISSIVE FOR SELECT TO public
  USING ((current_user_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text])));

DROP POLICY IF EXISTS crm_clients_sel_staff ON public.crm_clients;
CREATE POLICY crm_clients_sel_staff ON public.crm_clients AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text]))))));

DROP POLICY IF EXISTS crm_interactions_sel_staff ON public.crm_interactions;
CREATE POLICY crm_interactions_sel_staff ON public.crm_interactions AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text]))))));

DROP POLICY IF EXISTS crm_reminders_sel_staff ON public.crm_reminders;
CREATE POLICY crm_reminders_sel_staff ON public.crm_reminders AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text]))))));

DROP POLICY IF EXISTS diagnostics_admin_select ON public.diagnostics;
CREATE POLICY diagnostics_admin_select ON public.diagnostics AS PERMISSIVE FOR SELECT TO public
  USING ((current_user_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text])));

DROP POLICY IF EXISTS documents_admin_select ON public.documents;
CREATE POLICY documents_admin_select ON public.documents AS PERMISSIVE FOR SELECT TO public
  USING ((current_user_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text])));

DROP POLICY IF EXISTS expert_cases_select_admin ON public.expert_cases;
CREATE POLICY expert_cases_select_admin ON public.expert_cases AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text, 'expert'::text]))))));

DROP POLICY IF EXISTS expert_cases_update_admin ON public.expert_cases;
CREATE POLICY expert_cases_update_admin ON public.expert_cases AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text, 'expert'::text]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text, 'expert'::text]))))));

DROP POLICY IF EXISTS expert_create_own ON public.expert_comments;
CREATE POLICY expert_create_own ON public.expert_comments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) AND (current_user_role() = ANY (ARRAY['expert'::text, 'admin'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS expert_read_all ON public.expert_comments;
CREATE POLICY expert_read_all ON public.expert_comments AS PERMISSIVE FOR SELECT TO public
  USING ((current_user_role() = ANY (ARRAY['expert'::text, 'admin'::text, 'super_admin'::text])));

DROP POLICY IF EXISTS gri_assessments_select_admin ON public.gri_assessments;
CREATE POLICY gri_assessments_select_admin ON public.gri_assessments AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text]))))));

DROP POLICY IF EXISTS gri_assessments_update_admin ON public.gri_assessments;
CREATE POLICY gri_assessments_update_admin ON public.gri_assessments AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text]))))));

DROP POLICY IF EXISTS gri_calc_sessions_select_admin ON public.gri_calc_sessions;
CREATE POLICY gri_calc_sessions_select_admin ON public.gri_calc_sessions AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text]))))));

DROP POLICY IF EXISTS gri_pulse_select_admin ON public.gri_pulse_responses;
CREATE POLICY gri_pulse_select_admin ON public.gri_pulse_responses AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text]))))));

DROP POLICY IF EXISTS growth_bundles_staff_read ON public.growth_bundles;
CREATE POLICY growth_bundles_staff_read ON public.growth_bundles AS PERMISSIVE FOR SELECT TO public
  USING ((current_user_role() = ANY (ARRAY['expert'::text, 'admin'::text, 'super_admin'::text])));

DROP POLICY IF EXISTS integration_connections_staff_read ON public.integration_connections;
CREATE POLICY integration_connections_staff_read ON public.integration_connections AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() IS TRUE));

DROP POLICY IF EXISTS integration_facts_staff_read ON public.integration_facts;
CREATE POLICY integration_facts_staff_read ON public.integration_facts AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() IS TRUE));

DROP POLICY IF EXISTS market_answers_select_admin ON public.market_analysis_answers;
CREATE POLICY market_answers_select_admin ON public.market_analysis_answers AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text]))))));

DROP POLICY IF EXISTS market_snapshots_select_admin ON public.market_snapshots;
CREATE POLICY market_snapshots_select_admin ON public.market_snapshots AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text]))))));

DROP POLICY IF EXISTS metrics_admin_select ON public.metrics;
CREATE POLICY metrics_admin_select ON public.metrics AS PERMISSIVE FOR SELECT TO public
  USING ((current_user_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text])));

DROP POLICY IF EXISTS patient_segments_staff_read ON public.patient_segments;
CREATE POLICY patient_segments_staff_read ON public.patient_segments AS PERMISSIVE FOR SELECT TO public
  USING ((current_user_role() = ANY (ARRAY['expert'::text, 'admin'::text, 'super_admin'::text])));

DROP POLICY IF EXISTS point_a_insights_insert_admin ON public.point_a_insights;
CREATE POLICY point_a_insights_insert_admin ON public.point_a_insights AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text, 'expert'::text]))))));

DROP POLICY IF EXISTS point_a_insights_select_admin ON public.point_a_insights;
CREATE POLICY point_a_insights_select_admin ON public.point_a_insights AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text, 'expert'::text]))))));

DROP POLICY IF EXISTS point_a_insights_update_admin ON public.point_a_insights;
CREATE POLICY point_a_insights_update_admin ON public.point_a_insights AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text, 'expert'::text]))))));

DROP POLICY IF EXISTS point_b_staff_read ON public.point_b_analysis;
CREATE POLICY point_b_staff_read ON public.point_b_analysis AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['expert'::text, 'admin'::text, 'super_admin'::text]))))));

DROP POLICY IF EXISTS point_b_versions_staff_all ON public.point_b_versions;
CREATE POLICY point_b_versions_staff_all ON public.point_b_versions AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['expert'::text, 'admin'::text, 'super_admin'::text]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = ANY (ARRAY['expert'::text, 'admin'::text, 'super_admin'::text]))))));

DROP POLICY IF EXISTS profiles_admin_select ON public.profiles;
CREATE POLICY profiles_admin_select ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING ((current_user_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text])));

DROP POLICY IF EXISTS report_version_reviews_select ON public.report_version_reviews;
CREATE POLICY report_version_reviews_select ON public.report_version_reviews AS PERMISSIVE FOR SELECT TO public
  USING (is_platform_staff());

DROP POLICY IF EXISTS revenue_losses_staff_read ON public.revenue_losses;
CREATE POLICY revenue_losses_staff_read ON public.revenue_losses AS PERMISSIVE FOR SELECT TO public
  USING ((current_user_role() = ANY (ARRAY['expert'::text, 'admin'::text, 'super_admin'::text])));

DROP POLICY IF EXISTS survey_admin_insert ON public.survey_answers;
CREATE POLICY survey_admin_insert ON public.survey_answers AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((current_user_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text])));

DROP POLICY IF EXISTS survey_admin_select ON public.survey_answers;
CREATE POLICY survey_admin_select ON public.survey_answers AS PERMISSIVE FOR SELECT TO public
  USING ((current_user_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text])));

DROP POLICY IF EXISTS survey_admin_update ON public.survey_answers;
CREATE POLICY survey_admin_update ON public.survey_answers AS PERMISSIVE FOR UPDATE TO public
  USING ((current_user_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'manager'::text, 'analyst'::text])));

-- Helpers introduced by 140 (nothing above references them any more).
DROP FUNCTION IF EXISTS public.staff_can_read_company(text);
DROP FUNCTION IF EXISTS public.staff_assigned_user_ids();
DROP FUNCTION IF EXISTS public.expert_assigned_user_ids();
DROP FUNCTION IF EXISTS public.staff_sees_all_clients();
DROP FUNCTION IF EXISTS public.diagnostic_owner(uuid);
DROP FUNCTION IF EXISTS public.is_active_expert();
DROP FUNCTION IF EXISTS public.current_staff_role();
