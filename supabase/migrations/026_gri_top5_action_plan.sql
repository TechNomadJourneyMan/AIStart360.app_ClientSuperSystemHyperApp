-- =============================================================================
-- AIStart360 — Migration 026: GRI TOP-5 limitations + 90-day Action Plan
-- Adds derived-insight columns to public.gri_assessments. These are computed
-- server-side in app/api/v1/gri/assessment/route.ts and persisted best-effort.
-- Idempotent: safe to re-run.
-- =============================================================================

ALTER TABLE public.gri_assessments
  ADD COLUMN IF NOT EXISTS top_5_limits JSONB NOT NULL DEFAULT '[]'::jsonb;
-- top_5_limits shape: [{ criterionId, criterionText, blockId, blockName, score }]

ALTER TABLE public.gri_assessments
  ADD COLUMN IF NOT EXISTS action_plan_90d JSONB NOT NULL DEFAULT '{}'::jsonb;
-- action_plan_90d shape: { days_1_30: [...], days_31_60: [...], days_61_90: [...] }
