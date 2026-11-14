-- 146_expert_sla_hardening.down.sql — ROLLBACK of migration 146 (R2-B review fixes).
--
-- NOT part of the migration sequence (scripts/test-db/setup.mjs and go-live
-- checks read only supabase/migrations/*.sql, not sub-folders).
-- Restores the state of 145 exactly: the client INSERT policy of expert_cases
-- without the default-only check (re-opens: a client picks the assignee /
-- status of his request), the staff SELECT policy with the «assigned to me»
-- branch, the 145 bodies of expert_sla_sync / expert_sla_claim, the clock
-- start written at once. Drops the realign trigger on user_assignments, the
-- outbox columns, lineage / answered and the 146 functions. Data of
-- expert_cases / user_assignments is not touched.
-- Roll the app back first (lib/expert-sla of 146 reads the outbox columns and
-- calls expert_sla_mark_notified: without them the pass logs errors and
-- delivers nothing), or switch the setting expert_sla.enabled off.
--   node scripts/apply-migration.js supabase/migrations/rollback/146_expert_sla_hardening.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ─── expert_cases: the client INSERT policy of 032/140 ───────────────────────
DROP POLICY IF EXISTS expert_cases_insert_own ON public.expert_cases;
CREATE POLICY expert_cases_insert_own ON public.expert_cases
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

-- ─── expert_sla_tasks: staff read of 145 ─────────────────────────────────────
DROP POLICY IF EXISTS expert_sla_tasks_staff_select ON public.expert_sla_tasks;
CREATE POLICY expert_sla_tasks_staff_select ON public.expert_sla_tasks
  FOR SELECT TO authenticated
  USING (
       (SELECT public.staff_sees_all_clients())
    OR client_id IN (SELECT public.staff_assigned_user_ids())
    OR (assignee_id = (SELECT auth.uid()) AND (SELECT public.is_platform_staff()))
  );

-- ─── 146 triggers and functions ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS expert_sla_follow_assignment ON public.user_assignments;
DROP FUNCTION IF EXISTS public.expert_sla_follow_assignment();
DROP TRIGGER IF EXISTS expert_sla_tasks_reset_notified ON public.expert_sla_tasks;
DROP FUNCTION IF EXISTS public.expert_sla_tasks_reset_notified();
DROP FUNCTION IF EXISTS public.expert_sla_mark_notified(uuid[], text, boolean, text, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.expert_sla_realign(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.expert_sla_can_hold(uuid, uuid);

-- ─── 146 columns ─────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.expert_sla_tasks_lineage_idx;
ALTER TABLE public.expert_sla_tasks
  DROP COLUMN IF EXISTS answered,
  DROP COLUMN IF EXISTS lineage,
  DROP COLUMN IF EXISTS assign_notified_at,
  DROP COLUMN IF EXISTS queue_notified_at,
  DROP COLUMN IF EXISTS escalation_notified_at,
  DROP COLUMN IF EXISTS breach_notified_at,
  DROP COLUMN IF EXISTS notify_attempts,
  DROP COLUMN IF EXISTS info_attempts,
  DROP COLUMN IF EXISTS notify_error;

-- ─── Clock start as 145 wrote it ─────────────────────────────────────────────
INSERT INTO public.system_settings (key, value)
VALUES ('expert_sla_clock_start', to_jsonb(now()))
ON CONFLICT (key) DO NOTHING;

-- ─── The 145 bodies (copied from 145_expert_sla_tasks.sql, sections 4–5) ─────
-- ─── 4. Sync ────────────────────────────────────────────────────────────────
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
BEGIN
  v_answer := greatest(v_react, least(coalesce(p_answer_hours, 48), 720));

  SELECT s.value #>> '{}' INTO v_raw FROM public.system_settings s WHERE s.key = 'expert_sla_clock_start';
  IF v_raw ~ '^\d{4}-\d{2}-\d{2}' THEN
    BEGIN
      v_start := v_raw::timestamptz;
    EXCEPTION WHEN others THEN
      v_start := '-infinity';
    END;
  END IF;

  -- 4.1 Close tasks whose source is done (or gone). The answer also counts as the reaction.
  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id::uuid AS sid FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'case'
  ), done AS (
    SELECT ot.id, ec.status AS st, ec.updated_at AS upd, ec.first_response_at AS fr
      FROM ot LEFT JOIN public.expert_cases ec ON ec.id = ot.sid
     WHERE ec.id IS NULL OR ec.status NOT IN ('new', 'in_progress')
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET closed_at = least(greatest(coalesce(d.upd, v_now), t.received_at), v_now),
           close_reason = coalesce(d.st, 'gone'),
           first_response_at = coalesce(t.first_response_at,
                                        least(greatest(coalesce(d.fr, d.upd, v_now), t.received_at), v_now))
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
    SELECT ot.id, rv.status AS st,
           coalesce((SELECT min(r.created_at) FROM public.report_version_reviews r WHERE r.report_version_id = ot.sid),
                    rv.published_at, rv.updated_at) AS ts
      FROM ot LEFT JOIN public.report_versions rv ON rv.id = ot.sid
     WHERE rv.id IS NULL OR rv.status <> 'in_review'
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET closed_at = least(greatest(coalesce(d.ts, v_now), t.received_at), v_now),
           close_reason = coalesce(d.st, 'gone'),
           first_response_at = coalesce(t.first_response_at, least(greatest(coalesce(d.ts, v_now), t.received_at), v_now))
      FROM done d
     WHERE t.id = d.id AND t.closed_at IS NULL
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'closed'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id::uuid AS sid FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'plan_review'
  ), done AS (
    SELECT ot.id,
           CASE WHEN v.id IS NULL THEN 'gone' WHEN v.rejected_at IS NOT NULL AND v.status = 'draft' THEN 'rejected' ELSE v.status END AS st,
           coalesce(v.approved_at, v.rejected_at) AS ts
      FROM ot LEFT JOIN public.pb_plan_versions v ON v.id = ot.sid
     WHERE v.id IS NULL OR v.status <> 'in_review'
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET closed_at = least(greatest(coalesce(d.ts, v_now), t.received_at), v_now),
           close_reason = d.st,
           first_response_at = coalesce(t.first_response_at, least(greatest(coalesce(d.ts, v_now), t.received_at), v_now))
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
           close_reason = 'reviewed',
           first_response_at = coalesce(t.first_response_at, least(greatest(coalesce(d.ts, v_now), t.received_at), v_now))
      FROM done d
     WHERE t.id = d.id AND t.closed_at IS NULL
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'closed'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  -- 4.2 Reactions of open tasks: a case taken in work, a recommendation reviewed.
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

  -- 4.3 A case re-assigned in «Эскалации» moves its task along.
  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id::uuid AS sid, t.assignee_id FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'case'
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET assignee_id = ec.assignee_id, assigned_at = v_now, assigned_via = 'source'
      FROM ot JOIN public.expert_cases ec ON ec.id = ot.sid
     WHERE t.id = ot.id
       AND ec.assignee_id IS NOT NULL
       AND ec.assignee_id IS DISTINCT FROM ot.assignee_id
       AND public.expert_sla_is_worker(ec.assignee_id)
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'reassigned'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  -- 4.4 New work. received_at: the source's moment, never before the clock start;
  -- a reopened case (it had a closed task) — the moment it was reopened.
  RETURN QUERY
  WITH src AS (
    SELECT ec.id::text AS sid, ec.user_id AS client, ec.company_id AS company, left(ec.title, 300) AS title,
           ec.assignee_id AS own,
           CASE WHEN EXISTS (SELECT 1 FROM public.expert_sla_tasks c WHERE c.source = 'case' AND c.source_id = ec.id::text)
                THEN ec.updated_at ELSE ec.created_at END AS ts,
           CASE WHEN ec.first_response_at IS NOT NULL OR ec.status = 'in_progress'
                THEN coalesce(ec.first_response_at, ec.updated_at) END AS fr
      FROM public.expert_cases ec
     WHERE ec.status IN ('new', 'in_progress')
       AND NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks t
                        WHERE t.source = 'case' AND t.source_id = ec.id::text AND t.closed_at IS NULL)
     ORDER BY ec.created_at
     LIMIT v_limit
  ), pick AS (
    SELECT s.*, ua.assignee_id AS resp,
           least(greatest(s.ts, v_start), v_now) AS recv
      FROM src s LEFT JOIN public.user_assignments ua ON ua.user_id = s.client
  ), ins AS (
    INSERT INTO public.expert_sla_tasks AS t
      (source, source_id, client_id, company_id, title, assignee_id, assigned_at, assigned_via,
       received_at, reaction_due_at, answer_due_at, first_response_at)
    SELECT 'case', p.sid, p.client, p.company, coalesce(nullif(btrim(p.title), ''), 'Обращение клиента'),
           CASE WHEN public.expert_sla_is_worker(p.own) THEN p.own
                WHEN public.expert_sla_is_worker(p.resp) THEN p.resp END,
           CASE WHEN public.expert_sla_is_worker(p.own) OR public.expert_sla_is_worker(p.resp) THEN v_now END,
           CASE WHEN public.expert_sla_is_worker(p.own) THEN 'source'
                WHEN public.expert_sla_is_worker(p.resp) THEN 'client' END,
           p.recv, p.recv + make_interval(hours => v_react), p.recv + make_interval(hours => v_answer),
           CASE WHEN p.fr IS NOT NULL THEN least(greatest(p.fr, p.recv), v_now) END
      FROM pick p
    ON CONFLICT (source, source_id) WHERE closed_at IS NULL DO NOTHING
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT i.id, 'new'::text, i.source, i.client_id, i.assignee_id, i.assigned_via FROM ins i;

  RETURN QUERY
  WITH src AS (
    SELECT rv.id::text AS sid, c.user_id AS client, rv.company_id AS company,
           left('Отчёт на проверке: ' || coalesce(nullif(btrim(rv.title), ''), rv.report_type) || ' v' || rv.version, 300) AS title,
           rv.created_at AS ts
      FROM public.report_versions rv
      JOIN public.companies c ON c.id = rv.company_id AND c.user_id IS NOT NULL
     WHERE rv.status = 'in_review'
       AND NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks t
                        WHERE t.source = 'report_review' AND t.source_id = rv.id::text AND t.closed_at IS NULL)
     ORDER BY rv.created_at
     LIMIT v_limit
  ), pick AS (
    SELECT s.*, ua.assignee_id AS resp, least(greatest(s.ts, v_start), v_now) AS recv
      FROM src s LEFT JOIN public.user_assignments ua ON ua.user_id = s.client
  ), ins AS (
    INSERT INTO public.expert_sla_tasks AS t
      (source, source_id, client_id, company_id, title, assignee_id, assigned_at, assigned_via,
       received_at, reaction_due_at, answer_due_at)
    SELECT 'report_review', p.sid, p.client, p.company, p.title,
           CASE WHEN public.expert_sla_is_worker(p.resp) THEN p.resp END,
           CASE WHEN public.expert_sla_is_worker(p.resp) THEN v_now END,
           CASE WHEN public.expert_sla_is_worker(p.resp) THEN 'client' END,
           p.recv, p.recv + make_interval(hours => v_react), p.recv + make_interval(hours => v_answer)
      FROM pick p
    ON CONFLICT (source, source_id) WHERE closed_at IS NULL DO NOTHING
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT i.id, 'new'::text, i.source, i.client_id, i.assignee_id, i.assigned_via FROM ins i;

  RETURN QUERY
  WITH grp AS (
    SELECT r.company_id, min(r.created_at) AS ts, count(*) AS n
      FROM public.pb_recommendations r
     WHERE r.status = 'pending_review'
     GROUP BY r.company_id
  ), src AS (
    SELECT g.company_id AS sid, c.user_id AS client, g.company_id AS company,
           'Рекомендации Точки Б на проверке'::text AS title, g.ts
      FROM grp g
      JOIN public.companies c ON c.id = g.company_id AND c.user_id IS NOT NULL
     WHERE NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks t
                        WHERE t.source = 'rec_review' AND t.source_id = g.company_id AND t.closed_at IS NULL)
     ORDER BY g.ts
     LIMIT v_limit
  ), pick AS (
    SELECT s.*, ua.assignee_id AS resp, least(greatest(s.ts, v_start), v_now) AS recv
      FROM src s LEFT JOIN public.user_assignments ua ON ua.user_id = s.client
  ), ins AS (
    INSERT INTO public.expert_sla_tasks AS t
      (source, source_id, client_id, company_id, title, assignee_id, assigned_at, assigned_via,
       received_at, reaction_due_at, answer_due_at)
    SELECT 'rec_review', p.sid, p.client, p.company, p.title,
           CASE WHEN public.expert_sla_is_worker(p.resp) THEN p.resp END,
           CASE WHEN public.expert_sla_is_worker(p.resp) THEN v_now END,
           CASE WHEN public.expert_sla_is_worker(p.resp) THEN 'client' END,
           p.recv, p.recv + make_interval(hours => v_react), p.recv + make_interval(hours => v_answer)
      FROM pick p
    ON CONFLICT (source, source_id) WHERE closed_at IS NULL DO NOTHING
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT i.id, 'new'::text, i.source, i.client_id, i.assignee_id, i.assigned_via FROM ins i;

  -- Plan approval: Admin / Super Admin decide (lib/expert-review/point-b.ts) — no expert assignee.
  RETURN QUERY
  WITH src AS (
    SELECT v.id::text AS sid, p.user_id AS client, p.company_id AS company,
           left('План Точки Б v' || v.version || ' на одобрении', 300) AS title,
           coalesce(v.submitted_at, v.created_at) AS ts
      FROM public.pb_plan_versions v
      JOIN public.pb_plans p ON p.id = v.plan_id
     WHERE v.status = 'in_review'
       AND NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks t
                        WHERE t.source = 'plan_review' AND t.source_id = v.id::text AND t.closed_at IS NULL)
     ORDER BY 5
     LIMIT v_limit
  ), ins AS (
    INSERT INTO public.expert_sla_tasks AS t
      (source, source_id, client_id, company_id, title, received_at, reaction_due_at, answer_due_at)
    SELECT 'plan_review', s.sid, s.client, s.company, s.title,
           least(greatest(s.ts, v_start), v_now),
           least(greatest(s.ts, v_start), v_now) + make_interval(hours => v_react),
           least(greatest(s.ts, v_start), v_now) + make_interval(hours => v_answer)
      FROM src s
    ON CONFLICT (source, source_id) WHERE closed_at IS NULL DO NOTHING
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT i.id, 'new'::text, i.source, i.client_id, i.assignee_id, i.assigned_via FROM ins i;
END;
$$;
COMMENT ON FUNCTION public.expert_sla_sync(timestamptz, int, int, int) IS
  '145 (R2-B): one SLA pass — close finished tasks, record reactions, follow case re-assignment, open tasks for new expert work. Service role only.';

-- ─── 5. Threshold claims ────────────────────────────────────────────────────
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
           escalated_at = coalesce(t.escalated_at, v_now)
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
COMMENT ON FUNCTION public.expert_sla_claim(text, timestamptz, int) IS
  '145 (R2-B): claim tasks past the reaction (escalated) or answer (breached) deadline — each row to exactly one caller. Service role only.';

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.expert_sla_sync(timestamptz, int, int, int)', 'public.expert_sla_claim(text, timestamptz, int)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
