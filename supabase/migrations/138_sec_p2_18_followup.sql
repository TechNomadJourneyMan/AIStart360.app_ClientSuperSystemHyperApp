-- 138_sec_p2_18_followup.sql
--
-- SEC-P2-18 follow-up (096 §7). Objects created after 096, or merged in from a
-- branch 096 never saw, that slipped past its one-off sweep — caught by
-- tests/integration/db/tenant-write-guards.test.ts («no public function without
-- a pinned search_path, no per-row auth.uid() in policies»):
--
--   1. public.expert_review_touch_updated_at() (087_expert_review_drafts, the
--      updated_at trigger of expert_reviews / expert_templates) has no pinned
--      search_path. Pinned as in 096 §7a: search_path = public, pg_temp. The
--      body (NEW.updated_at = now()) and the triggers stay as they are.
--   2. Three SELECT policies call auth.uid() per row instead of the initplan
--      form (SELECT auth.uid()) of 096 §7b:
--        ai_pending_actions.ai_pending_actions_own              (116)
--        ai_conversations.ai_conversations_survey_owner_read    (136)
--        ai_messages.ai_messages_survey_owner_read              (136)
--      Same predicate, evaluated once per statement. ALTER POLICY changes only
--      USING: PERMISSIVE / RESTRICTIVE, command and roles are kept. None of the
--      three tables is on a policy reference cycle (ai_messages reads
--      ai_conversations, whose policies read no other table), so the sub-select
--      cannot trigger "infinite recursion detected in policy".
--
-- Idempotent (ALTER … SET / ALTER POLICY re-applied give the same result; each
-- object is skipped when it does not exist). No data is changed, nobody gains
-- or loses access. Number 137 is taken by 137_ai_routing_claude_default
-- (PR #21). Apply (on push to main, PO rule):
--   node scripts/apply-migration.js supabase/migrations/138_sec_p2_18_followup.sql

-- ─── 1. search_path of the trigger function ─────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.expert_review_touch_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.expert_review_touch_updated_at() SET search_path = public, pg_temp;
  END IF;
END $$;

-- ─── 2. auth.uid() in policies → initplan form ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
             AND tablename = 'ai_pending_actions' AND policyname = 'ai_pending_actions_own') THEN
    ALTER POLICY ai_pending_actions_own ON public.ai_pending_actions
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
             AND tablename = 'ai_conversations' AND policyname = 'ai_conversations_survey_owner_read') THEN
    ALTER POLICY ai_conversations_survey_owner_read ON public.ai_conversations
      USING (surface <> 'survey' OR user_id = (SELECT auth.uid()));
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
             AND tablename = 'ai_messages' AND policyname = 'ai_messages_survey_owner_read') THEN
    ALTER POLICY ai_messages_survey_owner_read ON public.ai_messages
      USING (NOT EXISTS (
        SELECT 1 FROM public.ai_conversations c
         WHERE c.id = conversation_id AND c.surface = 'survey'
           AND c.user_id IS DISTINCT FROM (SELECT auth.uid())
      ));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
