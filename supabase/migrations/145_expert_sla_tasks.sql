-- 145_expert_sla_tasks.sql
--
-- R2-B: работа экспертов с SLA (решение PO: экспертов 1–2; эксперт отвечает
-- клиенту за 48 ч; нет реакции за 24 ч — эскалация). Tests:
-- tests/integration/db/expert-sla.test.ts.
--
-- Before: an expert's work arrived in four places, none with an SLA clock that
-- ran by itself — expert_cases (assistant escalations, «Позвать эксперта» from
-- the bot, manual) had sla_due_at by priority but nothing reacted to it;
-- report_versions in_review (103), pb_recommendations pending_review (129) and
-- pb_plan_versions in_review (125) had no deadline at all. Nobody was told when
-- a task waited for a day.
--
-- After:
--   * public.expert_sla_tasks — ONE ledger row per piece of expert work:
--       source        'case' (expert_cases), 'report_review' (report_versions
--                     in_review), 'rec_review' (pending recommendations of a
--                     company, grouped: source_id = company id), 'plan_review'
--                     (pb_plan_versions in_review — Admin / Super Admin approve);
--       received_at   when the work arrived (never before the SLA clock start,
--                     see below), reaction_due_at / answer_due_at = received_at
--                     + the reaction / answer hours of the setting expert_sla
--                     (24 / 48 by default);
--       first_response_at, closed_at — reaction and answer, filled from the
--                     source by expert_sla_sync();
--       escalated_at  the 24-hour escalation was CLAIMED (notified once);
--       breached_at   the 48-hour breach was CLAIMED (notified once).
--     At most one OPEN row per source item (partial unique index).
--   * public.expert_sla_is_worker(uuid) — who may hold expert work: approved
--     profile with role 'expert', or a staff_roles super_admin / admin /
--     super_expert. Keep in sync with lib/expert-sla/assign.ts (SLA_WORKER_STAFF).
--   * public.expert_sla_sync(now, reaction_h, answer_h, limit) — one pass:
--     close rows whose source is done, record reactions, follow a manual
--     re-assignment of a case, open rows for new source items (assignee: the
--     case's own assignee, else the client's responsible from user_assignments,
--     when they are a worker; plan_review — nobody, the approval queue).
--     Returns what changed; the app auto-assigns and notifies.
--   * public.expert_sla_claim(stage, now, limit) — atomically take the tasks
--     past a threshold ('escalated': no reaction by reaction_due_at; 'breached':
--     not answered by answer_due_at). A row is returned to exactly ONE caller:
--     UPDATE … WHERE escalated_at / breached_at IS NULL with SKIP LOCKED. A
--     breach also sets escalated_at (one message, not two, for a backlog).
--   * system_settings 'expert_sla_clock_start' — the moment the mechanism
--     started; work that arrived earlier gets received_at = this moment (the
--     promise did not exist before). Written once (ON CONFLICT DO NOTHING).
--
-- RLS (rules of 140 / 143): the client reads his own rows; staff / experts read
-- rows within their client scope (staff_sees_all_clients(),
-- staff_assigned_user_ids()) and rows assigned to them while they are platform
-- staff (is_platform_staff() — gated by staff_session_ok() since 143). Writes:
-- server only (service role). The two functions: service role only.
--
-- Idempotent (IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS).
-- Rollback: supabase/migrations/rollback/145_expert_sla_tasks.down.sql
-- Apply AFTER 140 and 143:
--   node scripts/apply-migration.js supabase/migrations/145_expert_sla_tasks.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regprocedure('public.staff_session_ok()') IS NULL THEN
    RAISE EXCEPTION '145: apply 140_staff_rls_from_staff_roles.sql and 143_staff_mfa_sessions.sql first';
  END IF;
END $$;

