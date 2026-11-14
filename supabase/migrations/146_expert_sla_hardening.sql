-- 146_expert_sla_hardening.sql
--
-- R2-B, fixes after the independent review (reports/R2-B-REVIEW.md). Tests:
-- tests/integration/db/expert-sla.test.ts (section «146»).
--
--   1. expert_cases: a client may still open his own request through
--      PostgREST, but only with the defaults — assignee_id / assigned_to /
--      first_response_at / sla_due_at / comm_thread_id NULL and status 'new'.
--      Before: WITH CHECK (user_id = auth.uid()) let a client pick the
--      assignee and mark the request «in progress» (no SLA reaction clock).
--      The policy expert_cases_insert_own is REPLACED (same name, stricter
--      WITH CHECK); nothing else on expert_cases changes. The app inserts
--      through the service role and is not affected.
--   2. expert_sla_tasks follow the client's responsible (user_assignments):
--        * expert_sla_can_hold(user, client) — a worker who is the client's
--          responsible, or staff that sees every client (super_admin, admin,
--          super_expert with client_scope 'all');
--        * expert_sla_realign(client | NULL, now) — every open expert task
--          goes to the responsible when he is a worker, otherwise to the
--          queue; a case's own assignee ('source') is kept only while he may
--          hold it;
--        * trigger expert_sla_follow_assignment on user_assignments (every
--          path: GIGA user card, bulk, «Эксперты», Telegram bot, the SLA
--          auto-assignment) realigns at once and moves the client's open
--          expert_cases of the previous responsible to the new one;
--        * the staff SELECT policy loses the «assigned to me» branch: staff /
--          experts read tasks of clients in their scope only.
--   3. Notifications are an outbox: *_notified_at is set only after a
--      successful delivery (expert_sla_mark_notified), failed attempts are
--      counted (notify_attempts for the thresholds, info_attempts for the
--      assignment / queue news) with the error; the run retries.
--      A changed assignee resets assign_notified_at (and queue_notified_at
--      when the task returns to the queue) unless the same UPDATE sets it.
--   4. The SLA clock starts at the watcher's first pass (expert_sla_sync
--      writes expert_sla_clock_start ON CONFLICT DO NOTHING), not at the
--      migration: the value 145 wrote is removed while no task exists yet.
--   5. A close without an expert is not an answer: answered = false and
--      close_reason superseded / stale / withdrawn / failed / gone; the next
--      task of the same lineage (report: company + type, recommendations:
--      company, plan: plan, case: case) opened within the answer window
--      inherits received_at, the deadlines, the reaction and the thresholds.
--   6. expert_sla_claim('breached') also closes a pending escalation delivery
--      (one message for a backlog task, not two).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS
-- + CREATE; the backfill runs only when the outbox columns are new. One
-- implicit transaction (apply-migration.js).
-- Rollback: supabase/migrations/rollback/146_expert_sla_hardening.down.sql
-- Apply AFTER 145:
--   node scripts/apply-migration.js supabase/migrations/146_expert_sla_hardening.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.expert_sla_tasks') IS NULL OR to_regprocedure('public.expert_sla_is_worker(uuid)') IS NULL THEN
    RAISE EXCEPTION '146: apply 145_expert_sla_tasks.sql first';
  END IF;
END $$;

-- ─── 1. expert_cases: a client's own request only with the defaults ─────────
DO $$
DECLARE
  v_check TEXT := 'user_id = (SELECT auth.uid()) AND status = ''new''';
  c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['assignee_id', 'assigned_to', 'first_response_at', 'sla_due_at', 'comm_thread_id'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'expert_cases' AND column_name = c) THEN
      v_check := v_check || format(' AND %I IS NULL', c);
    END IF;
  END LOOP;
  DROP POLICY IF EXISTS expert_cases_insert_own ON public.expert_cases;
  EXECUTE format('CREATE POLICY expert_cases_insert_own ON public.expert_cases FOR INSERT WITH CHECK (%s)', v_check);
