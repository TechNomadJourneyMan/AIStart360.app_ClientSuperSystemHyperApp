-- 078_ai_journey_authenticated_bootstrap.sql
-- One canonical Journey workspace per authenticated AIStart360 account.
-- The mapping is server-only; browsers receive only a revocable credential in
-- an HttpOnly cookie and never receive a service or root workspace secret.

create table if not exists public.ai_journey_user_workspaces (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  workspace_key text not null unique
                references public.ai_journey_workspaces(workspace_key) on delete cascade,
  seed_fingerprint text,
  seeded_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.ai_journey_user_workspaces enable row level security;

drop policy if exists ai_journey_user_workspaces_public
  on public.ai_journey_user_workspaces;

revoke all on table public.ai_journey_user_workspaces
  from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_journey_user_workspaces
  to service_role;

comment on table public.ai_journey_user_workspaces is
  'Server-only canonical workspace mapping for authenticated Journey clients.';
