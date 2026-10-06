-- 084_tenancy_partners_members.sql
--
-- Three-level B2B tenancy (docs/platform/03-database.md, decision D1):
--
--   platform staff (profiles.role / staff_roles)       → every company, by RBAC
--   partner_organizations ─< partner_members            → the partner's companies
--   companies (tenant)    ─< company_members            → one company, by member role
--
-- Before this migration the tenant was the auth user: companies.user_id was the
-- only link, one person per company, no agencies. companies.user_id stays as the
-- primary owner so every existing user_id-based RLS policy keeps working; this
-- file only ADDS access paths (SELECT) for members and partners.
--
-- New company-scoped tables use public.can_read_company(company_id::text) in
-- their SELECT policy and accept writes only from the service role, after the
-- API has authorised the caller.
--
-- Note: the legacy Prisma `organizations` table (NextAuth era) is unrelated and
-- stays frozen; partners live in `partner_organizations`.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/084_tenancy_partners_members.sql

-- ─── Partner organisations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_organizations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  slug        TEXT        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  settings    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.partner_organizations IS
  'Agencies / franchisees that run diagnostics for their own client companies (084).';

DROP TRIGGER IF EXISTS partner_organizations_updated_at ON public.partner_organizations;
CREATE TRIGGER partner_organizations_updated_at
  BEFORE UPDATE ON public.partner_organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.partner_members (
  partner_id  UUID        NOT NULL REFERENCES public.partner_organizations(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL CHECK (role IN ('partner_admin', 'partner_expert')),
  status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'removed')),
  invited_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, user_id)
);
CREATE INDEX IF NOT EXISTS partner_members_user_idx
  ON public.partner_members (user_id) WHERE status = 'active';

DROP TRIGGER IF EXISTS partner_members_updated_at ON public.partner_members;
CREATE TRIGGER partner_members_updated_at
  BEFORE UPDATE ON public.partner_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES public.partner_organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS companies_partner_idx
  ON public.companies (partner_id) WHERE partner_id IS NOT NULL;

-- ─── Company members ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_members (
  company_id  TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'removed')),
  invited_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
COMMENT ON TABLE public.company_members IS
  'People of a client company and their role in it (084). companies.user_id is mirrored as owner.';
CREATE INDEX IF NOT EXISTS company_members_user_idx
  ON public.company_members (user_id) WHERE status = 'active';

DROP TRIGGER IF EXISTS company_members_updated_at ON public.company_members;
CREATE TRIGGER company_members_updated_at
  BEFORE UPDATE ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- companies.user_id (primary owner, set by onboarding) ⇒ owner membership.
CREATE OR REPLACE FUNCTION public.companies_sync_owner_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    INSERT INTO public.company_members (company_id, user_id, role, status, invited_by)
    VALUES (NEW.id, NEW.user_id, 'owner', 'active', 'system:companies.user_id')
    ON CONFLICT (company_id, user_id) DO UPDATE
      SET role = 'owner', status = 'active'
      WHERE public.company_members.status <> 'active' OR public.company_members.role <> 'owner';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_sync_owner_membership ON public.companies;
CREATE TRIGGER companies_sync_owner_membership
  AFTER INSERT OR UPDATE OF user_id ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.companies_sync_owner_membership();

INSERT INTO public.company_members (company_id, user_id, role, status, invited_by)
SELECT c.id, c.user_id, 'owner', 'active', 'backfill:084'
FROM public.companies c
JOIN auth.users u ON u.id = c.user_id
WHERE c.user_id IS NOT NULL
ON CONFLICT (company_id, user_id) DO NOTHING;

