-- 141_ai_messages_client_insert_user_only.sql
--
-- R-228 (P4). ai_messages_owner_all (053) is FOR ALL: the owner of a
-- conversation could INSERT rows with role = 'assistant' (forged «AI said …»
-- history that is fed back to the model and shown in the UI) and UPDATE any
-- message, including the assistant's. ai_messages.role is CHECK
-- ('user', 'assistant').
--
-- After: the owner may SELECT and DELETE messages of their conversations and
-- INSERT only role = 'user'; no UPDATE through the API roles. Assistant rows
-- are written by the server with the service role. The RESTRICTIVE survey
-- policies of 136 are untouched.
--
-- Ship order (done): both routes that saved a chat turn with the USER's
-- session now write it with the service role through lib/chat/turn-store.ts
-- (saveChatTurn re-checks that the conversation is the caller's):
--   app/api/v1/ai/assistant/route.ts, app/api/v1/ai/chat/route.ts.
-- The survey chat (lib/survey/chat/store.ts) always wrote with the service role.
-- Test: tests/integration/db/staff-rls-scope.test.ts («R-228»), which re-applies
-- this file (idempotent) inside a rolled-back transaction.
--
-- Idempotent. Rollback: restore the 053/138 policy:
--   DROP POLICY IF EXISTS ai_messages_owner_select ON public.ai_messages;
--   DROP POLICY IF EXISTS ai_messages_owner_insert_user ON public.ai_messages;
--   DROP POLICY IF EXISTS ai_messages_owner_delete ON public.ai_messages;
--   CREATE POLICY ai_messages_owner_all ON public.ai_messages FOR ALL TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = ai_messages.conversation_id AND c.user_id = (SELECT auth.uid())))
--     WITH CHECK (EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = ai_messages.conversation_id AND c.user_id = (SELECT auth.uid())));

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS ai_messages_owner_all ON public.ai_messages;
DROP POLICY IF EXISTS ai_messages_owner_select ON public.ai_messages;
DROP POLICY IF EXISTS ai_messages_owner_insert_user ON public.ai_messages;
DROP POLICY IF EXISTS ai_messages_owner_delete ON public.ai_messages;

CREATE POLICY ai_messages_owner_select ON public.ai_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_conversations c
                  WHERE c.id = ai_messages.conversation_id AND c.user_id = (SELECT auth.uid())));

CREATE POLICY ai_messages_owner_insert_user ON public.ai_messages FOR INSERT TO authenticated
  WITH CHECK (role = 'user'
              AND EXISTS (SELECT 1 FROM public.ai_conversations c
                           WHERE c.id = ai_messages.conversation_id AND c.user_id = (SELECT auth.uid())));

CREATE POLICY ai_messages_owner_delete ON public.ai_messages FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_conversations c
                  WHERE c.id = ai_messages.conversation_id AND c.user_id = (SELECT auth.uid())));
