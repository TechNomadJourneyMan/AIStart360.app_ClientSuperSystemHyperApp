-- 149_expert_sla_no_rec_review.sql
-- Раунд 2 (решение PO 2026-11-14): рекомендации Точки Б создаются автоматически и
-- массово, поэтому под SLA экспертов (24 ч реакция / 48 ч ответ) они больше не
-- ставятся. Под SLA остаются: обращения клиентов, отчёты на проверке и одобрение
-- плана Точки Б (Admin / Super Admin).
--
-- Что делает:
--   1. expert_sla_sync (как в 146) больше не открывает задачи источника
--      'rec_review'. Закрытие и реакция уже открытых задач этого источника в
--      функции остаются (ничего не ломают, если таких задач нет).
--   2. Уже открытые задачи 'rec_review' закрываются: close_reason = 'excluded',
--      answered = false, без эскалаций и просрочек в будущем. Строки не удаляются.
-- CHECK источника не меняется: история с 'rec_review' остаётся валидной.
--
-- Порядок: после 145 и 146. Идемпотентна (CREATE OR REPLACE, UPDATE только открытых).
-- Откат: rollback/149_expert_sla_no_rec_review.down.sql (возвращает функцию из 146;
-- закрытые задачи не переоткрываются — следующий проход откроет новые).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.expert_sla_tasks') IS NULL THEN
    RAISE EXCEPTION '149 requires 145_expert_sla_tasks and 146_expert_sla_hardening';
  END IF;
  IF to_regprocedure('public.expert_sla_can_hold(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION '149 requires 146_expert_sla_hardening';
  END IF;
END $$;

UPDATE public.expert_sla_tasks
   SET closed_at = greatest(now(), received_at),
       close_reason = 'excluded',
       answered = false
 WHERE source = 'rec_review' AND closed_at IS NULL;

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
    -- 149: Point B recommendations (pending_review) are no longer expert SLA work (PO decision).
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
  '145/146/149 (R2-B): one SLA pass — clock start on the first pass, close (answered or not), follow «Эскалации», realign with the responsible, reactions, new work (inheriting the clock of unanswered predecessors). 149: Point B recommendations are not opened as SLA work. Service role only.';

REVOKE ALL ON FUNCTION public.expert_sla_sync(timestamptz, int, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expert_sla_sync(timestamptz, int, int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expert_sla_sync(timestamptz, int, int, int) TO service_role;

NOTIFY pgrst, 'reload schema';
