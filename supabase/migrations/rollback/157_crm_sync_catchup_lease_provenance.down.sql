-- 157_crm_sync_catchup_lease_provenance.down.sql — ROLLBACK of migration 157 (CRM revival, wave 2).
--
-- NOT part of the migration sequence (appliers read only supabase/migrations/*.sql).
-- Drops the sync functions, the provenance trigger, crm_sync_deals (the qualifying deals of a running
-- sync pass — operational, no client data), the two CHECKs and the columns 157 added:
--   crm_clients.avg_check_source, external_seen_at; crm_provider_connections.sync_cursor,
--   sync_lease_until, sync_lease_token.
-- Every one of them is dropped unconditionally (DROP … IF EXISTS), including a column of that name
-- an environment might have had before 157.
-- Data lost: who set each avg_check (the figures themselves stay), when a contact was last read,
-- where a running catch-up stood (the next sync starts a new pass) and any lease. Roll the portal
-- code back first: the sync of wave 2 calls these functions and fails without them.
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/157_crm_sync_catchup_lease_provenance.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.crm_sync_apply_deal_totals(uuid, uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.crm_sync_relink(uuid, text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.crm_sync_update_clients(uuid, text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.crm_sync_insert_clients(uuid, text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.crm_sync_acquire_lease(uuid, integer);

DROP TABLE IF EXISTS public.crm_sync_deals;

DROP TRIGGER IF EXISTS crm_clients_avg_check_provenance ON public.crm_clients;
DROP FUNCTION IF EXISTS public.crm_clients_avg_check_provenance();

ALTER TABLE public.crm_clients DROP CONSTRAINT IF EXISTS crm_clients_avg_check_has_source;
ALTER TABLE public.crm_clients DROP CONSTRAINT IF EXISTS crm_clients_avg_check_source_valid;
ALTER TABLE public.crm_clients DROP COLUMN IF EXISTS avg_check_source;
ALTER TABLE public.crm_clients DROP COLUMN IF EXISTS external_seen_at;
ALTER TABLE public.crm_provider_connections DROP COLUMN IF EXISTS sync_cursor;
ALTER TABLE public.crm_provider_connections DROP COLUMN IF EXISTS sync_lease_until;
ALTER TABLE public.crm_provider_connections DROP COLUMN IF EXISTS sync_lease_token;
-- The journal (public.schema_migrations) is kept by whoever applies the rollback, as for 140.

NOTIFY pgrst, 'reload schema';
