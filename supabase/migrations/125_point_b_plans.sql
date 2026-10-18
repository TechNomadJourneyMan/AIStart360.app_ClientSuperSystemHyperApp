-- 125_point_b_plans.sql
--
-- Point B plan workflow (docs/superpowers/specs/2026-10-18-point-b-design.md §6, §8;
-- plan docs/superpowers/plans/2026-10-18-point-b-phase1-plan-workflow.md, task 1):
--
--   pb_plans           ONE plan per company (unique company_id): which version is
--                      being worked on (current_version_id) and which one the
--                      client sees (published_version_id), plus settings.
--   pb_plan_versions   versions of the plan: draft → in_review → approved, the
--                      previous approved one becomes superseded. A rejection by
--                      the senior staff member returns the version to draft and
--                      keeps rejected_by / rejected_at / rejected_reason on the
--                      row (there is no separate «rejected» status). goals is a
--                      SNAPSHOT of the owner's goals (the goals themselves stay
--                      in metric_targets). At most ONE open (draft / in_review)
--                      version per plan (partial unique index). An approved
--                      version is immutable: the trigger allows only the
--                      approved → superseded status change.
--   pb_goal_reviews    verification of a goal by an expert: verified / corrected
--                      (a proposal that waits for the owner) / agreed / disputed.
--                      Append-only history; the LAST row of a (company, metric,
--                      period) is the current status, no rows = owner_draft.
--
-- author_id / approved_by / rejected_by / reviewer_id carry NO foreign keys on
-- purpose: an ON DELETE SET NULL on an approved (immutable) row would fire the
-- immutability trigger and block the deletion of a staff account.
--
-- RLS: every table is written by the server only (service role). A signed-in
-- client may SELECT his own plan row, ONLY APPROVED versions of his plan, and
-- the goal reviews of the companies he may read. No INSERT / UPDATE grants to
-- authenticated or anon.
--
-- Additive: point_b_analysis and point_b_versions stay as they are. The backfill
-- makes version 1 (approved) of a plan from the latest approved point_b_versions
-- row of every company that has one.
--
-- Idempotent. NOT applied to production by the author of this file: apply with
-- node scripts/apply-migration.js supabase/migrations/125_point_b_plans.sql
-- only after the product owner's go-ahead.

-- ─── 1. Plans ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pb_plans (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            TEXT        NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_version_id    UUID,
  published_version_id  UUID,
  settings              JSONB       NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 65536),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pb_plans_user_idx ON public.pb_plans (user_id);

DROP TRIGGER IF EXISTS pb_plans_updated_at ON public.pb_plans;
CREATE TRIGGER pb_plans_updated_at
  BEFORE UPDATE ON public.pb_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 2. Plan versions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pb_plan_versions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id             UUID        NOT NULL REFERENCES public.pb_plans(id) ON DELETE CASCADE,
  version             INT         NOT NULL CHECK (version >= 1),
  status              TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'in_review', 'approved', 'superseded')),
  base_snapshot_id    UUID        REFERENCES public.point_a_snapshots(id) ON DELETE SET NULL,
  goals               JSONB       NOT NULL DEFAULT '{"primary": null, "items": []}'::jsonb
                      CHECK (jsonb_typeof(goals) = 'object' AND pg_column_size(goals) <= 262144),
  assumptions         JSONB       NOT NULL DEFAULT '{}'::jsonb
                      CHECK (jsonb_typeof(assumptions) = 'object' AND pg_column_size(assumptions) <= 262144),
  scenarios           JSONB       NOT NULL DEFAULT '[]'::jsonb
                      CHECK (jsonb_typeof(scenarios) = 'array' AND pg_column_size(scenarios) <= 524288),
  selected_scenario   TEXT        CHECK (selected_scenario IS NULL OR length(selected_scenario) <= 100),
  strategy            JSONB       NOT NULL DEFAULT '{}'::jsonb
                      CHECK (jsonb_typeof(strategy) = 'object' AND pg_column_size(strategy) <= 524288),
  risks               JSONB       NOT NULL DEFAULT '[]'::jsonb
                      CHECK (jsonb_typeof(risks) = 'array' AND pg_column_size(risks) <= 262144),
  expert_notes        TEXT        CHECK (expert_notes IS NULL OR length(expert_notes) <= 20000),
  change_reason       TEXT        CHECK (change_reason IS NULL OR length(change_reason) <= 2000),
  author_id           UUID,
  author_name         TEXT        CHECK (author_name IS NULL OR length(author_name) <= 200),
  author_kind         TEXT        NOT NULL DEFAULT 'expert'
                      CHECK (author_kind IN ('owner', 'expert', 'admin', 'system')),
  submitted_at        TIMESTAMPTZ,
  approved_by         UUID,
  approved_at         TIMESTAMPTZ,
  approval_exception  TEXT        CHECK (approval_exception IS NULL OR length(approval_exception) <= 2000),
  rejected_by         UUID,
  rejected_at         TIMESTAMPTZ,
  rejected_reason     TEXT        CHECK (rejected_reason IS NULL OR length(rejected_reason) <= 2000),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pb_plan_versions_number_uniq UNIQUE (plan_id, version)
);

