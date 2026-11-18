-- 155_crm_sync_external_ids.down.sql — ROLLBACK of migration 155 (CRM revival 2026-11-18).
--
-- NOT part of the migration sequence (appliers read only supabase/migrations/*.sql).
-- Restores the INSERT / UPDATE policies of crm_interactions and crm_reminders as they were before
-- 155 (044, in the initplan form 096 gave them: user_id only — the L1 hole comes back), drops the
-- unique index, the CHECK and the columns external_source / external_id when their comment starts
-- with «[155]». 155 sets that comment unconditionally (COMMENT ON COLUMN after ADD COLUMN IF NOT
-- EXISTS), so a column of the same name that existed before 155 carries it too and is dropped as
-- well; the comment only spares a column whose comment was changed after 155.
-- Data lost with the dropped columns: which CRM contact each client mirrors. The clients
-- themselves, their notes, statuses, interactions and reminders are not touched. After the
-- rollback the old code links CRM records by phone again, so roll the portal code back first (the
-- new sync writes external_source / external_id and fails without them).
-- last_sync_status values stay 'success' / 'partial' / 'error' (the old Pulse tab shows them).
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/155_crm_sync_external_ids.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP POLICY IF EXISTS crm_interactions_ins_own ON public.crm_interactions;
CREATE POLICY crm_interactions_ins_own ON public.crm_interactions FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS crm_interactions_upd_own ON public.crm_interactions;
CREATE POLICY crm_interactions_upd_own ON public.crm_interactions FOR UPDATE USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS crm_reminders_ins_own ON public.crm_reminders;
CREATE POLICY crm_reminders_ins_own ON public.crm_reminders FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS crm_reminders_upd_own ON public.crm_reminders;
CREATE POLICY crm_reminders_upd_own ON public.crm_reminders FOR UPDATE USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP INDEX IF EXISTS public.uq_crm_clients_user_external;
ALTER TABLE public.crm_clients DROP CONSTRAINT IF EXISTS crm_clients_external_pair;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT a.attname AS name
      FROM pg_attribute a
     WHERE a.attrelid = 'public.crm_clients'::regclass
       AND a.attname IN ('external_source', 'external_id')
       AND NOT a.attisdropped
       AND coalesce(col_description(a.attrelid, a.attnum), '') LIKE '[155]%'
  LOOP
    EXECUTE format('ALTER TABLE public.crm_clients DROP COLUMN %I', c.name);
  END LOOP;
END $$;

COMMENT ON COLUMN public.crm_provider_connections.last_sync_status IS NULL;
-- The journal (public.schema_migrations) is kept by whoever applies the rollback, as for 140.

NOTIFY pgrst, 'reload schema';
