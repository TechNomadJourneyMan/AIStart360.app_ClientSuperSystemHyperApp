-- 117_point_a_expert.sql
--
-- The expert's work on a company's Point A
-- (docs/superpowers/specs/2026-10-12-point-a-full-design.md §7):
--   point_a_comments             an expert's note on the whole Point A, a block
--                                or a metric; the client sees it signed.
--   point_a_hypothesis_reviews   the expert's decision on an AI hypothesis of a
--                                block without data: confirmed → the block is
--                                scored by it (INFERRED, marked «подтверждено
--                                экспертом»), rejected → no hypothesis. Valid
--                                while the block's inputs stay the same
--                                (inputs_hash); one row per company + block.
--   point_a_snapshots.reviewed_by_name   who marked the snapshot «проверено
--                                экспертом» (reviewed_by / reviewed_at: 111).
--
-- Read: whoever reads the company (can_read_company). Writes: server only
-- (GIGA-CRM routes, service role) — the identity comes from the session.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/117_point_a_expert.sql

CREATE TABLE IF NOT EXISTS public.point_a_comments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  target_kind  TEXT        NOT NULL CHECK (target_kind IN ('overall', 'block', 'metric')),
  target_key   TEXT,
  body         TEXT        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  author_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name  TEXT,
  author_role  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT point_a_comments_target CHECK ((target_kind = 'overall') = (target_key IS NULL))
);
CREATE INDEX IF NOT EXISTS point_a_comments_company_idx ON public.point_a_comments (company_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.point_a_hypothesis_reviews (
  company_id       TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  block_key        TEXT        NOT NULL,
  inputs_hash      TEXT        NOT NULL,
  decision         TEXT        NOT NULL CHECK (decision IN ('confirmed', 'rejected')),
  score            INT         CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  rationale        TEXT,
  decided_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by_name  TEXT,
  decided_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, block_key),
  CONSTRAINT point_a_hypothesis_reviews_score CHECK (decision <> 'confirmed' OR score IS NOT NULL)
);

ALTER TABLE public.point_a_snapshots ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT;
CREATE INDEX IF NOT EXISTS point_a_snapshots_reviewed_idx ON public.point_a_snapshots (company_id, reviewed_at DESC) WHERE reviewed_at IS NOT NULL;

ALTER TABLE public.point_a_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_a_hypothesis_reviews ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.point_a_comments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.point_a_hypothesis_reviews FROM anon, authenticated;

DROP POLICY IF EXISTS point_a_comments_read ON public.point_a_comments;
CREATE POLICY point_a_comments_read ON public.point_a_comments FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.can_read_company(company_id));

DROP POLICY IF EXISTS point_a_hypothesis_reviews_read ON public.point_a_hypothesis_reviews;
CREATE POLICY point_a_hypothesis_reviews_read ON public.point_a_hypothesis_reviews FOR SELECT TO authenticated
  USING (public.can_read_company(company_id));

-- Block templates (pa_templates, 111): admins edit them from GIGA-CRM through
-- the service role; every signed-in user already reads them (111).

NOTIFY pgrst, 'reload schema';
