-- 053_ai_conversations.sql
-- Persistent AI chat (chat поверх отчёта, A1). Stores conversations + messages
-- so a user can reopen the last dialog; content is already post-filter/PII-mask
-- when written by the server. Spec: docs/SPEC-2026-07-09-AI-FEATURES/01-ai-chat-rag.md §6.
--
-- NOTE: numbered to sit after the parallel GRI/CRM branch (043/044). Independent
-- of those tables, so apply order does not matter.

create table if not exists public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  company_id  uuid,
  surface     text not null default 'report'
              check (surface in ('report','dashboard','point_a','point_b','simulator','intake')),
  persona_id  text not null default 'gri_base',
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.ai_conversations(id) on delete cascade,
  role             text not null check (role in ('user','assistant')),
  content          text not null,             -- already filtered/PII-masked on write
  grounding        jsonb,                     -- used_sources (assistant only)
  validation       jsonb,                     -- {status, risk_level, issues[]} (assistant only)
  model            text,
  latency_ms       integer,
  tokens_in        integer,
  tokens_out       integer,
  created_at       timestamptz not null default now()
);

create index if not exists idx_ai_conversations_user
  on public.ai_conversations (user_id, surface, updated_at desc);
create index if not exists idx_ai_messages_conv
  on public.ai_messages (conversation_id, created_at);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;

-- Owner-only: conversations and their messages are private to the user.
-- (Staff read is deliberately NOT granted here — pending the expert-scoping
--  decision Q4; add a scoped policy later rather than opening it now.)
drop policy if exists ai_conversations_owner_all on public.ai_conversations;
create policy ai_conversations_owner_all on public.ai_conversations
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists ai_messages_owner_all on public.ai_messages;
create policy ai_messages_owner_all on public.ai_messages
  for all to authenticated
  using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  ));
