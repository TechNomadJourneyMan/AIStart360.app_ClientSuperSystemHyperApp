-- 030_action_items.sql
-- Executable Action Plan (Карта роста) — relational tasks with status/owner/
-- deadline, generated from the GRI 90-day plan + TOP-5 limits. Replaces the
-- read-only JSONB (gri_assessments.action_plan_90d) for tracking (§16.8/§13.10).

create table if not exists public.action_items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references public.profiles(id) on delete cascade,
  gri_assessment_id uuid references public.gri_assessments(id) on delete set null,
  period            text,            -- '1-30' | '31-60' | '61-90'
  title             text not null,
  description       text,
  status            text not null default 'open',  -- 'open' | 'in_progress' | 'done'
  owner             text,
  due_date          date,
  expected_effect   text,
  linked_block      text,
  priority          integer default 3,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_action_items_user_status on public.action_items (user_id, status);
create index if not exists idx_action_items_gri on public.action_items (gri_assessment_id);

alter table public.action_items enable row level security;

-- Owner can read/write their own tasks.
drop policy if exists action_items_owner_all on public.action_items;
create policy action_items_owner_all on public.action_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Staff (expert/admin/super_admin) can read AND edit any client's plan (§19).
drop policy if exists action_items_staff_all on public.action_items;
create policy action_items_staff_all on public.action_items
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('expert','admin','super_admin')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('expert','admin','super_admin')));
