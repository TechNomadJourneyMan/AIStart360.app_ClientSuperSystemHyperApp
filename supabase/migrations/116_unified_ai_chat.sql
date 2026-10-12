-- 116_unified_ai_chat.sql
--
-- One AI chat for Point A, GRI, Point B and the dashboard
-- (docs/superpowers/specs/2026-10-12-point-a-full-design.md §6):
--   ai_conversations.surface  + 'gri', 'global'
--   ai_conversations.company_key  the company (companies.id is TEXT; the old
--                                 company_id column is uuid and stays unused)
--   ai_pending_actions        a change the AI proposed (a metric value, a
--                             discrepancy decision, a goal): applied only when
--                             the user presses «Применить» (re-authorised
--                             then); expires in 24 h.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/116_unified_ai_chat.sql

ALTER TABLE public.ai_conversations DROP CONSTRAINT IF EXISTS ai_conversations_surface_check;
ALTER TABLE public.ai_conversations ADD CONSTRAINT ai_conversations_surface_check
  CHECK (surface IN ('report', 'dashboard', 'point_a', 'point_b', 'simulator', 'intake', 'gri', 'global'));
ALTER TABLE public.ai_conversations ADD COLUMN IF NOT EXISTS company_key TEXT;
CREATE INDEX IF NOT EXISTS idx_ai_conversations_company_key ON public.ai_conversations (user_id, company_key, surface, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_pending_actions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id       TEXT        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id  UUID        REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  kind             TEXT        NOT NULL CHECK (kind IN ('set_value', 'resolve_discrepancy', 'set_goal')),
  payload          JSONB       NOT NULL,
  preview          JSONB       NOT NULL,            -- {title, before, after, note}
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'expired', 'failed')),
  result           JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  decided_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ai_pending_actions_user_idx ON public.ai_pending_actions (user_id, status, created_at DESC);

ALTER TABLE public.ai_pending_actions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ai_pending_actions FROM anon, authenticated;
DROP POLICY IF EXISTS ai_pending_actions_own ON public.ai_pending_actions;
CREATE POLICY ai_pending_actions_own ON public.ai_pending_actions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
