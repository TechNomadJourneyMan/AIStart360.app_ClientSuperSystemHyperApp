-- ============================================================================
-- 060: Human-in-the-loop moderation gate for client-facing AI insights (R2)
--
-- Product rule (ТЗ §4.7): AI-generated insights are NOT sent to the user
-- automatically — they first land in the admin panel for review, and appear
-- in the client feed only after an expert publishes them.
--
-- Mechanism: point_a_insights.visible_to_user.
--   - DEFAULT TRUE → every existing row and every non-AI path (client asks a
--     question, expert writes an insight) behaves exactly as before.
--   - The AI generator inserts rows with visible_to_user = FALSE when the
--     insight_moderation system toggle is on (default ON, fail-safe reader).
--   - Publishing (giga panel) flips it to TRUE and stamps published_at/by.
--   - Owner RLS policies are tightened so a client can neither read nor
--     confirm/delete a row that has not been published yet.
--
-- Idempotent — safe to re-run.
-- ============================================================================

ALTER TABLE public.point_a_insights
  ADD COLUMN IF NOT EXISTS visible_to_user BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.point_a_insights
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Actor identifier (profiles UUID or 'giga:super_admin') — TEXT, not a FK,
-- consistent with audit_logs.performedBy (migration 059).
ALTER TABLE public.point_a_insights
  ADD COLUMN IF NOT EXISTS published_by TEXT;

COMMENT ON COLUMN public.point_a_insights.visible_to_user IS
  'Moderation gate: FALSE = awaiting admin/expert review, hidden from the owner; TRUE = published to the client feed. Non-AI rows default to TRUE.';

-- Moderation queue: small, hot partial index.
CREATE INDEX IF NOT EXISTS point_a_insights_moderation_idx
  ON public.point_a_insights (created_at DESC)
  WHERE visible_to_user = FALSE;

-- ── RLS: owners only ever see/touch PUBLISHED rows ──────────────────────────
DROP POLICY IF EXISTS point_a_insights_select_own ON public.point_a_insights;
CREATE POLICY point_a_insights_select_own ON public.point_a_insights
  FOR SELECT USING (user_id = auth.uid() AND visible_to_user = TRUE);

DROP POLICY IF EXISTS point_a_insights_update_own ON public.point_a_insights;
CREATE POLICY point_a_insights_update_own ON public.point_a_insights
  FOR UPDATE USING (user_id = auth.uid() AND visible_to_user = TRUE)
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS point_a_insights_delete_own ON public.point_a_insights;
CREATE POLICY point_a_insights_delete_own ON public.point_a_insights
  FOR DELETE USING (user_id = auth.uid() AND visible_to_user = TRUE);

-- (select_admin / insert_* / update_admin policies from 024 stay unchanged:
--  staff and the service role continue to see and manage the full queue.)

NOTIFY pgrst, 'reload schema';
