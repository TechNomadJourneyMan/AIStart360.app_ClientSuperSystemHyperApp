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
--       diagnostic_findings, diagnostic_recommendations,
--       diagnostic_sessions (its `overview` is the Point A summary)  → point_a
--     The expert / GIGA / review flow is not affected: staff of the session pass
--     has_paid_section (current_staff_role() / is_active_expert(), session gate
--     of 143), the review flow and the PDFs read with Prisma / the service role
--     (no RLS). The client's home card «Отчёт эксперта готов» reads the version
--     metadata with the service role (app/client/home/page.tsx).
--
-- The rule lives in ONE function, paid_section_of(user, section) (no staff
-- step — it is the rule of a CLIENT):
--   1. system_settings.access_gates is not on                  → yes;
--   2. no user                                                 → no;
--   3. own profiles.feature_flags->section is a boolean        → that value;
--   4. own profiles.tier = 'pro'                               → yes;
--   5. an active membership in a company whose owner has the right → yes;
--   6. otherwise                                               → no.
-- has_paid_section(section) = staff of this session OR paid_section_of(auth.uid()).
-- paid_sections_for_owners(company ids, section) — the same rule for the OWNERS
-- of many companies in one call (service role only: the expert / GIGA review
-- queues say «the client is on the free tariff», R2-C review F8);
-- paid_sections_for_users(user ids, section) — the same for given clients
-- (User 360: «Новый комментарий» / «Опубликовать разбор», R2-C verify).
-- Same order as lib/access/decision.ts decideFeature + readEntitlements.
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
-- INTERNAL (no caller check — only the SECURITY DEFINER functions below call
-- it). Returns {point_a, point_b, market, gri_full, pdf_export, ai_chat,
-- benchmarks: bool, gri_full_unlimited: bool} — true when at least one company
-- of an ACTIVE membership has a primary owner (not the person himself) with
-- that right. gri_full_unlimited: such an owner is on the Pro tier.
CREATE OR REPLACE FUNCTION public.company_rights_of(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH owners AS (
    SELECT DISTINCT o.id, o.tier, o.feature_flags
      FROM public.company_members m
      JOIN public.companies c
        ON c.id = m.company_id
       AND c.user_id IS NOT NULL
       AND c.user_id <> m.user_id
      JOIN public.profiles o
        ON o.id = c.user_id
     WHERE p_user IS NOT NULL
       AND m.user_id = p_user
       AND m.status = 'active'
       AND m.role IN ('owner', 'admin', 'member', 'viewer')
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

COMMENT ON FUNCTION public.company_rights_of(uuid) IS
  'R2-C (Q3): paid rights inherited from the owners of the companies of the active memberships of p_user. Internal: no caller check';

REVOKE ALL ON FUNCTION public.company_rights_of(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The same, for the portal (lib/access/server.ts readCompanyRights). A signed-in
-- user may ask only about himself; the service role about anybody; anything
-- else gets «no rights» (never an error, never someone else's data).
CREATE OR REPLACE FUNCTION public.company_inherited_rights(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.company_rights_of(
    CASE WHEN p_user IS NOT NULL
          AND (
            p_user = auth.uid()
            OR coalesce(
                 nullif(current_setting('request.jwt.claim.role', true), ''),
                 nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                 ''
               ) = 'service_role'
          )
         THEN p_user END
  )
$$;

COMMENT ON FUNCTION public.company_inherited_rights(uuid) IS
  'R2-C (Q3): paid rights a person inherits from the owners of the companies of his active memberships; self or service role only';

REVOKE ALL ON FUNCTION public.company_inherited_rights(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_inherited_rights(uuid) TO authenticated, service_role;

-- ─── The rule of a client: is the paid section open for p_user? ─────────────
-- INTERNAL (no staff step, no caller check): has_paid_section() asks it about
-- auth.uid(), paid_sections_for_owners() about the owners of companies.
CREATE OR REPLACE FUNCTION public.paid_section_of(p_user uuid, p_section text)
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
  IF p_section NOT IN ('point_a', 'point_b', 'market', 'gri_full') THEN
    RETURN false;
  END IF;
  -- 1. The switch (lib/settings/registry.ts access_gates: boolean or {enabled}).
  SELECT value INTO v_gates FROM public.system_settings WHERE key = 'access_gates';
  IF jsonb_typeof(v_gates) = 'boolean' THEN
    v_on := (v_gates #>> '{}')::boolean;
  ELSIF jsonb_typeof(v_gates -> 'enabled') = 'boolean' THEN
    v_on := (v_gates ->> 'enabled')::boolean;
  END IF;
  IF NOT v_on THEN
    RETURN true;
  END IF;
  -- 2. Nobody to ask about (a company without an owner).
  IF p_user IS NULL THEN
    RETURN false;
  END IF;
  -- 3. Own per-user override (an explicit false closes the section, also for a member).
  SELECT tier, feature_flags INTO v_tier, v_flags FROM public.profiles WHERE id = p_user;
  v_override := v_flags -> p_section;
  IF jsonb_typeof(v_override) = 'boolean' THEN
    RETURN (v_override #>> '{}')::boolean;
  END IF;
  -- 4. Own tariff.
  IF coalesce(v_tier, 'free') = 'pro' THEN
    RETURN true;
  END IF;
  -- 5. The tariff of a company the user is an active member of (Q3).
  RETURN coalesce((public.company_rights_of(p_user) ->> p_section)::boolean, false);
END
$$;

COMMENT ON FUNCTION public.paid_section_of(uuid, text) IS
  'R2-C: the paid-section rule of a client (switch, override, tariff, company inheritance). Internal: no staff step, no caller check';

REVOKE ALL ON FUNCTION public.paid_section_of(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ─── has_paid_section: staff of the session, else the rule of a client ─────
CREATE OR REPLACE FUNCTION public.has_paid_section(p_section text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  IF p_section NOT IN ('point_a', 'point_b', 'market', 'gri_full') THEN
    RETURN false;
  END IF;
  -- Staff of this session (migration 140 rule + the session gate of 143).
  IF public.current_staff_role() IS NOT NULL OR public.is_active_expert() THEN
    RETURN true;
  END IF;
  RETURN public.paid_section_of(auth.uid(), p_section);
END
$$;

COMMENT ON FUNCTION public.has_paid_section(text) IS
  'R2-A/R2-C: is the paid section (point_a | point_b | market | gri_full) open for auth.uid()? Same rule as lib/access/decision.ts decideFeature + readEntitlements (company inheritance, 148)';

REVOKE ALL ON FUNCTION public.has_paid_section(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_paid_section(text) TO authenticated, service_role;

-- ─── The same rule for the OWNERS of many companies at once (review F8) ────
-- One row per existing company of p_company_ids: its owner and whether the
-- section is open for him (a company without an owner: open only while the
-- switch is off). Service role only — it tells about other people's tariffs.
CREATE OR REPLACE FUNCTION public.paid_sections_for_owners(p_company_ids text[], p_section text)
RETURNS TABLE (company_id text, owner_id uuid, open boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.user_id, public.paid_section_of(c.user_id, p_section)
    FROM public.companies c
   WHERE c.id = ANY (coalesce(p_company_ids, ARRAY[]::text[]))
$$;

COMMENT ON FUNCTION public.paid_sections_for_owners(text[], text) IS
  'R2-C: is the paid section open for the OWNER of each company (the client rule, no staff); service role only';

REVOKE ALL ON FUNCTION public.paid_sections_for_owners(text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paid_sections_for_owners(text[], text) TO service_role;

-- The same rule for given CLIENTS (one row per existing profile). Service role only.
CREATE OR REPLACE FUNCTION public.paid_sections_for_users(p_user_ids uuid[], p_section text)
RETURNS TABLE (user_id uuid, open boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, public.paid_section_of(p.id, p_section)
    FROM public.profiles p
   WHERE p.id = ANY (coalesce(p_user_ids, ARRAY[]::uuid[]))
$$;

COMMENT ON FUNCTION public.paid_sections_for_users(uuid[], text) IS
  'R2-C: is the paid section open for each given client (the client rule, no staff); service role only';

REVOKE ALL ON FUNCTION public.paid_sections_for_users(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paid_sections_for_users(uuid[], text) TO service_role;

-- ─── M-4: the report tables a client reads with his session → point_a ──────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'report_versions', 'expert_reviews', 'expert_comments',
    'diagnostic_findings', 'diagnostic_recommendations', 'diagnostic_sessions'
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
