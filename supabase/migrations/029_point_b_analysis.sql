-- 029_point_b_analysis.sql
-- Persisted Point B snapshots. The table already exists on the production DB but
-- had no migration (not reproducible) and only READ RLS policies — so the API's
-- upsert silently no-op'd under a user session. This migration makes the table
-- reproducible and adds the missing owner WRITE policy. (Runtime persistence also
-- goes through the service role, so it works regardless of RLS.)

create table if not exists public.point_b_analysis (
  id            uuid primary key default gen_random_uuid(),
  diagnostic_id uuid references public.diagnostics(id) on delete cascade,
  horizon_months integer,
  target_overall  numeric,
  target_health   numeric,
  target_stage    text,
  target_blocks   jsonb,
  target_kpis     jsonb,
  gap_analysis    jsonb,
  roadmap         jsonb,
  ai_strategy     jsonb,
  ai_status       text,
  ai_error        text,
  is_current      boolean default true,
  calculated_at   timestamptz default now()
);

create index if not exists idx_point_b_analysis_diag_current
  on public.point_b_analysis (diagnostic_id, is_current);

alter table public.point_b_analysis enable row level security;

-- Owner can read their own plan (snapshots tied to their diagnostic).
drop policy if exists point_b_owner_read on public.point_b_analysis;
create policy point_b_owner_read on public.point_b_analysis
  for select to authenticated
  using (exists (
    select 1 from public.diagnostics d
    where d.id = point_b_analysis.diagnostic_id and d.user_id = auth.uid()
  ));

-- Owner can write/update their own plan (the missing policy that broke persistence).
drop policy if exists point_b_owner_write on public.point_b_analysis;
create policy point_b_owner_write on public.point_b_analysis
  for all to authenticated
  using (exists (
    select 1 from public.diagnostics d
    where d.id = point_b_analysis.diagnostic_id and d.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.diagnostics d
    where d.id = point_b_analysis.diagnostic_id and d.user_id = auth.uid()
  ));

-- Staff (expert/admin/super_admin) can read any plan.
drop policy if exists point_b_staff_read on public.point_b_analysis;
create policy point_b_staff_read on public.point_b_analysis
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('expert', 'admin', 'super_admin')
  ));