END $$;
COMMENT ON POLICY expert_cases_insert_own ON public.expert_cases IS
  '146: a client opens his own request with the defaults only (no assignee, no reaction, status new). Staff / app write through the service role.';

-- ─── 2. Ledger: lineage, answer flag, outbox ────────────────────────────────
DO $$
DECLARE
  v_fresh BOOLEAN := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expert_sla_tasks' AND column_name = 'notify_attempts');
BEGIN
  ALTER TABLE public.expert_sla_tasks
    ADD COLUMN IF NOT EXISTS answered               BOOLEAN,
    ADD COLUMN IF NOT EXISTS lineage                TEXT,
    ADD COLUMN IF NOT EXISTS assign_notified_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS queue_notified_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS escalation_notified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS breach_notified_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notify_attempts        INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS info_attempts          INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS notify_error           TEXT;

  IF v_fresh THEN
    -- Rows written by 145 were announced fire-and-forget: count them as delivered.
    UPDATE public.expert_sla_tasks t
       SET lineage = CASE t.source
             WHEN 'report_review' THEN coalesce((SELECT rv.company_id || ':' || rv.report_type
                                                   FROM public.report_versions rv WHERE rv.id::text = t.source_id), t.source_id)
             WHEN 'plan_review' THEN coalesce((SELECT v.plan_id::text
                                                 FROM public.pb_plan_versions v WHERE v.id::text = t.source_id), t.source_id)
             ELSE t.source_id END,
           answered = CASE WHEN t.closed_at IS NULL THEN NULL
                           ELSE t.close_reason IN ('resolved', 'closed', 'published', 'approved', 'reviewed', 'rejected') END,
           escalation_notified_at = CASE WHEN t.escalated_at IS NOT NULL THEN t.escalated_at END,
           breach_notified_at = CASE WHEN t.breached_at IS NOT NULL THEN t.breached_at END,
           assign_notified_at = CASE WHEN t.assignee_id IS NOT NULL THEN coalesce(t.assigned_at, t.created_at) END,
           queue_notified_at = CASE WHEN t.assignee_id IS NULL THEN t.created_at END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS expert_sla_tasks_lineage_idx
  ON public.expert_sla_tasks (source, lineage, closed_at DESC);

COMMENT ON COLUMN public.expert_sla_tasks.answered IS '146: closed with an expert / staff answer (true) or without one — superseded / stale / withdrawn / gone (false). NULL while open.';
COMMENT ON COLUMN public.expert_sla_tasks.lineage IS '146: the same piece of work across versions (report: company:type, recommendations: company, plan: plan id, case: case id).';
COMMENT ON COLUMN public.expert_sla_tasks.escalation_notified_at IS '146: the 24-hour escalation was DELIVERED (escalated_at = claimed).';
COMMENT ON COLUMN public.expert_sla_tasks.breach_notified_at IS '146: the 48-hour breach was DELIVERED (breached_at = claimed).';

-- A changed assignee needs a new announcement (unless the same UPDATE records one).
CREATE OR REPLACE FUNCTION public.expert_sla_tasks_reset_notified()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    IF NEW.assign_notified_at IS NOT DISTINCT FROM OLD.assign_notified_at THEN
      NEW.assign_notified_at := NULL;
    END IF;
    IF NEW.assignee_id IS NULL AND NEW.queue_notified_at IS NOT DISTINCT FROM OLD.queue_notified_at THEN
      NEW.queue_notified_at := NULL;
    END IF;
    NEW.info_attempts := 0;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS expert_sla_tasks_reset_notified ON public.expert_sla_tasks;
CREATE TRIGGER expert_sla_tasks_reset_notified
  BEFORE UPDATE ON public.expert_sla_tasks
  FOR EACH ROW EXECUTE FUNCTION public.expert_sla_tasks_reset_notified();

-- ─── 3. Clock start at the first pass ───────────────────────────────────────
DELETE FROM public.system_settings s
 WHERE s.key = 'expert_sla_clock_start'
   AND NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks);