-- ─── 1. Ledger ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expert_sla_tasks (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source             TEXT        NOT NULL
                     CHECK (source IN ('case', 'report_review', 'rec_review', 'plan_review')),
  source_id          TEXT        NOT NULL CHECK (length(source_id) BETWEEN 1 AND 100),
  client_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id         TEXT        REFERENCES public.companies(id) ON DELETE SET NULL,
  title              TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  assignee_id        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at        TIMESTAMPTZ,
  assigned_via       TEXT        CHECK (assigned_via IS NULL OR assigned_via IN ('source', 'client', 'auto', 'manual')),
  received_at        TIMESTAMPTZ NOT NULL,
  reaction_due_at    TIMESTAMPTZ NOT NULL,
  answer_due_at      TIMESTAMPTZ NOT NULL,
  first_response_at  TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  close_reason       TEXT        CHECK (close_reason IS NULL OR length(close_reason) <= 100),
  escalated_at       TIMESTAMPTZ,
  breached_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expert_sla_tasks_due_order CHECK (received_at <= reaction_due_at AND reaction_due_at <= answer_due_at)
);
COMMENT ON TABLE public.expert_sla_tasks IS
  '145 (R2-B): SLA ledger of expert work — reaction (24 h) and answer (48 h) clocks per expert case / report / recommendations / plan on review. Written by the server only (expert_sla_sync / expert_sla_claim / app).';
COMMENT ON COLUMN public.expert_sla_tasks.escalated_at IS 'The no-reaction escalation (SuperExpert + Admin) was claimed and sent once.';
COMMENT ON COLUMN public.expert_sla_tasks.breached_at IS 'The answer deadline passed; the breach notification was claimed and sent once.';

-- One OPEN task per source item; a closed one may be followed by a new one (a reopened case).
CREATE UNIQUE INDEX IF NOT EXISTS expert_sla_tasks_open_source_uidx
  ON public.expert_sla_tasks (source, source_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS expert_sla_tasks_assignee_open_idx
  ON public.expert_sla_tasks (assignee_id, answer_due_at) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS expert_sla_tasks_open_due_idx
  ON public.expert_sla_tasks (answer_due_at) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS expert_sla_tasks_client_idx
  ON public.expert_sla_tasks (client_id, received_at DESC);
CREATE INDEX IF NOT EXISTS expert_sla_tasks_source_idx
  ON public.expert_sla_tasks (source, source_id);

DROP TRIGGER IF EXISTS expert_sla_tasks_updated_at ON public.expert_sla_tasks;
CREATE TRIGGER expert_sla_tasks_updated_at
  BEFORE UPDATE ON public.expert_sla_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.expert_sla_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expert_sla_tasks FROM PUBLIC;
REVOKE ALL ON public.expert_sla_tasks FROM anon, authenticated;
GRANT SELECT ON public.expert_sla_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_sla_tasks TO service_role;

DROP POLICY IF EXISTS expert_sla_tasks_client_select ON public.expert_sla_tasks;
CREATE POLICY expert_sla_tasks_client_select ON public.expert_sla_tasks
  FOR SELECT TO authenticated
  USING (client_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS expert_sla_tasks_staff_select ON public.expert_sla_tasks;
CREATE POLICY expert_sla_tasks_staff_select ON public.expert_sla_tasks
  FOR SELECT TO authenticated
  USING (
       (SELECT public.staff_sees_all_clients())
    OR client_id IN (SELECT public.staff_assigned_user_ids())
    OR (assignee_id = (SELECT auth.uid()) AND (SELECT public.is_platform_staff()))
  );

-- ─── 2. Clock start ─────────────────────────────────────────────────────────
INSERT INTO public.system_settings (key, value)
VALUES ('expert_sla_clock_start', to_jsonb(now()))
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Who may hold expert work ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expert_sla_is_worker(p_user UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_user
       AND p.status = 'approved'
       AND (
            p.role = 'expert'
         OR EXISTS (SELECT 1 FROM public.staff_roles s
                     WHERE s.user_id = p.id AND s.role IN ('super_admin', 'admin', 'super_expert'))
       )
  )
$$;
COMMENT ON FUNCTION public.expert_sla_is_worker(uuid) IS
  '145: approved expert, or approved staff super_admin / admin / super_expert — may hold expert SLA work. Same list as lib/expert-sla/assign.ts.';

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
  FOREACH f IN ARRAY ARRAY[
    'public.expert_sla_is_worker(uuid)',
    'public.expert_sla_sync(timestamptz, int, int, int)',
    'public.expert_sla_claim(text, timestamptz, int)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
