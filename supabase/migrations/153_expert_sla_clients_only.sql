-- 153_expert_sla_clients_only.sql
--
-- R4 (S0): expert SLA work exists only for CLIENTS of the product.
--
-- Found on production 2026-11-16: 5 of 7 open SLA tasks belonged to staff accounts
-- (both Super Admin accounts and an Admin — their own test cases, reports, AI
-- analysis and Point B plan). No source of 145/146/149/152 asks whether the
-- «client» is a client: a staff account with a company is picked like anybody,
-- and staff always have Point B access, so the plan scan of 152 picks them too.
-- The first escalations would have been about the team's own accounts.
--
-- Rule (one place for every source, present and future): a task is not opened
-- when its client_id belongs to
--   • a person with a staff_roles row (any role), or
--   • a profile whose role is not a client role ('client', 'owner' —
--     lib/profiles/client-roles.ts CLIENT_PROFILE_ROLES): experts, partners,
--     legacy admin / super_admin profiles.
-- A task without a client (client_id NULL) is kept — nothing says it is staff.
--
--   expert_sla_is_client(uuid)            — the rule;
--   trigger expert_sla_tasks_clients_only — BEFORE INSERT: a staff «client» row is
--                                           skipped (RETURN NULL) — expert_sla_sync,
--                                           expert_sla_open_ai_review and
--                                           expert_sla_plan_prep insert with
--                                           ON CONFLICT … DO NOTHING RETURNING, so a
--                                           skipped row is simply not returned (no
--                                           notice, no escalation);
--   expert_sla_close_non_clients(ts)      — closes open tasks of such accounts
--                                           ('excluded', answered = false, as 149);
--                                           called once below.
--
-- The app's plan scan (lib/point-b/plan/waiting.ts) skips staff accounts too, so the
-- model is not calculated for them; this trigger is the guarantee.
--
-- Idempotent. No top-level BEGIN/COMMIT: apply in one transaction —
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/153_expert_sla_clients_only.sql
-- Rollback: supabase/migrations/rollback/153_expert_sla_clients_only.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.expert_sla_tasks') IS NULL
     OR to_regprocedure('public.expert_sla_plan_prep(timestamptz, int, int, jsonb, jsonb, int)') IS NULL THEN
    RAISE EXCEPTION '153 requires 145_expert_sla_tasks and 152_expert_sla_ai_review_plan_prep';
  END IF;
  IF to_regclass('public.staff_roles') IS NULL THEN
    RAISE EXCEPTION '153 requires public.staff_roles';
  END IF;
END $$;

-- A watcher pass running now must finish first; new passes wait for this commit.
LOCK TABLE public.expert_sla_tasks IN SHARE ROW EXCLUSIVE MODE;

-- ─── 1. The rule ────────────────────────────────────────────────────────────
-- SECURITY DEFINER: the inserting role (service_role inside the pass) must not
-- depend on its grants on profiles / staff_roles (the lesson of 152).
CREATE OR REPLACE FUNCTION public.expert_sla_is_client(p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NULL OR (
        NOT EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = p_user)
    AND NOT EXISTS (SELECT 1 FROM public.profiles p
                     WHERE p.id = p_user AND p.role IS NOT NULL AND p.role NOT IN ('client', 'owner'))
  )
$$;
COMMENT ON FUNCTION public.expert_sla_is_client(uuid) IS
  '153: the account is a client of the product — no staff_roles row and no non-client profile role (client / owner, lib/profiles/client-roles.ts). NULL (no client) counts as a client. Expert SLA work exists only for clients.';

-- ─── 2. The guarantee: no task for a non-client ────────────────────────────
CREATE OR REPLACE FUNCTION public.expert_sla_tasks_clients_only()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.expert_sla_is_client(NEW.client_id) THEN
    RETURN NULL; -- staff / expert account: not client work, the row is skipped
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.expert_sla_tasks_clients_only() IS
  '153: BEFORE INSERT on expert_sla_tasks — a task whose client is not a client of the product (expert_sla_is_client) is skipped.';

DROP TRIGGER IF EXISTS expert_sla_tasks_clients_only ON public.expert_sla_tasks;
CREATE TRIGGER expert_sla_tasks_clients_only
  BEFORE INSERT ON public.expert_sla_tasks
  FOR EACH ROW EXECUTE FUNCTION public.expert_sla_tasks_clients_only();

-- ─── 3. Close what is already open ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expert_sla_close_non_clients(p_now TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (r_task UUID, r_source TEXT, r_client UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.expert_sla_tasks t
     SET closed_at = greatest(coalesce(p_now, now()), t.received_at),
         close_reason = 'excluded',
         answered = false
   WHERE t.closed_at IS NULL
     AND t.client_id IS NOT NULL
     AND NOT public.expert_sla_is_client(t.client_id)
  RETURNING t.id, t.source, t.client_id;
END;
$$;
COMMENT ON FUNCTION public.expert_sla_close_non_clients(timestamptz) IS
  '153: close open SLA tasks of accounts that are not clients (staff, experts) — close_reason excluded, answered false. Service role only.';

SELECT count(*) AS closed_non_client_tasks FROM public.expert_sla_close_non_clients(now());

-- ─── 4. Rights: service role only ───────────────────────────────────────────
DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.expert_sla_is_client(uuid)',
    'public.expert_sla_tasks_clients_only()',
    'public.expert_sla_close_non_clients(timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