-- ─── 4. Staff read: client scope only ───────────────────────────────────────
DROP POLICY IF EXISTS expert_sla_tasks_staff_select ON public.expert_sla_tasks;
CREATE POLICY expert_sla_tasks_staff_select ON public.expert_sla_tasks
  FOR SELECT TO authenticated
  USING (
       (SELECT public.staff_sees_all_clients())
    OR client_id IN (SELECT public.staff_assigned_user_ids())
  );

-- ─── 5. Who may hold a client's expert task ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.expert_sla_can_hold(p_user UUID, p_client UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_user IS NOT NULL AND p_client IS NOT NULL
     AND public.expert_sla_is_worker(p_user)
     AND (
          EXISTS (SELECT 1 FROM public.user_assignments ua WHERE ua.user_id = p_client AND ua.assignee_id = p_user)
       OR EXISTS (SELECT 1 FROM public.staff_roles s
                   WHERE s.user_id = p_user
                     AND (s.role IN ('super_admin', 'admin')
                          OR (s.role = 'super_expert' AND coalesce(s.client_scope, 'all') <> 'assigned')))
     )
$$;
COMMENT ON FUNCTION public.expert_sla_can_hold(uuid, uuid) IS
  '146: a worker who is the client''s responsible, or staff that sees every client — may hold the client''s expert SLA task.';

