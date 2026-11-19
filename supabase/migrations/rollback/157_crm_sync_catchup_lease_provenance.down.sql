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
--
-- Data restored (wave 3, M3): the sync of 157 keys amoCRM clients by the account id
-- ('amocrm:<account id>', lib/crm/provider-client.ts), the sync of 155 by the host
-- ('amocrm:<host>'). Before the cursor column goes, the clients of the account each amoCRM
-- connection reads (its sync_cursor.source; without a cursor, the user's only account-id key) move
-- back to 'amocrm:<host of crm_provider_connections.base_url>' — one amoCRM connection per user
-- (UNIQUE user_id, provider). Left as they are: a client whose host key another client already has
-- (a duplicate the move cannot merge), and clients of a user without an amoCRM connection or with
-- several account-id keys and no cursor (no host or no account to tell) — the 155 sync then links
-- those contacts by phone only. Counted in a NOTICE.
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/157_crm_sync_catchup_lease_provenance.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_moved INTEGER;
  v_left INTEGER;
BEGIN
  -- A second run (157 already rolled back) has nothing to move.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'crm_provider_connections' AND column_name = 'sync_cursor') THEN
    RETURN;
  END IF;
  EXECUTE $q$
    WITH conn AS (
      -- The host as lib/crm/endpoint-guard.ts parseHost reads base_url: no scheme, path or port, lower case.
      SELECT c.user_id,
             'amocrm:' || lower(regexp_replace(regexp_replace(btrim(c.base_url), '^[a-z][a-z0-9+.-]*://', '', 'i'), '[:/?#].*$', '')) AS host_key,
             CASE WHEN c.sync_cursor->>'source' ~ '^amocrm:[0-9]+$' THEN c.sync_cursor->>'source' END AS cursor_key
        FROM public.crm_provider_connections c
       WHERE c.provider = 'amocrm'
    ), ids AS (
      SELECT cl.user_id, min(cl.external_source) AS only_key, count(DISTINCT cl.external_source) AS n
        FROM public.crm_clients cl
       WHERE cl.external_source ~ '^amocrm:[0-9]+$'
       GROUP BY cl.user_id
    ), pick AS (
      SELECT conn.user_id, conn.host_key, coalesce(conn.cursor_key, CASE WHEN ids.n = 1 THEN ids.only_key END) AS id_key
        FROM conn LEFT JOIN ids ON ids.user_id = conn.user_id
       WHERE conn.host_key ~ '^amocrm:[a-z0-9.-]+\.[a-z]+$'
    )
    UPDATE public.crm_clients cl
       SET external_source = p.host_key
      FROM pick p
     WHERE cl.user_id = p.user_id AND cl.external_source = p.id_key
       AND NOT EXISTS (SELECT 1 FROM public.crm_clients o
                        WHERE o.user_id = cl.user_id AND o.external_source = p.host_key AND o.external_id = cl.external_id)
  $q$;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  SELECT count(*) INTO v_left FROM public.crm_clients WHERE external_source ~ '^amocrm:[0-9]+$';
  RAISE NOTICE '157 rollback: amoCRM clients moved back to the host key: %, left keyed by an account id: %', v_moved, v_left;
END $$;

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
