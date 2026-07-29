-- 075_ai_journey_device_sync.sql
-- Durable, cookie-first device credentials for the AI Journey workspace.
-- Raw credentials and connect codes never enter the database. Device tokens
-- use SHA-256; short connect codes use a server-keyed HMAC-SHA-256 digest so a
-- database snapshot cannot be used for offline code enumeration. Code
-- redemption and workspace saves are atomic RPCs.

alter table public.ai_journey_workspaces
  add column if not exists revision bigint not null default 0;

create table if not exists public.ai_journey_device_credentials (
  id                uuid primary key default gen_random_uuid(),
  workspace_key     text not null references public.ai_journey_workspaces(workspace_key) on delete cascade,
  token_hash        text not null unique,
  device_label      text not null default 'Связанное устройство'
                    check (char_length(device_label) between 1 and 80),
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz not null default now(),
  revoked_at        timestamptz,
  constraint ai_journey_device_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.ai_journey_connect_codes (
  id                   uuid primary key default gen_random_uuid(),
  workspace_key        text not null references public.ai_journey_workspaces(workspace_key) on delete cascade,
  code_hash             text not null unique,
  created_by_device_id  uuid references public.ai_journey_device_credentials(id) on delete set null,
  created_by_user_id    uuid references public.profiles(id) on delete set null,
  expires_at            timestamptz not null,
  consumed_at           timestamptz,
  claimed_by_device_id  uuid references public.ai_journey_device_credentials(id) on delete set null,
  attempt_count         smallint not null default 0 check (attempt_count >= 0),
  max_attempts          smallint not null default 5 check (max_attempts between 1 and 10),
  created_at            timestamptz not null default now(),
  constraint ai_journey_connect_code_hash_shape check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint ai_journey_connect_code_expiry check (expires_at > created_at)
);

create index if not exists idx_ai_journey_devices_workspace_active
  on public.ai_journey_device_credentials(workspace_key, last_used_at desc)
  where revoked_at is null;
create index if not exists idx_ai_journey_connect_codes_expiry
  on public.ai_journey_connect_codes(expires_at)
  where consumed_at is null;

alter table public.ai_journey_device_credentials enable row level security;
alter table public.ai_journey_connect_codes enable row level security;

drop policy if exists ai_journey_device_credentials_public on public.ai_journey_device_credentials;
drop policy if exists ai_journey_connect_codes_public on public.ai_journey_connect_codes;

-- Atomically claim a one-time code and mint a separate per-device credential.
-- Invalid ownership consumes an attempt without exposing whether the workspace
-- belongs to another user. All terminal statuses are returned, not raised, so
-- the attempt increment is committed instead of being rolled back by an error.
create or replace function public.claim_ai_journey_connect_code(
  p_code_hash text,
  p_device_token_hash text,
  p_device_label text,
  p_actor_user_id uuid default null,
  p_now timestamptz default now()
)
returns table(status text, workspace_key text, workspace_state jsonb, server_revision bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.ai_journey_connect_codes%rowtype;
  v_workspace public.ai_journey_workspaces%rowtype;
  v_device_id uuid;
begin
  select * into v_code
  from public.ai_journey_connect_codes
  where code_hash = p_code_hash
  for update;

  if not found then
    return query select 'invalid'::text, null::text, null::jsonb, null::bigint;
    return;
  end if;
  if v_code.consumed_at is not null then
    return query select 'consumed'::text, null::text, null::jsonb, null::bigint;
    return;
  end if;
  if v_code.expires_at <= p_now then
    return query select 'expired'::text, null::text, null::jsonb, null::bigint;
    return;
  end if;
  if v_code.attempt_count >= v_code.max_attempts then
    return query select 'locked'::text, null::text, null::jsonb, null::bigint;
    return;
  end if;

  select * into v_workspace
  from public.ai_journey_workspaces
  where ai_journey_workspaces.workspace_key = v_code.workspace_key
  for update;

  if not found or (v_workspace.user_id is not null and
      (p_actor_user_id is null or v_workspace.user_id <> p_actor_user_id)) then
    update public.ai_journey_connect_codes
      set attempt_count = attempt_count + 1
      where id = v_code.id;
    return query select 'forbidden'::text, null::text, null::jsonb, null::bigint;
    return;
  end if;

  insert into public.ai_journey_device_credentials (
    workspace_key, token_hash, device_label, created_by_user_id, last_used_at
  ) values (
    v_code.workspace_key,
    p_device_token_hash,
    left(coalesce(nullif(trim(p_device_label), ''), 'Связанное устройство'), 80),
    p_actor_user_id,
    p_now
  ) returning id into v_device_id;

  update public.ai_journey_connect_codes
    set consumed_at = p_now,
        claimed_by_device_id = v_device_id,
        attempt_count = attempt_count + 1
    where id = v_code.id;

  return query select
    'claimed'::text,
    v_workspace.workspace_key,
    v_workspace.state,
    v_workspace.revision;
end;
$$;

-- Compare-and-swap keeps two devices from silently overwriting one another.
-- It also authenticates inside the same transaction, removing the TOCTOU gap
-- between the route's preflight and the write.
create or replace function public.save_ai_journey_workspace_state(
  p_workspace_key text,
  p_credential_hash text,
  p_actor_user_id uuid,
  p_expected_revision bigint,
  p_phase text,
  p_profile jsonb,
  p_facts jsonb,
  p_goals jsonb,
  p_roadmap jsonb,
  p_widget_state jsonb,
  p_state jsonb,
  p_now timestamptz default now()
)
returns table(status text, server_revision bigint, workspace_state jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace public.ai_journey_workspaces%rowtype;
  v_next_revision bigint;
begin
  select * into v_workspace
  from public.ai_journey_workspaces
  where ai_journey_workspaces.workspace_key = p_workspace_key
  for update;

  if not found then
    if p_expected_revision <> 0 then
      return query select 'stale'::text, 0::bigint, null::jsonb;
      return;
    end if;
    insert into public.ai_journey_workspaces (
      workspace_key, access_token_hash, user_id, revision, version, phase,
      profile, facts, goals, roadmap, widget_state, state, updated_at
    ) values (
      p_workspace_key, p_credential_hash, p_actor_user_id, 1, 1, p_phase,
      p_profile, p_facts, p_goals, p_roadmap, p_widget_state,
      jsonb_set(p_state, '{serverRevision}', '1'::jsonb, true), p_now
    ) on conflict (workspace_key) do nothing;

    if found then
      return query select 'saved'::text, 1::bigint,
        jsonb_set(p_state, '{serverRevision}', '1'::jsonb, true);
    else
      return query select 'stale'::text, 0::bigint, null::jsonb;
    end if;
    return;
  end if;

  if (v_workspace.user_id is not null and
      (p_actor_user_id is null or v_workspace.user_id <> p_actor_user_id)) or
     not (
       v_workspace.access_token_hash = p_credential_hash or exists (
         select 1 from public.ai_journey_device_credentials d
         where d.workspace_key = p_workspace_key
           and d.token_hash = p_credential_hash
           and d.revoked_at is null
       )
     ) then
    return query select 'forbidden'::text, v_workspace.revision, null::jsonb;
    return;
  end if;

  if v_workspace.revision <> p_expected_revision then
    return query select 'stale'::text, v_workspace.revision, v_workspace.state;
    return;
  end if;

  v_next_revision := v_workspace.revision + 1;
  update public.ai_journey_workspaces
    set revision = v_next_revision,
        phase = p_phase,
        profile = p_profile,
        facts = p_facts,
        goals = p_goals,
        roadmap = p_roadmap,
        widget_state = p_widget_state,
        state = jsonb_set(p_state, '{serverRevision}', to_jsonb(v_next_revision), true),
        updated_at = p_now
    where ai_journey_workspaces.workspace_key = p_workspace_key;

  update public.ai_journey_device_credentials
    set last_used_at = p_now
    where workspace_key = p_workspace_key
      and token_hash = p_credential_hash
      and revoked_at is null;

  return query select 'saved'::text, v_next_revision,
    jsonb_set(p_state, '{serverRevision}', to_jsonb(v_next_revision), true);
end;
$$;

revoke all on function public.claim_ai_journey_connect_code(text,text,text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.save_ai_journey_workspace_state(text,text,uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_ai_journey_connect_code(text,text,text,uuid,timestamptz) to service_role;
grant execute on function public.save_ai_journey_workspace_state(text,text,uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz) to service_role;

comment on table public.ai_journey_device_credentials is
  'Hash-only, revocable per-device credentials. Raw values live only in HttpOnly cookies.';
comment on table public.ai_journey_connect_codes is
  'Hash-only, ten-minute one-time device linking challenges.';
