-- 069_ai_first_workspace.sql
-- Isolated AI-first A -> B workspace. Guest previews authenticate with a
-- high-entropy token that is hashed server-side; only the service role can
-- access these tables. No anon/authenticated RLS policy is intentionally added.

create table if not exists public.ai_journey_workspaces (
  workspace_key      text primary key,
  access_token_hash  text not null,
  user_id            uuid references public.profiles(id) on delete cascade,
  version            integer not null default 1 check (version = 1),
  phase              text not null default 'empty'
                     check (phase in ('empty','loading','analyzing','partial','ready','error')),
  profile            jsonb not null default '{}'::jsonb,
  facts              jsonb not null default '[]'::jsonb,
  goals              jsonb not null default '[]'::jsonb,
  roadmap            jsonb not null default '[]'::jsonb,
  widget_state       jsonb not null default '[]'::jsonb,
  viewport_state     jsonb not null default '{}'::jsonb,
  state              jsonb not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ai_journey_workspace_key_length check (char_length(workspace_key) between 8 and 120),
  constraint ai_journey_token_hash_shape check (access_token_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.ai_journey_messages (
  id             text primary key,
  workspace_key  text not null references public.ai_journey_workspaces(workspace_key) on delete cascade,
  role           text not null check (role in ('user','assistant','system')),
  content        text not null check (char_length(content) between 1 and 4000),
  provider_mode  text check (provider_mode in ('live','demo','unavailable')),
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create table if not exists public.ai_journey_files (
  id               text primary key,
  workspace_key    text not null references public.ai_journey_workspaces(workspace_key) on delete cascade,
  name             text not null,
  mime             text not null,
  size_bytes       integer not null check (size_bytes between 0 and 4194304),
  status           text not null check (status in ('queued','uploading','analyzing','ready','local-only','error')),
  storage_path     text,
  parser           text,
  extracted_facts  jsonb not null default '[]'::jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_ai_journey_workspaces_user_updated
  on public.ai_journey_workspaces(user_id, updated_at desc)
  where user_id is not null;
create index if not exists idx_ai_journey_messages_workspace_created
  on public.ai_journey_messages(workspace_key, created_at);
create index if not exists idx_ai_journey_files_workspace_created
  on public.ai_journey_files(workspace_key, created_at desc);

alter table public.ai_journey_workspaces enable row level security;
alter table public.ai_journey_messages enable row level security;
alter table public.ai_journey_files enable row level security;

-- Explicitly remove legacy/accidental policies if this migration is replayed.
drop policy if exists ai_journey_workspaces_public on public.ai_journey_workspaces;
drop policy if exists ai_journey_messages_public on public.ai_journey_messages;
drop policy if exists ai_journey_files_public on public.ai_journey_files;

comment on table public.ai_journey_workspaces is
  'AI-first business transformation workspace. Access only through token-gated server routes.';
comment on column public.ai_journey_workspaces.state is
  'Schema-validated JourneyState v1; model output is never stored before validation.';
