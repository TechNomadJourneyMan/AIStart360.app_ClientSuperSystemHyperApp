-- 054_document_retrieval.sql
-- Enable RAG retrieval (A1) and RESOLVE the document-ownership blocker (Q11).
--
-- Reality checked on the live DB: document_summaries scopes by clientId (→
-- clients.managerId), which the code itself calls unreliable, AND there are
-- currently 0 summaries / 0 chunks / 0 embeddings. So the clean fix is to give
-- document_summaries a direct user_id (text, to match documents.user_id) and
-- scope retrieval by it — no backfill of real data is needed.
--
-- Depends on pgvector (installed, 0.8.0) and document_chunks (Prisma-managed).

-- 1. Direct owner on the summary. TEXT to match documents.user_id / clients.managerId.
alter table public.document_summaries
  add column if not exists user_id text;

-- Best-effort backfill from the existing (fragile) client linkage. No-op today
-- (0 rows); keeps any pre-code-change rows correct.
update public.document_summaries ds
   set user_id = c."managerId"
  from public.clients c
 where c.id = ds."clientId"
   and ds.user_id is null;

create index if not exists idx_document_summaries_user
  on public.document_summaries (user_id);

-- 2. Vector index for cosine similarity (HNSW; empty table → instant).
create index if not exists document_chunks_embedding_hnsw
  on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- 3. Scoped retrieval. user_id is supplied by the SERVER from the session, never
-- by the client (same rule as buildAssistantContext). SECURITY DEFINER so it can
-- read past RLS, but locked down: revoked from anon/authenticated.
create or replace function public.match_user_document_chunks(
  p_user_id text,
  p_query vector(1536),
  p_limit int default 6,
  p_min_similarity float default 0.25
) returns table (chunk_id text, summary_id text, document_name text, content text, similarity float)
language sql stable security definer set search_path = public as $$
  select dc.id,
         ds.id,
         coalesce(d.file_name, 'документ'),
         dc.content,
         1 - (dc.embedding <=> p_query)
    from public.document_chunks dc
    join public.document_summaries ds on ds.id = dc."documentSummaryId"
    left join public.documents d on d.id::text = ds.metadata->>'source_document_id'
   where ds.user_id = p_user_id
     and dc.embedding is not null
     and 1 - (dc.embedding <=> p_query) >= p_min_similarity
   order by dc.embedding <=> p_query
   limit p_limit;
$$;

revoke all on function public.match_user_document_chunks(text, vector, int, float)
  from public, anon, authenticated;
