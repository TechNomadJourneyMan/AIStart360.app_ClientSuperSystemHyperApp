-- 155_crm_sync_external_ids.sql
--
-- CRM revival (2026-11-18): the sync of Bitrix24 / amoCRM must not add duplicates, and an
-- interaction or reminder may only be attached to the user's own client.
--
-- 1. crm_clients.external_source / external_id — which CRM record a client mirrors.
--      external_source = '<provider>:<portal host>' (e.g. 'bitrix24:acme.bitrix24.kz',
--      'amocrm:acme.amocrm.ru'): ids are only unique inside one portal, so a user who switches to
--      another portal of the same CRM never gets a client of the old portal re-used.
--      external_id     = the CONTACT id in that CRM (deals are not clients; their amounts are
--      aggregated into avg_check of their contact, lib/crm/provider-sync.ts).
--    Both set or both empty (CHECK). Manual / CSV clients have neither.
--    Unique index (user_id, external_source, external_id): the sync upserts on it
--    (PostgREST on_conflict=user_id,external_source,external_id). It is deliberately NOT partial:
--    `ON CONFLICT (cols)` without the predicate cannot use a partial index ("there is no unique or
--    exclusion constraint matching the ON CONFLICT specification") and PostgREST cannot send one.
--    Semantics are the same as `WHERE external_id IS NOT NULL`: NULLs are distinct in a unique
--    index, so any number of unlinked clients never collide.
--
-- 2. L1 (CRM audit 2026-11-18): crm_interactions / crm_reminders INSERT and UPDATE checked only
--    user_id = auth.uid() (044), so a user could attach a row of their own to ANOTHER user's client
--    id. Both now also require the client to belong to auth.uid(). SELECT / DELETE own and the
--    staff read policies (*_sel_staff, rewritten by 140) are not touched. auth.uid() is in the
--    initplan form (SELECT auth.uid()) like every policy since 096 / 138 (SEC-P2-18).
--
-- 3. One vocabulary for crm_provider_connections.last_sync_status: 'success' | 'partial' | 'error'
--    (what the Pulse integrations tab shows). The old sync route wrote 'ok'; such rows become
--    'success' (the readers also accept the legacy value).
--
-- Idempotent. Rollback: supabase/migrations/rollback/155_crm_sync_external_ids.down.sql
--   node scripts/apply-migration.js supabase/migrations/155_crm_sync_external_ids.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. external ids ────────────────────────────────────────────────────────────
ALTER TABLE public.crm_clients ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE public.crm_clients ADD COLUMN IF NOT EXISTS external_id TEXT;

COMMENT ON COLUMN public.crm_clients.external_source IS
  '[155] CRM the client mirrors: ''<provider>:<portal host>''; NULL for manual / CSV clients';
COMMENT ON COLUMN public.crm_clients.external_id IS
  '[155] contact id in that CRM; set together with external_source';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'crm_clients_external_pair' AND conrelid = 'public.crm_clients'::regclass
  ) THEN
    ALTER TABLE public.crm_clients
      ADD CONSTRAINT crm_clients_external_pair CHECK ((external_source IS NULL) = (external_id IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_clients_user_external
  ON public.crm_clients (user_id, external_source, external_id);

-- ── 2. L1: interactions / reminders only on the user's own client ──────────────
DROP POLICY IF EXISTS crm_interactions_ins_own ON public.crm_interactions;
CREATE POLICY crm_interactions_ins_own ON public.crm_interactions
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.crm_clients c
                 WHERE c.id = crm_interactions.client_id AND c.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS crm_interactions_upd_own ON public.crm_interactions;
CREATE POLICY crm_interactions_upd_own ON public.crm_interactions
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.crm_clients c
                 WHERE c.id = crm_interactions.client_id AND c.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS crm_reminders_ins_own ON public.crm_reminders;
CREATE POLICY crm_reminders_ins_own ON public.crm_reminders
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.crm_clients c
                 WHERE c.id = crm_reminders.client_id AND c.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS crm_reminders_upd_own ON public.crm_reminders;
CREATE POLICY crm_reminders_upd_own ON public.crm_reminders
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.crm_clients c
                 WHERE c.id = crm_reminders.client_id AND c.user_id = (SELECT auth.uid()))
  );

-- ── 3. sync status vocabulary ──────────────────────────────────────────────────
UPDATE public.crm_provider_connections SET last_sync_status = 'success' WHERE last_sync_status = 'ok';

COMMENT ON COLUMN public.crm_provider_connections.last_sync_status IS
  'success | partial | error (155; the legacy ''ok'' means success)';

NOTIFY pgrst, 'reload schema';
