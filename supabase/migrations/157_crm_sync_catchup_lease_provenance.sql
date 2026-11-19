-- 157_crm_sync_catchup_lease_provenance.sql
--
-- CRM revival, wave 2 (review of 2026-11-18). The sync of Bitrix24 / amoCRM (lib/crm/sync.ts):
--
-- 1. Catch-up (M2): a sync reads each CRM in ascending id order from where the previous run
--    stopped and wraps around at the end — crm_provider_connections.sync_cursor (jsonb, written
--    only by the sync). crm_clients.external_seen_at = when the client's CRM contact was last read:
--    after a complete pass, linked clients not seen since the pass started are those the CRM no
--    longer has (counted, never deleted) and their phone may be re-linked to a surviving contact (M5).
--    crm_sync_deals keeps the qualifying deals of the current pass (not lost, amount > 0, KZT, with
--    a contact), one row per deal (re-reading a deal is idempotent); avg_check is applied from them
--    once every deal was read (crm_sync_apply_deal_totals). Operational rows, owner-only: a row only
--    on the owner's own connection (wave 3, M1).
--
-- 2. One sync per connection at a time (M3): sync_lease_until / sync_lease_token, taken by
--    crm_sync_acquire_lease (a conditional UPDATE with an expiry, the database clock) and released
--    by the sync's final status write.
--
-- 3. avg_check provenance (M4): crm_clients.avg_check_source 'manual' | 'crm'. A figure the owner
--    sets is 'manual' and the sync never changes it; the sync owns only 'crm' (or an empty value).
--    Existing figures: 'crm' when the client came from a CRM (source bitrix24 / amocrm), else
--    'manual'. A trigger marks every owner write: a client inserted with an avg_check and no source
--    is 'manual'; an UPDATE that changes avg_check without setting the source makes it 'manual'
--    (null when cleared) — except the sync's own write (crm_sync_apply_deal_totals sets the
--    transaction-local flag aistart360.crm_sync). CHECK: a figure always has a source.
--
-- 4. Writes without the read/write race (review Low): crm_sync_update_clients fills only fields that
--    are empty AT WRITE TIME (name / phone / phone_raw / email / source), links only clients still
--    unlinked, never fills a phone another client has (M1: no 23505) and never inserts;
--    crm_sync_insert_clients inserts new contacts with ON CONFLICT DO NOTHING (both unique indexes).
--
-- Functions: SECURITY INVOKER (RLS of the caller applies: the owner's own rows for the button, the
-- service role for the cron), search_path pinned, EXECUTE for authenticated and service_role only.
-- Policies use (SELECT auth.uid()) (SEC-P2-18). Idempotent.
-- Rollback: supabase/migrations/rollback/157_crm_sync_catchup_lease_provenance.down.sql
--   node scripts/apply-migration.js supabase/migrations/157_crm_sync_catchup_lease_provenance.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. columns ─────────────────────────────────────────────────────────────────
ALTER TABLE public.crm_clients ADD COLUMN IF NOT EXISTS avg_check_source TEXT;
ALTER TABLE public.crm_clients ADD COLUMN IF NOT EXISTS external_seen_at TIMESTAMPTZ;
COMMENT ON COLUMN public.crm_clients.avg_check_source IS
  '[157] who set avg_check: manual (the owner; the CRM sync never changes it) | crm (the sync owns it); NULL when avg_check is empty';
COMMENT ON COLUMN public.crm_clients.external_seen_at IS
  '[157] when the CRM sync last read this client''s contact';

ALTER TABLE public.crm_provider_connections ADD COLUMN IF NOT EXISTS sync_cursor JSONB;
ALTER TABLE public.crm_provider_connections ADD COLUMN IF NOT EXISTS sync_lease_until TIMESTAMPTZ;
ALTER TABLE public.crm_provider_connections ADD COLUMN IF NOT EXISTS sync_lease_token UUID;
COMMENT ON COLUMN public.crm_provider_connections.sync_cursor IS
  '[157] where the CRM sync continues (lib/crm/sync-cursor.ts); written only by the sync';
COMMENT ON COLUMN public.crm_provider_connections.sync_lease_until IS
  '[157] a sync of this connection runs until then (crm_sync_acquire_lease)';
COMMENT ON COLUMN public.crm_provider_connections.sync_lease_token IS
  '[157] the token of the sync holding the lease';

