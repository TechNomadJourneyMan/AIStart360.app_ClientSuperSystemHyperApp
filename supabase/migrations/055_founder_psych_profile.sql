-- 055_founder_psych_profile.sql
-- Founder psychological profile (business/HR, NOT clinical) + a general consent
-- ledger reused by several features (psych profile, digest, benchmarks, mini-GRI
-- contact, personalization). Spec: 07-psych-profile.md, 12-security.md §2.
--
-- Privacy: the psych profile is the HIGHEST-sensitivity user data — self-only,
-- NOT visible to staff. No staff policy is granted.

create table if not exists public.founder_psych_profiles (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  version     integer not null default 1,
  answers     jsonb   not null default '{}',   -- raw mechanic/questionnaire answers
  result      jsonb,                            -- founder_psych_profile.result.v1 (schema in spec 07 §5)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.user_consents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null
               check (kind in ('psych_profile','weekly_digest_email','weekly_digest_telegram',
                               'benchmarks_contribution','mini_gri_contact','personalization')),
  granted      boolean not null default false,
  granted_at   timestamptz,
  revoked_at   timestamptz,
  text_version text,                            -- version of the consent copy shown
  updated_at   timestamptz not null default now(),
  unique (user_id, kind)
);

create index if not exists idx_user_consents_user on public.user_consents (user_id, kind);

alter table public.founder_psych_profiles enable row level security;
alter table public.user_consents          enable row level security;

-- Self-only. Staff explicitly excluded (highest privacy level).
drop policy if exists founder_psych_profiles_self on public.founder_psych_profiles;
create policy founder_psych_profiles_self on public.founder_psych_profiles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_consents_self on public.user_consents;
create policy user_consents_self on public.user_consents
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