-- One open (draft / in_review) version per plan.
CREATE UNIQUE INDEX IF NOT EXISTS pb_plan_versions_one_open_uidx
  ON public.pb_plan_versions (plan_id)
  WHERE status IN ('draft', 'in_review');
-- The admin queue «ждут одобрения».
CREATE INDEX IF NOT EXISTS pb_plan_versions_review_idx
  ON public.pb_plan_versions (submitted_at)
  WHERE status = 'in_review';
CREATE INDEX IF NOT EXISTS pb_plan_versions_plan_idx
  ON public.pb_plan_versions (plan_id, version DESC);

-- An approved version is immutable: the only allowed change is approved → superseded
-- (nothing else on the row may change). A superseded version is frozen as well.
CREATE OR REPLACE FUNCTION public.pb_plan_versions_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    IF NEW.status = 'superseded' AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'pb_plan_versions: an approved version is immutable (only approved -> superseded is allowed)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'pb_plan_versions: a superseded version is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pb_plan_versions_immutable ON public.pb_plan_versions;
CREATE TRIGGER pb_plan_versions_immutable
  BEFORE UPDATE ON public.pb_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.pb_plan_versions_immutable();

-- ─── 3. Goal reviews ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pb_goal_reviews (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric_key                TEXT        NOT NULL CHECK (length(metric_key) BETWEEN 1 AND 200),
  period_label              TEXT        NOT NULL CHECK (length(period_label) BETWEEN 1 AND 50),
  status                    TEXT        NOT NULL
                            CHECK (status IN ('verified', 'corrected', 'agreed', 'disputed')),
  proposed_value            NUMERIC(20,4),
  proposed_deadline         DATE,
  previous_value            NUMERIC(20,4),
  reason                    TEXT        CHECK (reason IS NULL OR length(reason) <= 2000),
  reviewer_id               UUID,
  reviewer_name             TEXT        CHECK (reviewer_name IS NULL OR length(reviewer_name) <= 200),
  owner_agreed_at           TIMESTAMPTZ,
  applied_without_agreement BOOLEAN     NOT NULL DEFAULT false,
  reminded_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pb_goal_reviews_goal_idx
  ON public.pb_goal_reviews (company_id, metric_key, period_label, created_at DESC);
-- The reminder / «14 days» sweep reads only open proposals.
CREATE INDEX IF NOT EXISTS pb_goal_reviews_open_idx
  ON public.pb_goal_reviews (created_at)
  WHERE status = 'corrected';

-- ─── 4. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.pb_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pb_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pb_goal_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pb_plans, public.pb_plan_versions, public.pb_goal_reviews FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.pb_plans, public.pb_plan_versions, public.pb_goal_reviews FROM authenticated;
GRANT SELECT ON public.pb_plans, public.pb_plan_versions, public.pb_goal_reviews TO authenticated;
GRANT ALL ON public.pb_plans, public.pb_plan_versions, public.pb_goal_reviews TO service_role;

DROP POLICY IF EXISTS pb_plans_owner_read ON public.pb_plans;
CREATE POLICY pb_plans_owner_read ON public.pb_plans FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- The client sees ONLY approved versions of his own plan (never a draft or a version in review).
DROP POLICY IF EXISTS pb_plan_versions_owner_read ON public.pb_plan_versions;
CREATE POLICY pb_plan_versions_owner_read ON public.pb_plan_versions FOR SELECT TO authenticated
  USING (
    status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.pb_plans p
      WHERE p.id = pb_plan_versions.plan_id AND p.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS pb_goal_reviews_company_read ON public.pb_goal_reviews;
CREATE POLICY pb_goal_reviews_company_read ON public.pb_goal_reviews FOR SELECT TO authenticated
  USING (public.can_read_company(company_id));

-- ─── 5. Backfill from point_b_versions (idempotent) ─────────────────────────
-- A plan for every company with an approved legacy expert version…
INSERT INTO public.pb_plans (company_id, user_id)
SELECT l.company_id, l.user_id
FROM (
  SELECT DISTINCT ON (d.company_id) d.company_id::text AS company_id, d.user_id
  FROM public.point_b_versions v
  JOIN public.diagnostics d ON d.id = v.diagnostic_id
  WHERE v.is_approved AND d.company_id IS NOT NULL
  ORDER BY d.company_id, COALESCE(v.approved_at, v.created_at) DESC
) l
WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id::text = l.company_id)
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.user_id)
ON CONFLICT (company_id) DO NOTHING;

