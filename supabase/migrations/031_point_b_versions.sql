-- 031_point_b_versions.sql
-- Expert version / corrections of a client's Point B (§15.2/§16.5 block 15/§19).
-- The expert records strategic notes (and optionally an edited roadmap) tied to
-- the client's current diagnostic; the client sees the approved expert version.

create table if not exists public.point_b_versions (
  id            uuid primary key default gen_random_uuid(),
  diagnostic_id uuid references public.diagnostics(id) on delete cascade,
  authored_by   uuid references public.profiles(id) on delete set null,
  author_name   text,
  expert_notes  text,
  roadmap       jsonb,             -- optional expert-edited plan snapshot
  is_approved   boolean not null default true,
  created_at    timestamptz default now()
);

create index if not exists idx_point_b_versions_diag on public.point_b_versions (diagnostic_id, created_at desc);

alter table public.point_b_versions enable row level security;

-- Owner can read approved expert versions of their own plan.
drop policy if exists point_b_versions_owner_read on public.point_b_versions;
create policy point_b_versions_owner_read on public.point_b_versions
  for select to authenticated
  using (exists (
    select 1 from public.diagnostics d
    where d.id = point_b_versions.diagnostic_id and d.user_id = auth.uid()
  ));

-- Staff (expert/admin/super_admin) can read and write any.
drop policy if exists point_b_versions_staff_all on public.point_b_versions;
create policy point_b_versions_staff_all on public.point_b_versions
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('expert','admin','super_admin')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('expert','admin','super_admin')));
