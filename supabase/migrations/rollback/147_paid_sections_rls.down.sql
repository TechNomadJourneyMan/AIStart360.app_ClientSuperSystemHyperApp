-- 147_paid_sections_rls.down.sql — ROLLBACK of migration 147.
--
-- NOT part of the migration sequence (scripts/test-db/setup.mjs and go-live
-- checks read only supabase/migrations/*.sql, not sub-folders).
-- Drops the restrictive «paid section» SELECT policies and the function; no
-- data is changed. After it a Free client can again read his own rows of the
-- paid sections directly through PostgREST (the portal's pages and APIs still
-- gate them — lib/access/decision.ts).
--   node scripts/apply-migration.js supabase/migrations/rollback/147_paid_sections_rls.down.sql

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'diagnostics', 'point_a_snapshots', 'point_a_insights', 'point_a_comments', 'point_a_hypothesis_reviews',
    'point_b_analysis', 'point_b_versions', 'pb_plans', 'pb_plan_versions', 'pb_goal_reviews', 'pb_checkpoints',
    'pb_monthly_facts', 'pb_finmodel_inputs', 'pb_recommendations', 'pb_saved_scenarios', 'pb_invites',
    'gri_assessments', 'gri_assessment_drafts', 'gri_calc_sessions', 'gri_plan_progress',
    'market_analysis_answers', 'market_snapshots', 'action_items'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_paid_section', t);
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.has_paid_section(text);
