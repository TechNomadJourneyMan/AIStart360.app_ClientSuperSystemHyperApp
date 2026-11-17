-- 141_ai_messages_client_insert_user_only.down.sql — ROLLBACK of migration 141 (R4-A4).
--
-- NOT part of the migration sequence (appliers read only supabase/migrations/*.sql).
-- Restores the owner policy of ai_messages as it was after 053 / 096 (FOR ALL, the initplan form
-- (SELECT auth.uid()) of 096 §7b) and drops the three policies 141 created. Re-opens R-228: the
-- owner of a conversation may again INSERT role = 'assistant' rows and UPDATE any message of it
-- through PostgREST — use only if 141 breaks a legitimate screen and a forward fix is not possible
-- in time.
-- The app does not depend on it: chat turns are written with the service role (lib/chat/turn-store.ts),
-- which no policy here limits. The RESTRICTIVE survey policies of 136 / 138 are untouched.
-- No data is changed. Idempotent: a second run gives the same policies.
-- The journal public.schema_migrations is NOT touched here — whoever rolls back records it
-- (docs/deploy/runbook.md §10).
--   psql "$TGT_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/141_ai_messages_client_insert_user_only.down.sql

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS ai_messages_owner_select ON public.ai_messages;
DROP POLICY IF EXISTS ai_messages_owner_insert_user ON public.ai_messages;
DROP POLICY IF EXISTS ai_messages_owner_delete ON public.ai_messages;
DROP POLICY IF EXISTS ai_messages_owner_all ON public.ai_messages;

CREATE POLICY ai_messages_owner_all ON public.ai_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_conversations c
                  WHERE c.id = ai_messages.conversation_id AND c.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_conversations c
                       WHERE c.id = ai_messages.conversation_id AND c.user_id = (SELECT auth.uid())));
