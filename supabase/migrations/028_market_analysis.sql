-- =============================================================================
-- AIStart360 — Migration 028: Market Analysis (Анализ рынка, 50-question checklist)
--
-- Backs the «Анализ рынка» product (lib/market-analysis/*, app/api/v1/market-analysis/*):
--   * market_analysis_answers — one answer per (user_id, question_key) for the
--     50 «Гений GTM — Рынок» questions (blocks A..F). Answers are authored by AI
--     (source 'ai', status 'draft' — требует подтверждения) or by the user/expert
--     (status 'confirmed'/'disputed').
--   * market_snapshots — compact, derived market snapshot consumed by
--     components/point-a/v2/MarketAnalysisCard.tsx (latest row by computed_at).
--     History is kept (one row per rebuild); the card reads the newest.
--
-- RLS scoped to owner + staff roles, mirroring migrations 021 / 027.
-- market_snapshots added to supabase_realtime publication like 027. Idempotent.
--
-- Apply with:
--   node scripts/apply-migration.js supabase/migrations/028_market_analysis.sql
-- =============================================================================

-- 1. market_analysis_answers -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.market_analysis_answers (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Question key from lib/market-analysis/questions.ts, e.g. 'A1', 'C7', 'F5'.
  question_key  TEXT         NOT NULL,
  -- Owning block: 'A'..'F'.
  block         CHAR(1)      NOT NULL,

  answer_text   TEXT,

  -- Who authored this answer.
  source        TEXT         NOT NULL CHECK (source IN ('ai', 'user', 'expert')),
  -- Lifecycle: 'draft' (AI, требует подтверждения) → 'confirmed' / 'disputed'.
  status        TEXT         NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'confirmed', 'disputed')),

  -- AI self-reported confidence 0..1 (NULL for user/expert answers).
  confidence    NUMERIC,
  -- AI model id (NULL for user/expert answers).
  model         TEXT,

  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.market_analysis_answers IS
  'Per-question answers for the «Анализ рынка» 50-question checklist (blocks A..F). One row per (user_id, question_key).';
COMMENT ON COLUMN public.market_analysis_answers.question_key IS
  'Question key from lib/market-analysis/questions.ts, e.g. A1, C7, F5.';
COMMENT ON COLUMN public.market_analysis_answers.source IS
  'Author: ai | user | expert.';
COMMENT ON COLUMN public.market_analysis_answers.status IS
  'draft (AI, требует подтверждения) | confirmed | disputed.';

-- One answer per user per question (target of the route-handler upsert).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'market_analysis_answers_user_question_uniq'
  ) THEN
    ALTER TABLE public.market_analysis_answers
      ADD CONSTRAINT market_analysis_answers_user_question_uniq
      UNIQUE (user_id, question_key);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS market_analysis_answers_user_block_idx
  ON public.market_analysis_answers(user_id, block);

-- updated_at trigger (reuse public.set_updated_at() from migration 001).
DROP TRIGGER IF EXISTS market_analysis_answers_updated_at ON public.market_analysis_answers;
CREATE TRIGGER market_analysis_answers_updated_at
  BEFORE UPDATE ON public.market_analysis_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. market_snapshots --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.market_snapshots (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  niche        TEXT,

  -- Compact card-shaped snapshot consumed by MarketAnalysisCard.tsx:
  -- { tam:{value,caption}, sam:{value,delta}, som:{value,caption},
  --   trendWindow:{open,caption}, mainTrend, competitorWeakness, microSegment }.
  -- Partial data is fine (missing keys render as '—').
  data         JSONB        NOT NULL,

  computed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.market_snapshots IS
  'Derived market snapshots (TAM/SAM/SOM + trend/competitor/segment) for the Point A MarketAnalysisCard. History kept; card reads latest by computed_at.';
COMMENT ON COLUMN public.market_snapshots.data IS
  'Card-shaped JSONB. Partial data allowed — missing keys render as em-dash.';

CREATE INDEX IF NOT EXISTS market_snapshots_user_computed_idx
  ON public.market_snapshots(user_id, computed_at DESC);

-- 3. RLS ---------------------------------------------------------------------
ALTER TABLE public.market_analysis_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_snapshots        ENABLE ROW LEVEL SECURITY;

-- market_analysis_answers: owner all + staff select ------------------------
DROP POLICY IF EXISTS market_answers_all_own      ON public.market_analysis_answers;
DROP POLICY IF EXISTS market_answers_select_admin ON public.market_analysis_answers;

-- Owner can do everything on own rows
CREATE POLICY market_answers_all_own ON public.market_analysis_answers
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Staff (super_admin/admin/manager/analyst) can read all rows
CREATE POLICY market_answers_select_admin ON public.market_analysis_answers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );

-- market_snapshots: owner all + staff select -------------------------------
DROP POLICY IF EXISTS market_snapshots_all_own      ON public.market_snapshots;
DROP POLICY IF EXISTS market_snapshots_select_admin ON public.market_snapshots;

-- Owner can do everything on own rows
CREATE POLICY market_snapshots_all_own ON public.market_snapshots
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Staff can read all rows
CREATE POLICY market_snapshots_select_admin ON public.market_snapshots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );

-- 4. Realtime (market_snapshots, like 027) -----------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'market_snapshots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_snapshots;
  END IF;
END
$$;

ALTER TABLE public.market_snapshots REPLICA IDENTITY FULL;

-- 5. PostgREST schema cache reload ------------------------------------------
NOTIFY pgrst, 'reload schema';
