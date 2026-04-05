-- Add AI analysis columns to diagnostics table
-- ai_analysis stores the structured output from Claude (executive summary, block analyses, roadmap, etc.)
-- ai_status tracks the async processing state

ALTER TABLE public.diagnostics
  ADD COLUMN IF NOT EXISTS ai_analysis  JSONB   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ai_status    TEXT    DEFAULT 'none'
    CHECK (ai_status IN ('none', 'processing', 'completed', 'failed'));
