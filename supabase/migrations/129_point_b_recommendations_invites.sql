-- 129_point_b_recommendations_invites.sql
--
-- Point B, phase 6a (recommendations with expert verification, rules, invites;
-- docs/superpowers/specs/2026-10-18-point-b-design.md §12, §12.1, §12.2;
-- plan docs/superpowers/plans/2026-10-19-point-b-phase6a-recommendations-invites.md, task 1):
--
--   pb_recommendations  recommendations of a company's plan. Rules and the AI write them as
--                       pending_review (the expert's queue); ONLY an expert action makes one
--                       expert_verified (reviewer name / specialty / date / scope / comment are
--                       written by that action) or expert_rejected. A recommendation changed by an
--                       expert after review is a NEW row (rec_version + 1, supersedes_id = the old
--                       one, pending_review again); the old row becomes stale. stale is also what a
--                       recommendation turns into when the inputs of the model change (inputs_hash).
--                       There is no ai_generated status in the table: an AI draft is stored directly
--                       as pending_review with generated_by = 'ai'.
--   pb_invites          personal invites of a client (rules of §12.1): cards on the page, the bell,
--                       the cabinet pop-up layer (kind insight / recommendation, display card / modal).
--                       ONE active invite per (user, dedupe_key) — the partial unique index —, so the
--                       same rule about the same subject never repeats while the previous one is
--                       new / seen / snoozed. delivered records the channels it went to.
--
-- reviewer_id carries NO foreign key on purpose (like pb_plan_versions.author_id in 125): the
-- deletion of a staff account must not touch the history of verified recommendations.
--
-- RLS: both tables are written by the server only (service role). A signed-in client may SELECT
-- the EXPERT-VERIFIED recommendations of the companies he may read (never pending / rejected /
-- stale texts) and his own invites. No INSERT / UPDATE grants to authenticated or anon.
--
-- Idempotent. NOT applied to production by the author of this file: apply with
-- node scripts/apply-migration.js supabase/migrations/129_point_b_recommendations_invites.sql
-- only at the push to main (the product owner's go-ahead is given).

-- ─── 1. Recommendations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pb_recommendations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  version_id          UUID        REFERENCES public.pb_plan_versions(id) ON DELETE SET NULL,
  kind                TEXT        NOT NULL
                      CHECK (kind IN ('lever', 'risk', 'action', 'contradiction', 'constraint')),
  title               TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  essence             TEXT        NOT NULL DEFAULT '' CHECK (length(essence) <= 2000),
  reason              TEXT        NOT NULL DEFAULT '' CHECK (length(reason) <= 2000),
  expected_effect     TEXT        CHECK (expected_effect IS NULL OR length(expected_effect) <= 2000),
  resources           TEXT        CHECK (resources IS NULL OR length(resources) <= 2000),
  confidence          TEXT        NOT NULL DEFAULT 'medium'
                      CHECK (confidence IN ('low', 'medium', 'high')),
  confidence_reason   TEXT        CHECK (confidence_reason IS NULL OR length(confidence_reason) <= 2000),
  risks               TEXT        CHECK (risks IS NULL OR length(risks) <= 2000),
  next_action         TEXT        CHECK (next_action IS NULL OR length(next_action) <= 2000),
  source_refs         JSONB       NOT NULL DEFAULT '[]'::jsonb
                      CHECK (jsonb_typeof(source_refs) = 'array' AND pg_column_size(source_refs) <= 16384),
  status              TEXT        NOT NULL DEFAULT 'pending_review'
                      CHECK (status IN ('pending_review', 'expert_verified', 'expert_rejected', 'stale')),
  generated_by        TEXT        NOT NULL
                      CHECK (generated_by IN ('rule', 'ai', 'expert')),
  inputs_hash         TEXT        CHECK (inputs_hash IS NULL OR length(inputs_hash) <= 128),
  rec_version         INT         NOT NULL DEFAULT 1 CHECK (rec_version >= 1),
  supersedes_id       UUID        REFERENCES public.pb_recommendations(id) ON DELETE SET NULL,
  reviewer_id         UUID,
  reviewer_name       TEXT        CHECK (reviewer_name IS NULL OR length(reviewer_name) <= 200),
  reviewer_specialty  TEXT        CHECK (reviewer_specialty IS NULL OR length(reviewer_specialty) <= 200),
  reviewed_at         TIMESTAMPTZ,
  scope_note          TEXT        CHECK (scope_note IS NULL OR length(scope_note) <= 2000),
  review_comment      TEXT        CHECK (review_comment IS NULL OR length(review_comment) <= 2000),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The page of a company (verified / pending count) and the expert's list.
CREATE INDEX IF NOT EXISTS pb_recommendations_company_idx
  ON public.pb_recommendations (company_id, status, created_at DESC);
-- The review queue «рекомендации на проверке».
CREATE INDEX IF NOT EXISTS pb_recommendations_pending_idx
  ON public.pb_recommendations (created_at)
  WHERE status = 'pending_review';

DROP TRIGGER IF EXISTS pb_recommendations_updated_at ON public.pb_recommendations;
CREATE TRIGGER pb_recommendations_updated_at
  BEFORE UPDATE ON public.pb_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 2. Invites ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pb_invites (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_key        TEXT        NOT NULL CHECK (length(rule_key) BETWEEN 1 AND 64),
  dedupe_key      TEXT        NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  kind            TEXT        NOT NULL DEFAULT 'insight'
                  CHECK (kind IN ('insight', 'recommendation')),
  title           TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body            TEXT        NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  href            TEXT        CHECK (href IS NULL OR length(href) <= 300),
  why             TEXT        NOT NULL DEFAULT '' CHECK (length(why) <= 600),
  source_refs     JSONB       NOT NULL DEFAULT '[]'::jsonb
                  CHECK (jsonb_typeof(source_refs) = 'array' AND pg_column_size(source_refs) <= 16384),
  priority        SMALLINT    NOT NULL DEFAULT 5,
  display         TEXT        NOT NULL DEFAULT 'card'
                  CHECK (display IN ('card', 'modal')),
  status          TEXT        NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'seen', 'dismissed', 'snoozed', 'acted', 'expired')),
  snoozed_until   TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  delivered       JSONB       NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(delivered) = 'object'),
  source_rec_id   UUID        REFERENCES public.pb_recommendations(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active invite per rule and subject.
CREATE UNIQUE INDEX IF NOT EXISTS pb_invites_active_dedupe_uidx
  ON public.pb_invites (user_id, dedupe_key)
  WHERE status IN ('new', 'seen', 'snoozed');
-- The cards of a user, the caps, the «dismissed recently» check.
CREATE INDEX IF NOT EXISTS pb_invites_user_idx
  ON public.pb_invites (user_id, status, created_at DESC);

DROP TRIGGER IF EXISTS pb_invites_updated_at ON public.pb_invites;
CREATE TRIGGER pb_invites_updated_at
  BEFORE UPDATE ON public.pb_invites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.pb_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pb_invites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pb_recommendations, public.pb_invites FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.pb_recommendations, public.pb_invites FROM authenticated;
GRANT SELECT ON public.pb_recommendations, public.pb_invites TO authenticated;
GRANT ALL ON public.pb_recommendations, public.pb_invites TO service_role;

-- The client reads ONLY expert-verified recommendations (never pending, rejected or stale texts).
DROP POLICY IF EXISTS pb_recommendations_client_read ON public.pb_recommendations;
CREATE POLICY pb_recommendations_client_read ON public.pb_recommendations FOR SELECT TO authenticated
  USING (status = 'expert_verified' AND public.can_read_company(company_id));

DROP POLICY IF EXISTS pb_invites_owner_read ON public.pb_invites;
CREATE POLICY pb_invites_owner_read ON public.pb_invites FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';