-- ─── 6. Realign open tasks with the responsible ─────────────────────────────
CREATE OR REPLACE FUNCTION public.expert_sla_realign(p_client UUID DEFAULT NULL, p_now TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (r_task UUID, r_change TEXT, r_source TEXT, r_client UUID, r_assignee UUID, r_via TEXT)
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH cur AS (
    SELECT t.id, t.client_id, t.assignee_id, t.assigned_via,
           CASE WHEN public.expert_sla_is_worker(ua.assignee_id) THEN ua.assignee_id END AS resp
      FROM public.expert_sla_tasks t
      LEFT JOIN public.user_assignments ua ON ua.user_id = t.client_id
     WHERE t.closed_at IS NULL
       AND t.source IN ('case', 'report_review', 'rec_review')
       AND (p_client IS NULL OR t.client_id = p_client)
  ), want AS (
    SELECT c.id,
           CASE WHEN c.assigned_via = 'source' AND public.expert_sla_can_hold(c.assignee_id, c.client_id) THEN c.assignee_id
                ELSE c.resp END AS target
      FROM cur c
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET assignee_id = w.target,
           assigned_at = CASE WHEN w.target IS NULL THEN NULL ELSE coalesce(p_now, now()) END,
           assigned_via = CASE WHEN w.target IS NULL THEN NULL ELSE 'client' END
      FROM want w
     WHERE t.id = w.id AND t.assignee_id IS DISTINCT FROM w.target
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, CASE WHEN u.assignee_id IS NULL THEN 'unassigned' ELSE 'reassigned' END,
         u.source, u.client_id, u.assignee_id, u.assigned_via
    FROM upd u;
END;
$$;
COMMENT ON FUNCTION public.expert_sla_realign(uuid, timestamptz) IS
  '146: open expert tasks of a client (NULL — all) follow the responsible: a worker responsible holds them, otherwise the queue; a case''s own assignee is kept while expert_sla_can_hold.';

CREATE OR REPLACE FUNCTION public.expert_sla_follow_assignment()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_client UUID;
  v_old    UUID;
  v_new    UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_client := OLD.user_id; v_old := OLD.assignee_id; v_new := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_client := NEW.user_id; v_old := NULL; v_new := NEW.assignee_id;
  ELSE
    v_client := NEW.user_id; v_old := OLD.assignee_id; v_new := NEW.assignee_id;
    IF v_old IS NOT DISTINCT FROM v_new THEN
      RETURN NULL;
    END IF;
  END IF;
  -- The assignment itself must never fail because of the SLA ledger: the
  -- watcher's pass realigns again (expert_sla_sync → expert_sla_realign).
  BEGIN
    PERFORM 1 FROM public.expert_sla_realign(v_client, now());
    IF v_old IS NOT NULL THEN
      UPDATE public.expert_cases
         SET assignee_id = v_new, assigned_to = v_new
       WHERE user_id = v_client AND status IN ('new', 'in_progress') AND assignee_id = v_old;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'expert_sla_follow_assignment(%): %', v_client, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS expert_sla_follow_assignment ON public.user_assignments;
CREATE TRIGGER expert_sla_follow_assignment
  AFTER INSERT OR UPDATE OF assignee_id OR DELETE ON public.user_assignments
  FOR EACH ROW EXECUTE FUNCTION public.expert_sla_follow_assignment();

-- ─── 7. Sync (replaces 145) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expert_sla_sync(
  p_now            TIMESTAMPTZ DEFAULT now(),
  p_reaction_hours INT         DEFAULT 24,
  p_answer_hours   INT         DEFAULT 48,
  p_limit          INT         DEFAULT 200
)
RETURNS TABLE (r_task UUID, r_change TEXT, r_source TEXT, r_client UUID, r_assignee UUID, r_via TEXT)
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_now    TIMESTAMPTZ := coalesce(p_now, now());
  v_react  INT := greatest(1, least(coalesce(p_reaction_hours, 24), 720));
  v_answer INT;
  v_limit  INT := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_raw    TEXT;
  v_start  TIMESTAMPTZ := '-infinity';
  v_window INTERVAL;
BEGIN
  v_answer := greatest(v_react, least(coalesce(p_answer_hours, 48), 720));
  v_window := make_interval(hours => v_answer);

  -- The clock starts at the first pass of the watcher (not at the migration).
  INSERT INTO public.system_settings (key, value)
  VALUES ('expert_sla_clock_start', to_jsonb(v_now))
  ON CONFLICT (key) DO NOTHING;
  SELECT s.value #>> '{}' INTO v_raw FROM public.system_settings s WHERE s.key = 'expert_sla_clock_start';
  IF v_raw ~ '^\d{4}-\d{2}-\d{2}' THEN
    BEGIN
      v_start := v_raw::timestamptz;
    EXCEPTION WHEN others THEN
      v_start := '-infinity';
    END;
  END IF;

  -- 7.1 Close. answered: an expert / staff decision reached the client.
  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id::uuid AS sid FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'case'
  ), done AS (
    SELECT ot.id, ec.status AS st, ec.updated_at AS upd, ec.first_response_at AS fr, (ec.id IS NOT NULL) AS ok
      FROM ot LEFT JOIN public.expert_cases ec ON ec.id = ot.sid
     WHERE ec.id IS NULL OR ec.status NOT IN ('new', 'in_progress')
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET closed_at = least(greatest(coalesce(d.upd, v_now), t.received_at), v_now),
           close_reason = coalesce(d.st, 'gone'),
           answered = d.ok,
           first_response_at = CASE WHEN d.ok THEN coalesce(t.first_response_at,
                                        least(greatest(coalesce(d.fr, d.upd, v_now), t.received_at), v_now))
                                    ELSE t.first_response_at END
      FROM done d
     WHERE t.id = d.id AND t.closed_at IS NULL
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'closed'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id::uuid AS sid FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'report_review'
  ), done AS (
    SELECT ot.id, rv.status AS st, r.decision,
           (r.id IS NOT NULL OR rv.status = 'published') AS ok,
           coalesce(r.created_at, rv.published_at, rv.updated_at) AS ts
      FROM ot
      LEFT JOIN public.report_versions rv ON rv.id = ot.sid
      LEFT JOIN LATERAL (
        SELECT rr.id, rr.decision, rr.created_at FROM public.report_version_reviews rr
         WHERE rr.report_version_id = ot.sid ORDER BY rr.created_at LIMIT 1
      ) r ON true
     WHERE rv.id IS NULL OR rv.status <> 'in_review'
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET closed_at = least(greatest(coalesce(d.ts, v_now), t.received_at), v_now),
           close_reason = CASE WHEN d.decision = 'changes_requested' THEN 'changes_requested'
                               WHEN d.ok THEN 'published'
                               ELSE coalesce(d.st, 'gone') END,
           answered = d.ok,
           first_response_at = CASE WHEN d.ok THEN coalesce(t.first_response_at, least(greatest(coalesce(d.ts, v_now), t.received_at), v_now))
                                    ELSE t.first_response_at END
      FROM done d
     WHERE t.id = d.id AND t.closed_at IS NULL
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'closed'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id::uuid AS sid, t.received_at FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'plan_review'
  ), done AS (
    SELECT ot.id,
           (v.status = 'approved' OR (v.status = 'draft' AND v.rejected_at >= ot.received_at)) AS ok,
           CASE WHEN v.id IS NULL THEN 'gone'
                WHEN v.status = 'approved' THEN 'approved'
                WHEN v.status = 'draft' AND v.rejected_at >= ot.received_at THEN 'rejected'
                ELSE 'withdrawn' END AS st,
           CASE WHEN v.status = 'approved' THEN v.approved_at
                WHEN v.status = 'draft' AND v.rejected_at >= ot.received_at THEN v.rejected_at END AS ts
      FROM ot LEFT JOIN public.pb_plan_versions v ON v.id = ot.sid
     WHERE v.id IS NULL OR v.status <> 'in_review'
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET closed_at = least(greatest(coalesce(d.ts, v_now), t.received_at), v_now),
           close_reason = d.st,
           answered = coalesce(d.ok, false),
           first_response_at = CASE WHEN d.ok THEN coalesce(t.first_response_at, least(greatest(coalesce(d.ts, v_now), t.received_at), v_now))
                                    ELSE t.first_response_at END
      FROM done d
     WHERE t.id = d.id AND t.closed_at IS NULL
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'closed'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id AS cid, t.received_at FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'rec_review'
  ), done AS (
    SELECT ot.id,
           (SELECT max(r.reviewed_at) FROM public.pb_recommendations r
             WHERE r.company_id = ot.cid AND r.reviewed_at >= ot.received_at) AS ts
      FROM ot
     WHERE NOT EXISTS (SELECT 1 FROM public.pb_recommendations r
                        WHERE r.company_id = ot.cid AND r.status = 'pending_review')
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET closed_at = least(greatest(coalesce(d.ts, v_now), t.received_at), v_now),
           close_reason = CASE WHEN d.ts IS NOT NULL THEN 'reviewed' ELSE 'stale' END,
           answered = d.ts IS NOT NULL,
           first_response_at = CASE WHEN d.ts IS NOT NULL THEN coalesce(t.first_response_at, least(greatest(d.ts, t.received_at), v_now))
                                    ELSE t.first_response_at END
      FROM done d
     WHERE t.id = d.id AND t.closed_at IS NULL
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'closed'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  -- 7.2 A case assigned in «Эскалации» moves its task — only to someone who may hold it.
  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id::uuid AS sid, t.client_id, t.assignee_id FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'case'
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET assignee_id = ec.assignee_id, assigned_at = v_now, assigned_via = 'source', assign_notified_at = v_now
      FROM ot JOIN public.expert_cases ec ON ec.id = ot.sid
     WHERE t.id = ot.id
       AND ec.assignee_id IS NOT NULL
       AND ec.assignee_id IS DISTINCT FROM ot.assignee_id
       AND public.expert_sla_can_hold(ec.assignee_id, ot.client_id)
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'reassigned'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  -- 7.3 Every open task follows the client's responsible (a missed trigger, a blocked expert).
  RETURN QUERY SELECT * FROM public.expert_sla_realign(NULL, v_now);

  -- 7.4 Reactions of open tasks: a case taken in work, a recommendation reviewed.
  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id::uuid AS sid FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'case' AND t.first_response_at IS NULL
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET first_response_at = least(greatest(coalesce(ec.first_response_at, ec.updated_at), t.received_at), v_now)
      FROM ot JOIN public.expert_cases ec ON ec.id = ot.sid
     WHERE t.id = ot.id AND t.first_response_at IS NULL
       AND (ec.first_response_at IS NOT NULL OR ec.status = 'in_progress')
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'reacted'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id AS cid, t.received_at FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'rec_review' AND t.first_response_at IS NULL
  ), hit AS (
    SELECT ot.id, min(r.reviewed_at) AS ts
      FROM ot JOIN public.pb_recommendations r ON r.company_id = ot.cid AND r.reviewed_at >= ot.received_at
     GROUP BY ot.id
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET first_response_at = least(h.ts, v_now)
      FROM hit h
     WHERE t.id = h.id AND t.first_response_at IS NULL
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'reacted'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  -- 7.5 New work. received_at: the source's moment, never before the clock start; a reopened
  -- case — the moment it was reopened; a new version of work closed WITHOUT an answer within
  -- the answer window — the original task's clock (received, deadlines, reaction, thresholds).
  RETURN QUERY
  WITH cand AS (
    (SELECT 'case'::text AS src, ec.id::text AS sid, ec.user_id AS client, ec.company_id AS company,
            coalesce(nullif(btrim(left(ec.title, 300)), ''), 'Обращение клиента') AS title,
            ec.id::text AS lin, ec.assignee_id AS own,
            CASE WHEN EXISTS (SELECT 1 FROM public.expert_sla_tasks c WHERE c.source = 'case' AND c.source_id = ec.id::text)
                 THEN ec.updated_at ELSE ec.created_at END AS ts,
            CASE WHEN ec.first_response_at IS NOT NULL OR ec.status = 'in_progress'
                 THEN coalesce(ec.first_response_at, ec.updated_at) END AS fr
       FROM public.expert_cases ec
      WHERE ec.status IN ('new', 'in_progress')
        AND NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks t
                         WHERE t.source = 'case' AND t.source_id = ec.id::text AND t.closed_at IS NULL)
      ORDER BY ec.created_at
      LIMIT v_limit)
    UNION ALL
    (SELECT 'report_review'::text, rv.id::text, c.user_id, rv.company_id,
            left('Отчёт на проверке: ' || coalesce(nullif(btrim(rv.title), ''), rv.report_type) || ' v' || rv.version, 300),
            rv.company_id || ':' || rv.report_type, NULL::uuid, rv.created_at, NULL::timestamptz
       FROM public.report_versions rv
       JOIN public.companies c ON c.id = rv.company_id AND c.user_id IS NOT NULL
      WHERE rv.status = 'in_review'
        AND NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks t
                         WHERE t.source = 'report_review' AND t.source_id = rv.id::text AND t.closed_at IS NULL)
      ORDER BY rv.created_at
      LIMIT v_limit)
    UNION ALL
    (SELECT 'rec_review'::text, g.company_id, c.user_id, g.company_id,
            'Рекомендации Точки Б на проверке'::text, g.company_id, NULL::uuid, g.first_at, NULL::timestamptz
       FROM (SELECT r.company_id, min(r.created_at) AS first_at
               FROM public.pb_recommendations r
              WHERE r.status = 'pending_review'
              GROUP BY r.company_id) g
       JOIN public.companies c ON c.id = g.company_id AND c.user_id IS NOT NULL
      WHERE NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks t
                         WHERE t.source = 'rec_review' AND t.source_id = g.company_id AND t.closed_at IS NULL)
      ORDER BY g.first_at
      LIMIT v_limit)
    UNION ALL
    (SELECT 'plan_review'::text, v.id::text, p.user_id, p.company_id,
            left('План Точки Б v' || v.version || ' на одобрении', 300),
            v.plan_id::text, NULL::uuid, coalesce(v.submitted_at, v.created_at), NULL::timestamptz
       FROM public.pb_plan_versions v
       JOIN public.pb_plans p ON p.id = v.plan_id
      WHERE v.status = 'in_review'
        AND NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks t
                         WHERE t.source = 'plan_review' AND t.source_id = v.id::text AND t.closed_at IS NULL)
      ORDER BY coalesce(v.submitted_at, v.created_at)
      LIMIT v_limit)
  ), pick AS (
    SELECT c.*,
           least(greatest(c.ts, v_start), v_now) AS recv,
           p.received_at AS p_recv, p.reaction_due_at AS p_react, p.answer_due_at AS p_ans,
           p.first_response_at AS p_fr, p.escalated_at AS p_esc, p.breached_at AS p_br,
           p.escalation_notified_at AS p_escn, p.breach_notified_at AS p_brn,
           CASE WHEN c.src = 'plan_review' THEN NULL
                WHEN public.expert_sla_can_hold(c.own, c.client) THEN c.own
                WHEN public.expert_sla_is_worker(ua.assignee_id) THEN ua.assignee_id END AS who,
           CASE WHEN c.src = 'plan_review' THEN NULL
                WHEN public.expert_sla_can_hold(c.own, c.client) THEN 'source'
                WHEN public.expert_sla_is_worker(ua.assignee_id) THEN 'client' END AS via
      FROM cand c
      LEFT JOIN public.user_assignments ua ON ua.user_id = c.client
      LEFT JOIN LATERAL (
        SELECT x.* FROM public.expert_sla_tasks x
         WHERE x.source = c.src AND x.lineage = c.lin
           AND x.closed_at IS NOT NULL AND x.answered IS FALSE
           AND x.closed_at >= v_now - v_window
         ORDER BY x.closed_at DESC
         LIMIT 1
      ) p ON true
  ), ins AS (
    INSERT INTO public.expert_sla_tasks AS t
      (source, source_id, client_id, company_id, title, lineage, assignee_id, assigned_at, assigned_via,
       received_at, reaction_due_at, answer_due_at, first_response_at,
       escalated_at, breached_at, escalation_notified_at, breach_notified_at, assign_notified_at)
    SELECT k.src, k.sid, k.client, k.company, k.title, k.lin,
           k.who, CASE WHEN k.who IS NOT NULL THEN v_now END, k.via,
           coalesce(k.p_recv, k.recv),
           coalesce(k.p_react, k.recv + make_interval(hours => v_react)),
           coalesce(k.p_ans, k.recv + make_interval(hours => v_answer)),
           coalesce(k.p_fr, CASE WHEN k.fr IS NOT NULL THEN least(greatest(k.fr, k.recv), v_now) END),
           k.p_esc, k.p_br, k.p_escn, k.p_brn,
           -- The case flow (assistant adapter / «Эскалации») already told the case's own assignee.
           CASE WHEN k.via = 'source' THEN v_now END
      FROM pick k
    ON CONFLICT (source, source_id) WHERE closed_at IS NULL DO NOTHING
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT i.id, 'new'::text, i.source, i.client_id, i.assignee_id, i.assigned_via FROM ins i;
END;
$$;
COMMENT ON FUNCTION public.expert_sla_sync(timestamptz, int, int, int) IS
  '145/146 (R2-B): one SLA pass — clock start on the first pass, close (answered or not), follow «Эскалации», realign with the responsible, reactions, new work (inheriting the clock of unanswered predecessors). Service role only.';

-- ─── 8. Claims (replaces 145): a breach also settles a pending escalation ────
CREATE OR REPLACE FUNCTION public.expert_sla_claim(
  p_stage TEXT,
  p_now   TIMESTAMPTZ DEFAULT now(),
  p_limit INT         DEFAULT 50
)
RETURNS SETOF public.expert_sla_tasks
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_now   TIMESTAMPTZ := coalesce(p_now, now());
  v_limit INT := greatest(1, least(coalesce(p_limit, 50), 500));
BEGIN
  IF p_stage = 'breached' THEN
    RETURN QUERY
    UPDATE public.expert_sla_tasks t
       SET breached_at = v_now,
           escalated_at = coalesce(t.escalated_at, v_now),
           escalation_notified_at = coalesce(t.escalation_notified_at, v_now)
     WHERE t.id IN (
             SELECT x.id FROM public.expert_sla_tasks x
              WHERE x.closed_at IS NULL AND x.breached_at IS NULL AND x.answer_due_at <= v_now
              ORDER BY x.answer_due_at
              LIMIT v_limit
              FOR UPDATE SKIP LOCKED)
       AND t.closed_at IS NULL AND t.breached_at IS NULL
    RETURNING t.*;
  ELSIF p_stage = 'escalated' THEN
    RETURN QUERY
    UPDATE public.expert_sla_tasks t
       SET escalated_at = v_now
     WHERE t.id IN (
             SELECT x.id FROM public.expert_sla_tasks x
              WHERE x.closed_at IS NULL AND x.escalated_at IS NULL AND x.first_response_at IS NULL
                AND x.reaction_due_at <= v_now
              ORDER BY x.reaction_due_at
              LIMIT v_limit
              FOR UPDATE SKIP LOCKED)
       AND t.closed_at IS NULL AND t.escalated_at IS NULL AND t.first_response_at IS NULL
    RETURNING t.*;
  ELSE
    RAISE EXCEPTION 'expert_sla_claim: unknown stage %', p_stage USING ERRCODE = '22023';
  END IF;
END;
$$;

-- ─── 9. Outbox marks ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expert_sla_mark_notified(
  p_ids      UUID[],
  p_kind     TEXT,
  p_ok       BOOLEAN,
  p_error    TEXT        DEFAULT NULL,
  p_assignee UUID        DEFAULT NULL,
  p_now      TIMESTAMPTZ DEFAULT now()
)
RETURNS INT
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_now  TIMESTAMPTZ := coalesce(p_now, now());
  v_info BOOLEAN := p_kind IN ('assigned', 'queued');
  v_n    INT;
BEGIN
  IF p_kind NOT IN ('assigned', 'queued', 'escalated', 'breached') THEN
    RAISE EXCEPTION 'expert_sla_mark_notified: unknown kind %', p_kind USING ERRCODE = '22023';
  END IF;
  UPDATE public.expert_sla_tasks t
     SET assign_notified_at     = CASE WHEN p_ok AND p_kind = 'assigned'  THEN v_now ELSE t.assign_notified_at END,
         queue_notified_at      = CASE WHEN p_ok AND p_kind = 'queued'    THEN v_now ELSE t.queue_notified_at END,
         escalation_notified_at = CASE WHEN p_ok AND p_kind = 'escalated' THEN v_now ELSE t.escalation_notified_at END,
         breach_notified_at     = CASE WHEN p_ok AND p_kind = 'breached'  THEN v_now ELSE t.breach_notified_at END,
         notify_attempts = CASE WHEN v_info THEN t.notify_attempts WHEN p_ok THEN 0 ELSE t.notify_attempts + 1 END,
         info_attempts   = CASE WHEN NOT v_info THEN t.info_attempts WHEN p_ok THEN 0 ELSE t.info_attempts + 1 END,
         notify_error    = CASE WHEN p_ok THEN NULL ELSE left(coalesce(p_error, 'delivery failed'), 500) END
   WHERE t.id = ANY (coalesce(p_ids, ARRAY[]::uuid[]))
     AND (p_kind <> 'assigned' OR t.assignee_id IS NOT DISTINCT FROM p_assignee);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
COMMENT ON FUNCTION public.expert_sla_mark_notified(uuid[], text, boolean, text, uuid, timestamptz) IS
  '146: outbox of expert SLA notifications — *_notified_at only after a successful delivery; a failure counts an attempt and keeps the error.';

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.expert_sla_can_hold(uuid, uuid)',
    'public.expert_sla_realign(uuid, timestamptz)',
    'public.expert_sla_sync(timestamptz, int, int, int)',
    'public.expert_sla_claim(text, timestamptz, int)',
    'public.expert_sla_mark_notified(uuid[], text, boolean, text, uuid, timestamptz)',
    'public.expert_sla_follow_assignment()',
    'public.expert_sla_tasks_reset_notified()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
