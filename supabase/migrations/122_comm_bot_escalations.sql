-- 122_comm_bot_escalations.sql
--
-- Phases 4–5 of the user communications
-- (docs/superpowers/specs/2026-10-16-user-communications-design.md §6.4–6.5):
--
--   expert_cases.comm_thread_id   the request the client bot opened («Позову
--                                 эксперта» / «оформи заявку») points at the
--                                 conversation it came from. Nullable; older
--                                 cases and the assistant's cases have none.
--                                 lib/comm/bot.ts writes it and falls back to a
--                                 row without it while this migration is not
--                                 applied.
--   comm_threads_escalation_idx   the 30-minute check (every 5 minutes) reads
--                                 only threads that wait for staff, are not
--                                 escalated yet and are not blocked — a small
--                                 partial index on the deadline.
--   match_kb_articles(vector, …)  semantic search over the PUBLISHED articles of
--                                 the bot's knowledge base (kb_articles,
--                                 migration 120), most similar first. Service
--                                 role only. Without it (or without an
--                                 embedding provider) the bot searches by words.
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/122_comm_bot_escalations.sql

-- ─── 1. Request ↔ conversation ──────────────────────────────────────────────
ALTER TABLE public.expert_cases
  ADD COLUMN IF NOT EXISTS comm_thread_id UUID REFERENCES public.comm_threads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS expert_cases_comm_thread_idx
  ON public.expert_cases (comm_thread_id, created_at DESC)
  WHERE comm_thread_id IS NOT NULL;
COMMENT ON COLUMN public.expert_cases.comm_thread_id IS
  'Диалог «Сообщения» (comm_threads), из которого бот оформил заявку. NULL — заявка не из диалога.';

-- ─── 2. The 30-minute check ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS comm_threads_escalation_idx
  ON public.comm_threads (staff_reply_due_at)
  WHERE status = 'waiting_staff' AND escalated_at IS NULL AND blocked_at IS NULL;

-- ─── 3. Knowledge base search ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_kb_articles(
  p_query vector(1536),
  p_limit int DEFAULT 4,
  p_min_similarity float DEFAULT 0.3
) RETURNS TABLE (id uuid, title text, body text, tags text[], similarity float)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id,
         a.title,
         left(a.body, 4000),
         a.tags,
         1 - (a.embedding <=> p_query)
    FROM public.kb_articles a
   WHERE a.status = 'published'
     AND a.embedding IS NOT NULL
     AND 1 - (a.embedding <=> p_query) >= p_min_similarity
   ORDER BY a.embedding <=> p_query
   LIMIT least(greatest(p_limit, 1), 10);
$$;

REVOKE ALL ON FUNCTION public.match_kb_articles(vector, int, float) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_kb_articles(vector, int, float) TO service_role;

NOTIFY pgrst, 'reload schema';
