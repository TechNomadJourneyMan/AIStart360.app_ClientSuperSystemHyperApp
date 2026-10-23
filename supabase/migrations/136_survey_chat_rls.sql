-- 136_survey_chat_rls.sql
--
-- The questionnaire AI helper (spec docs/superpowers/specs/2026-10-23-survey-
-- three-modes-design.md §8.8; plan docs/superpowers/plans/2026-10-23-survey-
-- modes-phase4.md, task 3). 134 already allows ai_conversations.surface
-- 'survey' and ai_pending_actions.kind 'set_survey_answer'. This migration:
--
--   1. ai_pending_actions.company_id may be NULL: a new client can talk to the
--      questionnaire helper before a company exists. A «Записать» card belongs
--      to the user (user_id), never to a company; the other kinds keep writing
--      their company (the code always sets it for them).
--   2. The transcript is the expert's evidence of what the client said: the
--      client's own JWT may READ its survey conversations (053 owner policy,
--      unchanged) but may not insert, edit or delete them or their messages —
--      only the server (service role) writes them. RESTRICTIVE policies, so the
--      owner-only «for all» policies of 053 keep working for every other
--      surface (report, dashboard, point_a, …).
--   3. Another client never reads a survey conversation: 053's owner policies
--      (user_id = auth.uid()) already guarantee it; restated here as a
--      restrictive SELECT policy so a future permissive policy cannot widen it.
--
-- Idempotent (DROP POLICY IF EXISTS + CREATE; DROP NOT NULL is a no-op when
-- already nullable). Additive: no data is changed. Number 135 is reserved for
-- phase Ф2. Apply (on push to main, PO rule):
--   node scripts/apply-migration.js supabase/migrations/136_survey_chat_rls.sql

-- ─── 1. cards without a company ────────────────────────────────────────────
ALTER TABLE public.ai_pending_actions ALTER COLUMN company_id DROP NOT NULL;
COMMENT ON COLUMN public.ai_pending_actions.company_id IS 'The company the action changes; NULL only for set_survey_answer (the questionnaire belongs to the user).';

-- ─── 2. survey conversations: written by the server only ──────────────────
DROP POLICY IF EXISTS ai_conversations_survey_no_client_insert ON public.ai_conversations;
CREATE POLICY ai_conversations_survey_no_client_insert ON public.ai_conversations
  AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (surface <> 'survey');

DROP POLICY IF EXISTS ai_conversations_survey_no_client_update ON public.ai_conversations;
CREATE POLICY ai_conversations_survey_no_client_update ON public.ai_conversations
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (surface <> 'survey')
  WITH CHECK (surface <> 'survey');

DROP POLICY IF EXISTS ai_conversations_survey_no_client_delete ON public.ai_conversations;
CREATE POLICY ai_conversations_survey_no_client_delete ON public.ai_conversations
  AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (surface <> 'survey');

DROP POLICY IF EXISTS ai_messages_survey_no_client_insert ON public.ai_messages;
CREATE POLICY ai_messages_survey_no_client_insert ON public.ai_messages
  AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (NOT EXISTS (
    SELECT 1 FROM public.ai_conversations c
     WHERE c.id = conversation_id AND c.surface = 'survey'
  ));

DROP POLICY IF EXISTS ai_messages_survey_no_client_update ON public.ai_messages;
CREATE POLICY ai_messages_survey_no_client_update ON public.ai_messages
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (NOT EXISTS (
    SELECT 1 FROM public.ai_conversations c
     WHERE c.id = conversation_id AND c.surface = 'survey'
  ))
  WITH CHECK (NOT EXISTS (
    SELECT 1 FROM public.ai_conversations c
     WHERE c.id = conversation_id AND c.surface = 'survey'
  ));

DROP POLICY IF EXISTS ai_messages_survey_no_client_delete ON public.ai_messages;
CREATE POLICY ai_messages_survey_no_client_delete ON public.ai_messages
  AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (NOT EXISTS (
    SELECT 1 FROM public.ai_conversations c
     WHERE c.id = conversation_id AND c.surface = 'survey'
  ));

-- ─── 3. reading: only one's own survey conversation ───────────────────────
DROP POLICY IF EXISTS ai_conversations_survey_owner_read ON public.ai_conversations;
CREATE POLICY ai_conversations_survey_owner_read ON public.ai_conversations
  AS RESTRICTIVE FOR SELECT TO authenticated, anon
  USING (surface <> 'survey' OR user_id = auth.uid());

DROP POLICY IF EXISTS ai_messages_survey_owner_read ON public.ai_messages;
CREATE POLICY ai_messages_survey_owner_read ON public.ai_messages
  AS RESTRICTIVE FOR SELECT TO authenticated, anon
  USING (NOT EXISTS (
    SELECT 1 FROM public.ai_conversations c
     WHERE c.id = conversation_id AND c.surface = 'survey' AND c.user_id IS DISTINCT FROM auth.uid()
  ));

NOTIFY pgrst, 'reload schema';
