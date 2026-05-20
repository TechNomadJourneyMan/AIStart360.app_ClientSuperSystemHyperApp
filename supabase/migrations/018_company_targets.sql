-- =============================================================================
-- AIStart360 — Migration 018: Company revenue targets for Top Sales Table
--
-- Adds explicit numeric revenue-target columns to public.companies so the
-- Point A "top table" (План 2026 / % выполнения от плана на 3 года / etc.)
-- can render even when the survey free-text goals (s6_goal_12months /
-- s6_goal_3years) haven't been numerically parsed yet.
--
-- All units are ₸ (KZT). The Point A goal-parser (lib/point-a/v3/parse-goals.ts)
-- writes here whenever it extracts a confident numeric target.
-- Additive + idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS target_revenue_12m_kzt NUMERIC(18,2);

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS target_revenue_3y_kzt  NUMERIC(18,2);

COMMENT ON COLUMN public.companies.target_revenue_12m_kzt
  IS 'Owner-declared 12-month revenue target in ₸ (KZT). Sourced from survey s6_goal_12months via lib/point-a/v3/parse-goals.ts or manual entry.';

COMMENT ON COLUMN public.companies.target_revenue_3y_kzt
  IS 'Owner-declared 3-year revenue target in ₸ (KZT). Sourced from survey s6_goal_3years via lib/point-a/v3/parse-goals.ts or manual entry.';

-- Optional helper index for admin/portfolio analytics (no UI uses it today,
-- but PortfolioGri may aggregate plan-vs-fact across multiple companies).
CREATE INDEX IF NOT EXISTS companies_target_revenue_12m_idx
  ON public.companies(target_revenue_12m_kzt)
  WHERE target_revenue_12m_kzt IS NOT NULL;