UPDATE public.crm_clients
   SET avg_check_source = CASE WHEN source IN ('bitrix24', 'amocrm') THEN 'crm' ELSE 'manual' END
 WHERE avg_check IS NOT NULL AND avg_check_source IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_clients_avg_check_source_valid' AND conrelid = 'public.crm_clients'::regclass) THEN
    ALTER TABLE public.crm_clients
      ADD CONSTRAINT crm_clients_avg_check_source_valid CHECK (avg_check_source IS NULL OR avg_check_source IN ('manual', 'crm'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_clients_avg_check_has_source' AND conrelid = 'public.crm_clients'::regclass) THEN
    ALTER TABLE public.crm_clients
      ADD CONSTRAINT crm_clients_avg_check_has_source CHECK (avg_check IS NULL OR avg_check_source IS NOT NULL);
  END IF;
END $$;

-- ── 2. provenance trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_clients_avg_check_provenance()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('aistart360.crm_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.avg_check IS NOT NULL AND NEW.avg_check_source IS NULL THEN
      NEW.avg_check_source := 'manual';
    END IF;
  ELSIF NEW.avg_check IS DISTINCT FROM OLD.avg_check
    AND NEW.avg_check_source IS NOT DISTINCT FROM OLD.avg_check_source THEN
    NEW.avg_check_source := CASE WHEN NEW.avg_check IS NULL THEN NULL ELSE 'manual' END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS crm_clients_avg_check_provenance ON public.crm_clients;
CREATE TRIGGER crm_clients_avg_check_provenance
  BEFORE INSERT OR UPDATE OF avg_check, avg_check_source ON public.crm_clients
  FOR EACH ROW EXECUTE FUNCTION public.crm_clients_avg_check_provenance();

-- ── 3. qualifying deals of the current pass ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_sync_deals (
  connection_id   UUID NOT NULL REFERENCES public.crm_provider_connections(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id         TEXT NOT NULL,
  contact_id      TEXT NOT NULL,
  amount          NUMERIC NOT NULL CHECK (amount > 0),
  pass_started_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (connection_id, deal_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_sync_deals_pass ON public.crm_sync_deals (connection_id, pass_started_at, contact_id);
COMMENT ON TABLE public.crm_sync_deals IS
  '[157] qualifying CRM deals of the running sync pass (operational; avg_check is applied from them at the end of a pass)';

ALTER TABLE public.crm_sync_deals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_sync_deals FROM PUBLIC;
REVOKE ALL ON public.crm_sync_deals FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_sync_deals TO authenticated;
GRANT ALL ON public.crm_sync_deals TO service_role;
-- M1 (wave 3): a row is the owner's only on the owner's OWN connection. The foreign key does not see
-- RLS, so a check of user_id alone let a user put rows on another user's connection_id: that user's
-- upsert of the same deal then met a row it may not update (42501, the deals pass never advanced).
DROP POLICY IF EXISTS crm_sync_deals_own ON public.crm_sync_deals;
CREATE POLICY crm_sync_deals_own ON public.crm_sync_deals
  FOR ALL USING (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.crm_provider_connections c
                 WHERE c.id = crm_sync_deals.connection_id AND c.user_id = (SELECT auth.uid()))
  ) WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.crm_provider_connections c
                 WHERE c.id = crm_sync_deals.connection_id AND c.user_id = (SELECT auth.uid()))
  );
-- Rows the old policy let in (a user other than the connection's owner) are removed.
DELETE FROM public.crm_sync_deals s
 WHERE NOT EXISTS (SELECT 1 FROM public.crm_provider_connections c WHERE c.id = s.connection_id AND c.user_id = s.user_id);

-- ── 4. functions of the sync ───────────────────────────────────────────────────

-- The lease of one sync of a connection: a token when free (or expired), NULL when another runs.
CREATE OR REPLACE FUNCTION public.crm_sync_acquire_lease(p_connection UUID, p_seconds INTEGER)
RETURNS UUID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_token UUID := gen_random_uuid();
BEGIN
  UPDATE public.crm_provider_connections
     SET sync_lease_until = now() + make_interval(secs => greatest(coalesce(p_seconds, 60), 1)),
         sync_lease_token = v_token
   WHERE id = p_connection
     AND (sync_lease_until IS NULL OR sync_lease_until < now());
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN v_token;
END $$;

-- New clients from CRM contacts; a row that collides with any unique index (the contact already has
-- a client, or its phone belongs to one) is skipped, never an error. Returns what was inserted.
CREATE OR REPLACE FUNCTION public.crm_sync_insert_clients(p_user UUID, p_source TEXT, p_seen_at TIMESTAMPTZ, p_rows JSONB)
RETURNS TABLE (id UUID, external_id TEXT) LANGUAGE plpgsql SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  INSERT INTO public.crm_clients AS c (user_id, name, phone, phone_raw, email, source, external_source, external_id, external_seen_at)
  SELECT p_user, coalesce(nullif(btrim(x.name), ''), 'Без имени'), x.phone, x.phone_raw, x.email,
         split_part(p_source, ':', 1), p_source, x.external_id, p_seen_at
    FROM jsonb_to_recordset(p_rows) AS x(external_id TEXT, name TEXT, phone TEXT, phone_raw TEXT, email TEXT)
   WHERE x.external_id IS NOT NULL
  ON CONFLICT DO NOTHING
  RETURNING c.id, c.external_id;
END $$;

-- Existing clients: a linked one (link = false: still linked to this contact) or one to link now
-- (link = true: still unlinked, and no other client has this contact). Fills only what is empty at
-- write time, a phone only when no other client of the user has it; marks the contact as seen.
-- Returns every row it matched and whether a field (or the link) changed.
CREATE OR REPLACE FUNCTION public.crm_sync_update_clients(p_user UUID, p_source TEXT, p_seen_at TIMESTAMPTZ, p_rows JSONB)
RETURNS TABLE (id UUID, changed BOOLEAN) LANGUAGE plpgsql SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH p AS (
    SELECT * FROM jsonb_to_recordset(p_rows)
      AS x(id UUID, external_id TEXT, name TEXT, phone TEXT, phone_raw TEXT, email TEXT, link BOOLEAN)
  ),
  d AS (
    SELECT c.id,
           p.external_id,
           coalesce(p.link, false) AS link,
           (btrim(coalesce(c.name, '')) IN ('', 'Без имени') AND nullif(btrim(p.name), '') IS NOT NULL) AS fill_name,
           (c.phone IS NULL AND p.phone IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.crm_clients o WHERE o.user_id = p_user AND o.phone = p.phone AND o.id <> c.id)) AS fill_phone,
           (nullif(btrim(coalesce(c.email, '')), '') IS NULL AND nullif(btrim(p.email), '') IS NOT NULL) AS fill_email,
           (nullif(btrim(coalesce(c.source, '')), '') IS NULL) AS fill_source,
           p.name AS p_name, p.phone AS p_phone, p.phone_raw AS p_phone_raw, p.email AS p_email,
           c.phone IS NULL AND nullif(btrim(coalesce(c.phone_raw, '')), '') IS NULL AND p.phone_raw IS NOT NULL AS raw_empty
      FROM p
      JOIN public.crm_clients c ON c.id = p.id AND c.user_id = p_user
     WHERE (coalesce(p.link, false) = false AND c.external_source = p_source AND c.external_id = p.external_id)
        OR (p.link AND c.external_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM public.crm_clients o
                             WHERE o.user_id = p_user AND o.external_source = p_source AND o.external_id = p.external_id))
  )
  UPDATE public.crm_clients c
     SET name = CASE WHEN d.fill_name THEN btrim(d.p_name) ELSE c.name END,
         phone = CASE WHEN d.fill_phone THEN d.p_phone ELSE c.phone END,
         -- the raw form goes with a filled phone, or alone when the CRM phone could not be normalised
         phone_raw = CASE WHEN d.raw_empty AND (d.fill_phone OR d.p_phone IS NULL) THEN d.p_phone_raw ELSE c.phone_raw END,
         email = CASE WHEN d.fill_email THEN btrim(d.p_email) ELSE c.email END,
         source = CASE WHEN d.fill_source THEN split_part(p_source, ':', 1) ELSE c.source END,
         external_source = CASE WHEN d.link THEN p_source ELSE c.external_source END,
         external_id = CASE WHEN d.link THEN d.external_id ELSE c.external_id END,
         external_seen_at = p_seen_at,
         updated_at = CASE WHEN d.link OR d.fill_name OR d.fill_phone OR d.fill_email OR d.fill_source
                             OR (d.raw_empty AND (d.fill_phone OR d.p_phone IS NULL))
                           THEN now() ELSE c.updated_at END
    FROM d
   WHERE c.id = d.id
  RETURNING c.id, (d.link OR d.fill_name OR d.fill_phone OR d.fill_email OR d.fill_source
                   OR (d.raw_empty AND (d.fill_phone OR d.p_phone IS NULL)));
END $$;

-- After a complete pass of the contacts (M5): a client linked to a contact not seen since the pass
-- started (deleted or merged in the CRM) is re-linked to the contact that now has its phone.
CREATE OR REPLACE FUNCTION public.crm_sync_relink(p_user UUID, p_source TEXT, p_pass_started_at TIMESTAMPTZ, p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Seen in this pass: never earlier than its start (now() is the transaction's start time).
  UPDATE public.crm_clients c
     SET external_id = x.external_id, external_seen_at = greatest(now(), p_pass_started_at), updated_at = now()
    FROM jsonb_to_recordset(p_rows) AS x(phone TEXT, external_id TEXT)
   WHERE c.user_id = p_user AND c.phone = x.phone AND c.external_source = p_source
     AND (c.external_seen_at IS NULL OR c.external_seen_at < p_pass_started_at)
     AND NOT EXISTS (SELECT 1 FROM public.crm_clients o
                      WHERE o.user_id = p_user AND o.external_source = p_source AND o.external_id = x.external_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- After a complete pass of the deals: avg_check of every client of this CRM whose avg_check the
-- sync owns ('crm' or empty) = the mean of its contact's qualifying deals, rounded to whole tenge;
-- a 'crm' figure without a qualifying deal any more becomes NULL. 'manual' figures are never
-- touched. Rows of older passes are removed (the current pass stays, so a repeat is idempotent).
-- Every read and delete of crm_sync_deals is limited to p_user's rows of p_user's own connection.
CREATE OR REPLACE FUNCTION public.crm_sync_apply_deal_totals(p_connection UUID, p_user UUID, p_source TEXT, p_pass_started_at TIMESTAMPTZ)
RETURNS TABLE (updated INTEGER, cleared INTEGER) LANGUAGE plpgsql SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_updated INTEGER;
  v_cleared INTEGER;
BEGIN
  -- Only the user's own connection (the cron calls this as the service role, without RLS).
  IF NOT EXISTS (SELECT 1 FROM public.crm_provider_connections c WHERE c.id = p_connection AND c.user_id = p_user) THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;
  PERFORM set_config('aistart360.crm_sync', 'on', true);
  WITH t AS (
    SELECT s.contact_id, round(avg(s.amount)) AS avg
      FROM public.crm_sync_deals s
     WHERE s.connection_id = p_connection AND s.user_id = p_user AND s.pass_started_at = p_pass_started_at
     GROUP BY s.contact_id
  )
  UPDATE public.crm_clients c
     SET avg_check = t.avg, avg_check_source = 'crm', updated_at = now()
    FROM t
   WHERE c.user_id = p_user AND c.external_source = p_source AND c.external_id = t.contact_id
     AND c.avg_check_source IS DISTINCT FROM 'manual'
     AND (c.avg_check IS DISTINCT FROM t.avg OR c.avg_check_source IS NULL);
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  UPDATE public.crm_clients c
     SET avg_check = NULL, avg_check_source = NULL, updated_at = now()
   WHERE c.user_id = p_user AND c.external_source = p_source AND c.avg_check_source = 'crm'
     AND NOT EXISTS (SELECT 1 FROM public.crm_sync_deals s
                      WHERE s.connection_id = p_connection AND s.user_id = p_user
                        AND s.pass_started_at = p_pass_started_at AND s.contact_id = c.external_id);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  DELETE FROM public.crm_sync_deals s
   WHERE s.connection_id = p_connection AND s.user_id = p_user AND s.pass_started_at < p_pass_started_at;
  PERFORM set_config('aistart360.crm_sync', '', true);
  RETURN QUERY SELECT v_updated, v_cleared;
END $$;

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.crm_sync_acquire_lease(uuid, integer)',
    'public.crm_sync_insert_clients(uuid, text, timestamptz, jsonb)',
    'public.crm_sync_update_clients(uuid, text, timestamptz, jsonb)',
    'public.crm_sync_relink(uuid, text, timestamptz, jsonb)',
    'public.crm_sync_apply_deal_totals(uuid, uuid, text, timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.crm_clients_avg_check_provenance() FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.crm_clients_avg_check_provenance() FROM anon, authenticated;
END $$;

NOTIFY pgrst, 'reload schema';
