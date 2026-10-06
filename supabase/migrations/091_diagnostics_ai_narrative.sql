-- 091_diagnostics_ai_narrative.sql
--
-- diagnostics.ai_analysis had two writers with different shapes:
--   • POST /api/v1/diagnostics/ai-analyze  → AIAnalysis {executive_summary, blocks,
--     strategic_priorities, growth_roadmap, industry_context, …} (read by the
--     client Point A page, PDF export, share links, expert tabs);
--   • POST /api/v1/point-a/narrative       → PointANarrative {executive_summary,
--     strengths_text, weaknesses_text, risks_text, opportunities_text, next_steps},
--     which also reused ai_status as its own cache flag.
-- Whichever ran last overwrote the other, so readers got the wrong shape.
--
-- The narrative now has its own column. ai_analysis keeps only the analysis
-- (its writer merges and keeps keys it does not own); ai_status belongs to the
-- analysis alone.
--
-- One-time move: rows whose ai_analysis holds a narrative (has strengths_text,
-- no blocks) get it moved to ai_narrative; the analysis it replaced is gone,
-- so a 'completed' status becomes 'none' (the page offers to run it again).
--
-- Written by the service role only (no UPDATE policy on diagnostics for API roles).
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/091_diagnostics_ai_narrative.sql

ALTER TABLE public.diagnostics ADD COLUMN IF NOT EXISTS ai_narrative JSONB;

COMMENT ON COLUMN public.diagnostics.ai_narrative IS
  'Executive narrative of POST /api/v1/point-a/narrative (PointANarrative). Separate from ai_analysis (AIAnalysis of ai-analyze) since 091.';
COMMENT ON COLUMN public.diagnostics.ai_analysis IS
  'AIAnalysis of POST /api/v1/diagnostics/ai-analyze (+ keys other writers own, preserved on rewrite). Status: ai_status.';

UPDATE public.diagnostics
SET ai_narrative = ai_analysis,
    ai_analysis  = NULL,
    ai_status    = CASE WHEN ai_status = 'completed' THEN 'none' ELSE ai_status END
WHERE ai_narrative IS NULL
  AND jsonb_typeof(ai_analysis) = 'object'
  AND ai_analysis ? 'strengths_text'
  AND NOT (ai_analysis ? 'blocks');

NOTIFY pgrst, 'reload schema';
