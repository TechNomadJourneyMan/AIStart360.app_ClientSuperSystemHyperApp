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
--                             then); expires in 24 h. 'applying' = taken by
--                             one «Применить» (two clicks never both run).
--   match_company_document_chunks  document search of ONE company (the chat;
--                             the per-user RPC of 054 mixes an owner's companies)
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
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applying', 'applied', 'rejected', 'expired', 'failed')),
  result           JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  decided_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ai_pending_actions_user_idx ON public.ai_pending_actions (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_pending_actions_conversation_idx ON public.ai_pending_actions (conversation_id, created_at DESC);
ALTER TABLE public.ai_pending_actions DROP CONSTRAINT IF EXISTS ai_pending_actions_status_check;
ALTER TABLE public.ai_pending_actions ADD CONSTRAINT ai_pending_actions_status_check
  CHECK (status IN ('pending', 'applying', 'applied', 'rejected', 'expired', 'failed'));

ALTER TABLE public.ai_pending_actions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ai_pending_actions FROM anon, authenticated;
DROP POLICY IF EXISTS ai_pending_actions_own ON public.ai_pending_actions;
CREATE POLICY ai_pending_actions_own ON public.ai_pending_actions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Document chunks of one company (documents.company_id), most similar first.
CREATE OR REPLACE FUNCTION public.match_company_document_chunks(
  p_company_id text,
  p_query vector(1536),
  p_limit int DEFAULT 6,
  p_min_similarity float DEFAULT 0.25
) RETURNS TABLE (chunk_id text, document_id text, document_name text, content text, similarity float)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dc.id,
         d.id::text,
         coalesce(d.file_name, 'документ'),
         dc.content,
         1 - (dc.embedding <=> p_query)
    FROM public.document_chunks dc
    JOIN public.document_summaries ds ON ds.id = dc."documentSummaryId"
    JOIN public.documents d ON d.id::text = ds.metadata->>'source_document_id'
   WHERE d.company_id::text = p_company_id
     AND dc.embedding IS NOT NULL
     AND 1 - (dc.embedding <=> p_query) >= p_min_similarity
   ORDER BY dc.embedding <=> p_query
   LIMIT least(greatest(p_limit, 1), 20);
$$;
REVOKE ALL ON FUNCTION public.match_company_document_chunks(text, vector, int, float) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_company_document_chunks(text, vector, int, float) TO service_role;

NOTIFY pgrst, 'reload schema';
