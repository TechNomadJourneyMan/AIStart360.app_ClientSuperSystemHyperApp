-- 148_paid_access_company_and_reports.down.sql — ROLLBACK of migration 148.
--
-- NOT part of the migration sequence (scripts/test-db/setup.mjs and go-live
-- checks read only supabase/migrations/*.sql, not sub-folders).
-- Restores has_paid_section() exactly as migration 147 created it (no company
-- inheritance), drops the «paid section» SELECT policies of the report tables
-- and the two helper functions. No data is changed. After it:
--   • a member of a paid company is again limited to his own tariff in the DB
--     (the portal code of R2-C still lets him in — roll the code back too);
--   • a Free client can again read his published report / expert comments /
--     findings directly through PostgREST (the portal's APIs still gate them).
--   node scripts/apply-migration.js supabase/migrations/rollback/148_paid_access_company_and_reports.down.sql

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
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'report_versions', 'expert_reviews', 'expert_comments',
    'diagnostic_findings', 'diagnostic_recommendations'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_paid_section', t);
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.company_inherited_rights(uuid);
DROP FUNCTION IF EXISTS public.paid_right_of(text, jsonb, text);
