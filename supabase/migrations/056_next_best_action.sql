-- 056_next_best_action.sql
-- Next Best Action event log (A2). The action itself is computed on read from
-- live signals; we only persist events so cooldowns (dismiss 72h / complete 7d)
-- and activation metrics work. Spec: 02-next-best-action-plan.md §A2.

create table if not exists public.nba_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  action_key  text not null,        -- stable key, e.g. 'red_zone:finance', 'plan_task:42'
  event       text not null
              check (event in ('shown','done','dismissed','why_opened','explained')),
  payload     jsonb,                 -- snapshot: {score, signal, title}
  created_at  timestamptz not null default now()
);

create index if not exists idx_nba_log_user_action
  on public.nba_log (user_id, action_key, created_at desc);

alter table public.nba_log enable row level security;

drop policy if exists nba_log_owner_all on public.nba_log;
create policy nba_log_owner_all on public.nba_log
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
