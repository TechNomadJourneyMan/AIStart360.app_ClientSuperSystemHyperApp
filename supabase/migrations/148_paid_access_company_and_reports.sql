-- 148_paid_access_company_and_reports.sql
--
-- R2-C, decisions of the PO (Round 2):
--
-- Q3. Members of a company inherit the tariff of the company. A person with an
--     ACTIVE membership (company_members, migration 084: role owner / admin /
--     member / viewer, status 'active') in a company whose primary owner
--     (companies.user_id) has a paid right gets that right as well. The owner's
--     right is the same rule as for anybody: his feature_flags override, else
--     tier = 'pro'. The member's OWN explicit boolean in feature_flags still
--     decides first (an explicit false closes the section for him).
--     The rule is the same in the portal (lib/access/server.ts readEntitlements →
--     lib/access/entitlements.ts withCompanyRights, which reads
--     company_inherited_rights() below) and in the database (has_paid_section).
--
-- M-4. The expert's report is part of Точка А (right 'point_a'); staff are not
--     restricted. The tables of the report a client reads with his own session
--     get the same RESTRICTIVE «paid section» SELECT policy as the tables of
--     migration 147:
--       report_versions, expert_reviews, expert_comments,
--       diagnostic_findings, diagnostic_recommendations      → point_a
--     The expert / GIGA / review flow is not affected: staff of the session pass
--     has_paid_section (current_staff_role() / is_active_expert(), session gate
--     of 143), the review flow and the PDFs read with Prisma / the service role
--     (no RLS). The client's home card «Отчёт эксперта готов» reads the version
--     metadata with the service role (app/client/home/page.tsx).
--
-- has_paid_section(section), after this migration (same order as
-- lib/access/decision.ts decideFeature + readEntitlements):
--   1. staff of this session                                   → yes;
--   2. system_settings.access_gates is not on                  → yes;
--   3. own profiles.feature_flags->section is a boolean        → that value;
--   4. own profiles.tier = 'pro'                               → yes;
--   5. an active membership in a company whose owner has the right → yes;
--   6. otherwise                                               → no.
--
-- Migration 147 is NOT edited: this file replaces the function (CREATE OR
-- REPLACE keeps its grants) and adds policies. Idempotent: CREATE OR REPLACE,
-- DROP POLICY IF EXISTS, absent tables are skipped. Apply AFTER 147.
-- Rollback: supabase/migrations/rollback/148_paid_access_company_and_reports.down.sql
-- Apply: node scripts/apply-migration.js supabase/migrations/148_paid_access_company_and_reports.sql

SET LOCAL lock_timeout = '5s';

-- ─── The right of one profile (override, else tariff) ───────────────────────
CREATE OR REPLACE FUNCTION public.paid_right_of(p_tier text, p_flags jsonb, p_feature text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_flags -> p_feature) = 'boolean' THEN (p_flags ->> p_feature)::boolean
    ELSE coalesce(p_tier, 'free') = 'pro'
  END
$$;

COMMENT ON FUNCTION public.paid_right_of(text, jsonb, text) IS
  'R2-C: the right of one profile to a feature — feature_flags override, else tier = pro (lib/access/entitlements.ts entitlementsFor)';

REVOKE ALL ON FUNCTION public.paid_right_of(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paid_right_of(text, jsonb, text) TO authenticated, service_role;

-- ─── Rights a person inherits from the companies he is a member of (Q3) ─────
-- Returns {point_a, point_b, market, gri_full, pdf_export, ai_chat, benchmarks:
-- bool, gri_full_unlimited: bool} — true when at least one company of an
-- ACTIVE membership has a primary owner (not the person himself) with that
-- right. gri_full_unlimited: such an owner is on the Pro tier (no run limit).
-- A signed-in user may ask only about himself; the service role about anybody;
-- anything else gets «no rights» (never an error, never someone else's data).
CREATE OR REPLACE FUNCTION public.company_inherited_rights(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH caller AS (
    SELECT p_user AS uid
     WHERE p_user IS NOT NULL
       AND (
         p_user = auth.uid()
         OR coalesce(
              nullif(current_setting('request.jwt.claim.role', true), ''),
              nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
              ''
            ) = 'service_role'
       )
  ),
  owners AS (
    SELECT DISTINCT o.id, o.tier, o.feature_flags
      FROM caller
      JOIN public.company_members m
        ON m.user_id = caller.uid
       AND m.status = 'active'
       AND m.role IN ('owner', 'admin', 'member', 'viewer')
      JOIN public.companies c
        ON c.id = m.company_id
       AND c.user_id IS NOT NULL
       AND c.user_id <> caller.uid
      JOIN public.profiles o
        ON o.id = c.user_id
  )
  SELECT jsonb_build_object(
    'point_a',    coalesce(bool_or(public.paid_right_of(tier, feature_flags, 'point_a')), false),
    'point_b',    coalesce(bool_or(public.paid_right_of(tier, feature_flags, 'point_b')), false),
    'market',     coalesce(bool_or(public.paid_right_of(tier, feature_flags, 'market')), false),
    'gri_full',   coalesce(bool_or(public.paid_right_of(tier, feature_flags, 'gri_full')), false),
    'pdf_export', coalesce(bool_or(public.paid_right_of(tier, feature_flags, 'pdf_export')), false),
    'ai_chat',    coalesce(bool_or(public.paid_right_of(tier, feature_flags, 'ai_chat')), false),
    'benchmarks', coalesce(bool_or(public.paid_right_of(tier, feature_flags, 'benchmarks')), false),
    'gri_full_unlimited', coalesce(bool_or(public.paid_right_of(tier, feature_flags, 'gri_full') AND coalesce(tier, 'free') = 'pro'), false)
  )
  FROM owners
$$;

COMMENT ON FUNCTION public.company_inherited_rights(uuid) IS
  'R2-C (Q3): paid rights a person inherits from the owners of the companies of his active memberships; self or service role only';

REVOKE ALL ON FUNCTION public.company_inherited_rights(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_inherited_rights(uuid) TO authenticated, service_role;

-- ─── has_paid_section: + company inheritance (step 5) ───────────────────────
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
  -- 3. Own per-user override (an explicit false closes the section, also for a member).
  SELECT tier, feature_flags INTO v_tier, v_flags FROM public.profiles WHERE id = auth.uid();
  v_override := v_flags -> p_section;
  IF jsonb_typeof(v_override) = 'boolean' THEN
    RETURN (v_override #>> '{}')::boolean;
  END IF;
  -- 4. Own tariff.
  IF coalesce(v_tier, 'free') = 'pro' THEN
    RETURN true;
  END IF;
  -- 5. The tariff of a company the user is an active member of (Q3).
  RETURN coalesce((public.company_inherited_rights(auth.uid()) ->> p_section)::boolean, false);
END
$$;

COMMENT ON FUNCTION public.has_paid_section(text) IS
  'R2-A/R2-C: is the paid section (point_a | point_b | market | gri_full) open for auth.uid()? Same rule as lib/access/decision.ts decideFeature + readEntitlements (company inheritance, 148)';

REVOKE ALL ON FUNCTION public.has_paid_section(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_paid_section(text) TO authenticated, service_role;

-- ─── M-4: the report tables a client reads with his session → point_a ──────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'report_versions', 'expert_reviews', 'expert_comments',
    'diagnostic_findings', 'diagnostic_recommendations'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE '148: table % is absent — skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_paid_section', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT public.has_paid_section(%L)))',
      t || '_paid_section', t, 'point_a'
    );
  END LOOP;
END $$;
