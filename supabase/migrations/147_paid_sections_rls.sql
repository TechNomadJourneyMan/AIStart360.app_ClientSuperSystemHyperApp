-- 147_paid_sections_rls.sql
--
-- R2-A (ревью H-4): the tariff at the DATABASE level. Points A / B, Market and
-- the full GRI are paid sections (founder, 2026-11). The portal gates its pages
-- and APIs (lib/access/decision.ts), but a Free client could still read his own
-- paid rows straight through PostgREST with his JWT and the public anon key
-- (diagnostics incl. ai_analysis, the full GRI with its 90-day plan, …).
--
-- public.has_paid_section(section) — the SAME rule as decideFeature():
--   1. staff of this session (a staff_roles row — current_staff_role(), or an
--      active expert — is_active_expert(); both keep the session gate of 143) → yes;
--   2. system_settings.access_gates is not on (missing row / false) → yes;
--   3. profiles.feature_flags->section is a boolean → that value (override);
--   4. otherwise profiles.tier = 'pro'.
-- (The app treats an UNREADABLE switch as «on» — fail closed; in SQL a failed
-- read is an error of the query itself, nothing is returned.)
--
-- One RESTRICTIVE policy FOR SELECT TO authenticated per paid table: ANDed with
-- the existing permissive policies (own rows, tenant / staff paths of 140), so
-- it can only take rows away — never grant. service_role bypasses RLS: the free
-- surfaces that show a part of Point A (the express «Снимок бизнеса», the home
-- tile) read it on the server with the service role after the session check
-- (app/api/v1/point-a/state ?view=express, app/client/home/page.tsx).
-- The function is wrapped in a scalar sub-select, so it is evaluated once per
-- query (an initplan), not once per row.
--
--   Точка А   diagnostics, point_a_snapshots, point_a_insights, point_a_comments,
--             point_a_hypothesis_reviews
--   Точка Б   point_b_analysis, point_b_versions, pb_* (plans, plan versions,
--             goal reviews, checkpoints, monthly facts, finmodel inputs,
--             recommendations, saved scenarios, invites)
--   полный GRI gri_assessments, gri_assessment_drafts, gri_calc_sessions, gri_plan_progress
--   Рынок     market_analysis_answers, market_snapshots
--   action_items — by its source: 'point_b' → Точка Б, otherwise → полный GRI
-- Not covered on purpose: gri_pulse_responses (Пульс is free), data_discrepancies
-- (documents flow), report_versions (open PO question M-4), survey / documents / goals.
--
-- Idempotent (CREATE OR REPLACE, DROP POLICY IF EXISTS, tables that do not
-- exist are skipped). Rollback: supabase/migrations/rollback/147_paid_sections_rls.down.sql
-- Apply: node scripts/apply-migration.js supabase/migrations/147_paid_sections_rls.sql

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.has_paid_section(p_section text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gates    jsonb;
  v_on       boolean := false;
  v_tier     text;
  v_flags    jsonb;
  v_override jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  IF p_section NOT IN ('point_a', 'point_b', 'market', 'gri_full') THEN
    RETURN false;
  END IF;
  -- 1. Staff of this session (migration 140 rule + the session gate of 143).
  IF public.current_staff_role() IS NOT NULL OR public.is_active_expert() THEN
    RETURN true;
  END IF;
  -- 2. The switch (lib/settings/registry.ts access_gates: boolean or {enabled}).
  SELECT value INTO v_gates FROM public.system_settings WHERE key = 'access_gates';
  IF jsonb_typeof(v_gates) = 'boolean' THEN
    v_on := (v_gates #>> '{}')::boolean;
  ELSIF jsonb_typeof(v_gates -> 'enabled') = 'boolean' THEN
    v_on := (v_gates ->> 'enabled')::boolean;
  END IF;
  IF NOT v_on THEN
    RETURN true;
  END IF;
  -- 3. Per-user override, 4. tariff.
  SELECT tier, feature_flags INTO v_tier, v_flags FROM public.profiles WHERE id = auth.uid();
  v_override := v_flags -> p_section;
  IF jsonb_typeof(v_override) = 'boolean' THEN
    RETURN (v_override #>> '{}')::boolean;
  END IF;
  RETURN coalesce(v_tier, 'free') = 'pro';
END
$$;

COMMENT ON FUNCTION public.has_paid_section(text) IS
  'R2-A: is the paid section (point_a | point_b | market | gri_full) open for auth.uid()? Same rule as lib/access/decision.ts decideFeature';

REVOKE ALL ON FUNCTION public.has_paid_section(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_paid_section(text) TO authenticated, service_role;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('diagnostics', 'point_a'),
      ('point_a_snapshots', 'point_a'),
      ('point_a_insights', 'point_a'),
      ('point_a_comments', 'point_a'),
      ('point_a_hypothesis_reviews', 'point_a'),
      ('point_b_analysis', 'point_b'),
      ('point_b_versions', 'point_b'),
      ('pb_plans', 'point_b'),
      ('pb_plan_versions', 'point_b'),
      ('pb_goal_reviews', 'point_b'),
      ('pb_checkpoints', 'point_b'),
      ('pb_monthly_facts', 'point_b'),
      ('pb_finmodel_inputs', 'point_b'),
      ('pb_recommendations', 'point_b'),
      ('pb_saved_scenarios', 'point_b'),
      ('pb_invites', 'point_b'),
      ('gri_assessments', 'gri_full'),
      ('gri_assessment_drafts', 'gri_full'),
      ('gri_calc_sessions', 'gri_full'),
      ('gri_plan_progress', 'gri_full'),
      ('market_analysis_answers', 'market'),
      ('market_snapshots', 'market')
    ) AS t(tbl, section)
  LOOP
    IF to_regclass(format('public.%I', r.tbl)) IS NULL THEN
      RAISE NOTICE '147: table % is absent — skipped', r.tbl;
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_paid_section', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_paid_section(%L)))',
      r.tbl || '_paid_section', r.tbl, r.section
    );
  END LOOP;

  IF to_regclass('public.action_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS action_items_paid_section ON public.action_items;
    CREATE POLICY action_items_paid_section ON public.action_items AS RESTRICTIVE FOR SELECT TO authenticated
      USING (CASE WHEN source = 'point_b'
                  THEN (SELECT public.has_paid_section('point_b'))
                  ELSE (SELECT public.has_paid_section('gri_full')) END);
  END IF;
END $$;
