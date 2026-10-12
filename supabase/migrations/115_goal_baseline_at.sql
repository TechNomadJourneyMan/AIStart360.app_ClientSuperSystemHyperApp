-- 115_goal_baseline_at.sql
--
-- When the baseline of a goal was taken (lib/goals — review of phase 3): a
-- goal changed later starts a new horizon («через 12 месяцев» from the
-- change, not from the first version), and its progress is measured from the
-- value at that moment.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/115_goal_baseline_at.sql

ALTER TABLE public.metric_targets ADD COLUMN IF NOT EXISTS baseline_at TIMESTAMPTZ;
UPDATE public.metric_targets SET baseline_at = created_at WHERE baseline_at IS NULL;

NOTIFY pgrst, 'reload schema';
