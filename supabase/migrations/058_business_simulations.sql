-- 052_business_simulations.sql
-- Saved business simulations (K). Inputs + the deterministic result JSON; the
-- core lives in lib/simulator. Self-only RLS. Spec 09 §6.

create table if not exists public.business_simulations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  company_id  uuid,
  sim_type    text not null,
  status      text not null default 'draft' check (status in ('draft','completed','archived')),
  title       text,
  inputs      jsonb not null default '{}',
  result      jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_business_simulations_user
  on public.business_simulations (user_id, updated_at desc);

alter table public.business_simulations enable row level security;

drop policy if exists business_simulations_owner_all on public.business_simulations;
create policy business_simulations_owner_all on public.business_simulations
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