-- ─── Access helpers (SECURITY DEFINER: read membership without RLS recursion) ─
CREATE OR REPLACE FUNCTION public.is_platform_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'approved'
      AND (
        p.role IN ('super_admin', 'admin', 'manager', 'analyst', 'expert')
        OR EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = p.id)
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'approved'
      AND (
        p.role IN ('super_admin', 'admin')
        OR EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = p.id AND s.role IN ('super_admin', 'admin'))
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.company_member_role(p_company_id TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.role FROM public.company_members m
  WHERE m.company_id = p_company_id AND m.user_id = auth.uid() AND m.status = 'active'
$$;

CREATE OR REPLACE FUNCTION public.partner_role_for_company(p_company_id TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pm.role
  FROM public.companies c
  JOIN public.partner_members pm ON pm.partner_id = c.partner_id
  JOIN public.partner_organizations po ON po.id = c.partner_id AND po.status = 'active'
  WHERE c.id = p_company_id AND pm.user_id = auth.uid() AND pm.status = 'active'
$$;

CREATE OR REPLACE FUNCTION public.can_read_company(p_company_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_company_id IS NOT NULL AND auth.uid() IS NOT NULL AND (
       public.company_member_role(p_company_id) IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id AND c.user_id = auth.uid())
    OR public.partner_role_for_company(p_company_id) IS NOT NULL
    OR public.is_platform_staff()
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_company(p_company_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_company_id IS NOT NULL AND auth.uid() IS NOT NULL AND (
       public.company_member_role(p_company_id) IN ('owner', 'admin')
    OR EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id AND c.user_id = auth.uid())
    OR public.partner_role_for_company(p_company_id) = 'partner_admin'
    OR public.is_platform_admin()
  )
$$;

-- Partner role of the caller (no RLS recursion inside partner_* policies).
CREATE OR REPLACE FUNCTION public.partner_member_role(p_partner_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pm.role FROM public.partner_members pm
  WHERE pm.partner_id = p_partner_id AND pm.user_id = auth.uid() AND pm.status = 'active'
$$;

-- Companies the caller may read; used by APIs to list tenants.
CREATE OR REPLACE FUNCTION public.accessible_company_ids()
RETURNS SETOF TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.is_platform_staff()', 'public.is_platform_admin()',
    'public.company_member_role(text)', 'public.partner_role_for_company(text)',
    'public.partner_member_role(uuid)',
    'public.can_read_company(text)', 'public.can_manage_company(text)',
    'public.accessible_company_ids()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', f);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.companies_sync_owner_membership() FROM PUBLIC;

-- ─── RLS on the new tables (read-only for API roles) ────────────────────────
ALTER TABLE public.partner_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members       ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.partner_organizations, public.partner_members, public.company_members
  FROM anon, authenticated;

DROP POLICY IF EXISTS partner_organizations_select ON public.partner_organizations;
CREATE POLICY partner_organizations_select ON public.partner_organizations FOR SELECT USING (
  public.is_platform_staff() OR public.partner_member_role(id) IS NOT NULL
);

DROP POLICY IF EXISTS partner_members_select ON public.partner_members;
CREATE POLICY partner_members_select ON public.partner_members FOR SELECT USING (
  user_id = auth.uid()
  OR public.is_platform_staff()
  OR public.partner_member_role(partner_id) = 'partner_admin'
);

DROP POLICY IF EXISTS company_members_select ON public.company_members;
CREATE POLICY company_members_select ON public.company_members FOR SELECT USING (
  public.can_read_company(company_id)
);

-- ─── Additive read access on existing company data ──────────────────────────
-- company_id::text works whether the column is TEXT (prod companies.id) or UUID.
DROP POLICY IF EXISTS companies_tenant_select ON public.companies;
CREATE POLICY companies_tenant_select ON public.companies FOR SELECT USING (public.can_read_company(id));

DROP POLICY IF EXISTS diagnostics_tenant_select ON public.diagnostics;
CREATE POLICY diagnostics_tenant_select ON public.diagnostics FOR SELECT
  USING (company_id IS NOT NULL AND public.can_read_company(company_id::text));

DROP POLICY IF EXISTS metrics_tenant_select ON public.metrics;
CREATE POLICY metrics_tenant_select ON public.metrics FOR SELECT
  USING (public.can_read_company(company_id::text));

DROP POLICY IF EXISTS documents_tenant_select ON public.documents;
CREATE POLICY documents_tenant_select ON public.documents FOR SELECT
  USING (company_id IS NOT NULL AND public.can_read_company(company_id::text));

DROP POLICY IF EXISTS survey_answers_tenant_select ON public.survey_answers;
CREATE POLICY survey_answers_tenant_select ON public.survey_answers FOR SELECT
  USING (company_id IS NOT NULL AND public.can_read_company(company_id::text));

DROP POLICY IF EXISTS gri_assessments_tenant_select ON public.gri_assessments;
CREATE POLICY gri_assessments_tenant_select ON public.gri_assessments FOR SELECT
  USING (company_id IS NOT NULL AND public.can_read_company(company_id::text));

NOTIFY pgrst, 'reload schema';
