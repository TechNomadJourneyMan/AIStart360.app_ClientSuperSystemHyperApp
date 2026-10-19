-- 128_point_b_action_items_link.sql
--
-- Point B, phase 5 (strategy and roadmap; docs/superpowers/plans/2026-10-19-point-b-phase5-strategy-roadmap.md,
-- task 1): the tasks of a published plan version are written into the EXISTING public.action_items
-- (the client's action plan) with source = 'point_b'. This migration only adds the link:
--
--   pb_task_key    the key of the task node in pb_plan_versions.strategy (stable between versions);
--                  8..64 characters. A task is identified by (user_id, pb_task_key), so publishing a
--                  version twice, or two publications at once, never duplicates a task.
--   pb_version_id  the plan version that wrote / last updated the row (informational, no foreign key:
--                  the row must outlive any change of the plan).
--
-- RLS, policies, grants and triggers of action_items are NOT touched (the client still changes the
-- status of his own task through the existing action-plan routes). `source` already exists
-- (migration 057, default 'plan'); the code writes 'point_b'.
--
-- Idempotent. NOT applied to production by the author of this file: apply with
-- node scripts/apply-migration.js supabase/migrations/128_point_b_action_items_link.sql
-- only at the push to main (the product owner's go-ahead is given).

ALTER TABLE public.action_items
  ADD COLUMN IF NOT EXISTS pb_task_key   TEXT CHECK (pb_task_key IS NULL OR length(pb_task_key) BETWEEN 8 AND 64),
  ADD COLUMN IF NOT EXISTS pb_version_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS action_items_pb_task_uidx
  ON public.action_items (user_id, pb_task_key)
  WHERE pb_task_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';
