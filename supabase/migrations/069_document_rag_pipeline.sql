-- 069_document_rag_pipeline.sql
-- Make document RAG usable for normal onboarding users and make re-indexing
-- idempotent. The legacy Prisma Client row is optional; user_id remains the
-- authoritative retrieval ownership boundary.

-- `completed` is a legacy success marker, while every current reader and writer
-- uses `parsed`. Normalize once so existing parsed_data participates in all
-- resolver/materialization paths without maintaining two terminal states.
update public.documents
   set parse_status = 'parsed'
 where parse_status = 'completed'
   and parsed_data is not null;

alter table public.document_summaries
  alter column "clientId" drop not null;

alter table public.document_summaries
  add column if not exists source_document_id text;

update public.document_summaries
   set source_document_id = metadata->>'source_document_id'
 where source_document_id is null
   and nullif(metadata->>'source_document_id', '') is not null;

-- If legacy retries produced duplicates, retain the newest summary as the
-- canonical one before enforcing uniqueness.
with ranked as (
  select id,
         row_number() over (
           partition by source_document_id
           order by "createdAt" desc, id desc
         ) as rn
    from public.document_summaries
   where source_document_id is not null
)
delete from public.document_summaries ds
 using ranked r
 where ds.id = r.id
   and r.rn > 1;

create unique index if not exists document_summaries_source_document_id_key
  on public.document_summaries (source_document_id);

create index if not exists document_summaries_user_created_idx
  on public.document_summaries (user_id, "createdAt" desc);

-- Use the stable source id first, while retaining metadata fallback for rows
-- created before this migration.
create or replace function public.match_user_document_chunks(
  p_user_id text,
  p_query vector(1536),
  p_limit int default 6,
  p_min_similarity float default 0.25
) returns table (
  chunk_id text,
  summary_id text,
  document_name text,
  content text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select dc.id,
         ds.id,
         coalesce(d.file_name, ds.metadata->>'file_name', 'документ'),
         dc.content,
         1 - (dc.embedding <=> p_query)
    from public.document_chunks dc
    join public.document_summaries ds
      on ds.id = dc."documentSummaryId"
    left join public.documents d
      on d.id::text = coalesce(ds.source_document_id, ds.metadata->>'source_document_id')
   where ds.user_id = p_user_id
     and dc.embedding is not null
     and 1 - (dc.embedding <=> p_query) >= greatest(0, least(1, p_min_similarity))
   order by dc.embedding <=> p_query
   limit greatest(1, least(20, p_limit));
$$;

revoke all on function public.match_user_document_chunks(text, vector, int, float)
  from public, anon, authenticated;
grant execute on function public.match_user_document_chunks(text, vector, int, float)
  to service_role;
