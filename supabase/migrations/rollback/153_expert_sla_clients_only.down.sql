-- rollback/153_expert_sla_clients_only.down.sql
--
-- Removes the «clients only» rule of 153: the trigger and the three functions.
-- Tasks closed by 153 ('not_client') stay closed; the next SLA pass opens tasks for
-- staff accounts again as before 153 (inheriting the clock of an unanswered
-- predecessor within the answer window, the rule of 146).
--
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/rollback/153_expert_sla_clients_only.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP TRIGGER IF EXISTS expert_sla_tasks_clients_only ON public.expert_sla_tasks;
DROP FUNCTION IF EXISTS public.expert_sla_tasks_clients_only();
DROP FUNCTION IF EXISTS public.expert_sla_close_non_clients(timestamptz);
DROP FUNCTION IF EXISTS public.expert_sla_is_client(uuid);
-- The journal (public.schema_migrations) is kept by whoever applies the rollback, as for 140.

NOTIFY pgrst, 'reload schema';