-- …and its version 1 (approved) from the latest approved note, unless the plan already has versions.
INSERT INTO public.pb_plan_versions
  (plan_id, version, status, goals, expert_notes, change_reason, author_id, author_name, author_kind,
   submitted_at, approved_by, approved_at, created_at)
SELECT p.id, 1, 'approved',
       (SELECT jsonb_build_object(
                 'primary', CASE WHEN EXISTS (
                     SELECT 1 FROM public.metric_targets r
                     WHERE r.company_id = p.company_id AND r.metric_key = 'biz.finansy.vyruchka_god' AND r.period_label = '12m')
                   THEN jsonb_build_object('metricKey', 'biz.finansy.vyruchka_god', 'periodLabel', '12m') ELSE NULL END,
                 'items', COALESCE(jsonb_agg(jsonb_build_object(
                     'metricKey', t.metric_key,
                     'periodLabel', t.period_label,
                     'label', t.label,
                     'baselineValue', t.baseline_value,
                     'baselinePeriod', t.baseline_period,
                     'targetValue', t.target_value,
                     'deadline', to_char(t.deadline, 'YYYY-MM-DD'),
                     'reviewStatus', 'owner_draft')), '[]'::jsonb))
        FROM public.metric_targets t WHERE t.company_id = p.company_id),
       lv.expert_notes,
       'Импортировано из прежней экспертной заметки',
       lv.authored_by, lv.author_name, 'expert',
       COALESCE(lv.approved_at, lv.created_at), lv.approved_by, COALESCE(lv.approved_at, lv.created_at), COALESCE(lv.created_at, now())
FROM public.pb_plans p
JOIN LATERAL (
  SELECT v.expert_notes, v.authored_by, v.author_name, v.approved_by, v.approved_at, v.created_at
  FROM public.point_b_versions v
  JOIN public.diagnostics d ON d.id = v.diagnostic_id
  WHERE v.is_approved AND d.company_id::text = p.company_id
  ORDER BY COALESCE(v.approved_at, v.created_at) DESC
  LIMIT 1
) lv ON true
WHERE NOT EXISTS (SELECT 1 FROM public.pb_plan_versions x WHERE x.plan_id = p.id)
ON CONFLICT (plan_id, version) DO NOTHING;

UPDATE public.pb_plans p
   SET published_version_id = v.id,
       current_version_id = COALESCE(p.current_version_id, v.id)
  FROM public.pb_plan_versions v
 WHERE v.plan_id = p.id AND v.version = 1 AND v.status = 'approved'
   AND p.published_version_id IS NULL;

NOTIFY pgrst, 'reload schema';
