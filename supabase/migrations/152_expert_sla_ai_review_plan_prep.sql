-- 152_expert_sla_ai_review_plan_prep.sql
--
-- R3-SLA (Раунд 3, фаза 2). Two new sources of expert SLA work (24 h reaction /
-- 48 h answer, the rules of 145/146/149):
--
--   pa_ai_review  the AI analysis of Point A (diagnostics.ai_analysis, migration
--                 150) is ready — complete or partial — and not checked by an
--                 expert yet. Решение PO «гибрид»: the client sees the draft at
--                 once, the expert task opens at once (the pass every 5 min, and
--                 ai-analyze announces it immediately — lib/expert-sla/immediate.ts).
--                   item      the CURRENT diagnostics row (source_id = its id),
--                             lineage = the client (one analysis per client):
--                             a recalculation that brings a new row keeps the
--                             clock of the unanswered predecessor (146, п. 8);
--                   reaction  the expert SAVED corrections (ai_expert_edits —
--                             the review route records the exact time on the
--                             task; the pass marks a task whose row has edits);
--                   answer    the expert CONFIRMED the analysis
--                             (diagnostics.ai_reviewed_at → close 'reviewed');
--                   no answer the row is no longer current ('superseded'), the
--                             analysis is gone / failed with nothing to show
--                             ('failed'), the row was deleted ('gone'). While a
--                             new generation of the same row runs ('processing')
--                             the task stays open.
--                   who       expert work: the client's responsible worker, else
--                             the auto-assignment of the app (least loaded
--                             expert), else the common queue (SuperExpert).
--
--   plan_prep     the client waits for a Point B plan (lib/point-b/plan/waiting.ts:
--                 Point B access, a revenue goal, the model builds scenarios, no
--                 approved and no open version). Plans are prepared and approved
--                 by Admin / Super Admin (решение PO: экспертов на проде нет).
--                   item      the company (source_id = lineage = companies.id);
--                   opened    ONLY by the app: the rule needs the model (TypeScript)
--                             — expert_sla_plan_prep(…, p_waiting, p_dropped)
--                             gets the result of the scan of the pass;
--                   reaction  a version of the plan is opened (draft / in review);
--                   answer    a version of the plan is APPROVED ('approved');
--                   no answer the scan says the client no longer waits and no
--                             version is open: no Point B access ('no_access'),
--                             the data no longer carries a plan ('needs_data'),
--                             no revenue goal ('no_goal'); the company is gone or
--                             changed owner ('gone');
--                   who       nobody automatically (like plan_review): the common
--                             queue + a notice to Admin / Super Admin, «Взять
--                             себе» in ГИГА «SLA экспертов». Not realigned with
--                             the client's responsible.
--                   approval  (решение PO) while plan_prep is OPEN, a version sent
--                             for approval opens NO plan_review: preparation and
--                             approval are one piece of work of the same Admin /
--                             Super Admin — one 48-hour deadline, one escalation;
--                             plan_prep is answered by the approval. Without an
--                             open plan_prep (closed, or a plan started outside
--                             the queue) plan_review opens as before (145/149).
--
-- Also:
--   * CHECK of expert_sla_tasks.source is widened (old values kept);
--   * expert_sla_realign: pa_ai_review follows the client's responsible (expert
--     work), plan_prep does not (Admin / Super Admin);
--   * expert_sla_sync = the body of 149 + the branches of the new sources (close,
--     reactions, opening of pa_ai_review). Nothing of 149 is removed; one
--     condition is added to the opening of plan_review: not while the company
--     has an open plan_prep (see «approval» above);
--   * clock start of the new sources: system_settings
--     'expert_sla_clock_start_152', written on the first call (ON CONFLICT DO
--     NOTHING) — work that waited before 152 counts from that moment, not as a
--     backlog of instant escalations (the rule of 146 п. 7);
--   * new functions (SECURITY INVOKER, EXECUTE only for service_role):
--       expert_sla_ai_reviewable(text, jsonb)     — the analysis has text to check
--       expert_sla_setting_ts(text)               — a clock start as timestamptz
--       expert_sla_clock_152(timestamptz)         — the clock start of 152
--       expert_sla_open_ai_review(uuid, …)        — open pa_ai_review tasks (all,
--                                                   or one diagnostics row — the
--                                                   immediate path; it may claim
--                                                   the announcement at insert)
--       expert_sla_plan_prep(…, jsonb, jsonb, int) — open / drop plan_prep tasks
--
-- Order: after 145, 146, 149 (SLA), 150 (diagnostics review columns), 151 and
-- the Point B plan tables (125). Idempotent (CREATE OR REPLACE, the CHECK is
-- replaced only when it lacks the new values). No top-level BEGIN/COMMIT: apply
-- in one transaction —
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/152_expert_sla_ai_review_plan_prep.sql
-- Rollback: supabase/migrations/rollback/152_expert_sla_ai_review_plan_prep.down.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regprocedure('public.expert_sla_can_hold(uuid, uuid)') IS NULL
     OR to_regprocedure('public.expert_sla_mark_notified(uuid[], text, boolean, text, uuid, timestamptz)') IS NULL THEN
    RAISE EXCEPTION '152 requires 145_expert_sla_tasks, 146_expert_sla_hardening and 149_expert_sla_no_rec_review';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'diagnostics' AND column_name = 'ai_reviewed_at') THEN
    RAISE EXCEPTION '152 requires 150_point_a_ai_review (diagnostics.ai_reviewed_at)';
  END IF;
  IF to_regclass('public.pb_plans') IS NULL OR to_regclass('public.pb_plan_versions') IS NULL THEN
    RAISE EXCEPTION '152 requires the Point B plan tables (125)';
  END IF;
END $$;

-- A watcher pass that runs now must finish first; new passes wait for this commit.
LOCK TABLE public.expert_sla_tasks IN SHARE ROW EXCLUSIVE MODE;

-- ─── 1. Sources ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.expert_sla_tasks'::regclass AND c.conname = 'expert_sla_tasks_source_check';
  IF v_def IS NULL OR v_def NOT LIKE '%pa_ai_review%' OR v_def NOT LIKE '%plan_prep%' THEN
    ALTER TABLE public.expert_sla_tasks DROP CONSTRAINT IF EXISTS expert_sla_tasks_source_check;
    ALTER TABLE public.expert_sla_tasks ADD CONSTRAINT expert_sla_tasks_source_check
      CHECK (source IN ('case', 'report_review', 'rec_review', 'plan_review', 'pa_ai_review', 'plan_prep'));
  END IF;
END $$;
COMMENT ON COLUMN public.expert_sla_tasks.source IS
  '145/152: case | report_review | rec_review (history since 149) | plan_review (Admin / Super Admin) | pa_ai_review (AI analysis of Point A to confirm, 152) | plan_prep (a Point B plan to prepare — Admin / Super Admin, 152).';

-- ─── 2. Helpers ─────────────────────────────────────────────────────────────
-- The AI analysis has text an expert can check (the shape of lib/point-a/ai-review.ts
-- analysisContent; the legacy v1 narrative with strengths_text is not the analysis).
CREATE OR REPLACE FUNCTION public.expert_sla_ai_reviewable(p_status TEXT, p_analysis JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(
           coalesce(p_status, '') IN ('completed', 'failed')
       AND jsonb_typeof(p_analysis) = 'object'
       AND NOT (p_analysis ? 'strengths_text')
       AND (
            nullif(btrim(coalesce(p_analysis ->> 'executive_summary', '')), '') IS NOT NULL
         OR (jsonb_typeof(p_analysis -> 'strategic_priorities') = 'array' AND jsonb_array_length(p_analysis -> 'strategic_priorities') > 0)
         OR (jsonb_typeof(p_analysis -> 'growth_roadmap') = 'array' AND jsonb_array_length(p_analysis -> 'growth_roadmap') > 0)
         OR (jsonb_typeof(p_analysis -> 'blocks') = 'object' AND p_analysis -> 'blocks' <> '{}'::jsonb)
       ),
         false)
$$;
COMMENT ON FUNCTION public.expert_sla_ai_reviewable(text, jsonb) IS
  '152: the AI analysis of Point A has text to check (status completed, or failed with a kept partial / previous analysis).';

CREATE OR REPLACE FUNCTION public.expert_sla_setting_ts(p_key TEXT)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_raw TEXT;
BEGIN
  SELECT s.value #>> '{}' INTO v_raw FROM public.system_settings s WHERE s.key = p_key;
  IF v_raw ~ '^\d{4}-\d{2}-\d{2}' THEN
    BEGIN
      RETURN v_raw::timestamptz;
    EXCEPTION WHEN others THEN
      RETURN '-infinity';
    END;
  END IF;
  RETURN '-infinity';
END;
$$;
COMMENT ON FUNCTION public.expert_sla_setting_ts(text) IS '152: a clock start of system_settings as timestamptz (-infinity when absent / unreadable).';

CREATE OR REPLACE FUNCTION public.expert_sla_clock_152(p_now TIMESTAMPTZ DEFAULT now())
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.system_settings (key, value)
  VALUES ('expert_sla_clock_start_152', to_jsonb(coalesce(p_now, now())))
  ON CONFLICT (key) DO NOTHING;
  RETURN public.expert_sla_setting_ts('expert_sla_clock_start_152');
END;
$$;
COMMENT ON FUNCTION public.expert_sla_clock_152(timestamptz) IS
  '152: the clock start of pa_ai_review / plan_prep — written on the first call, then read.';

-- ─── 3. Realign: the AI review follows the responsible, the plan does not ──
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
       AND t.source IN ('case', 'report_review', 'rec_review', 'pa_ai_review')
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
  '146/152: open expert tasks of a client (NULL — all) follow the responsible: a worker responsible holds them, otherwise the queue; a case''s own assignee is kept while expert_sla_can_hold. 152: pa_ai_review included; plan_review / plan_prep (Admin / Super Admin) never.';

-- ─── 4. Open pa_ai_review tasks ─────────────────────────────────────────────
-- p_diagnostic NULL — every current unchecked analysis (the pass); a row id — that
-- one only (ai-analyze, immediately). p_claim / p_claim_queue: the caller
-- announces the new task itself right away — assign_notified_at / queue_notified_at
-- are set at insert so the outbox of the pass never sends it twice; on a failed
-- delivery the caller clears the mark and counts the attempt (the pass retries).
CREATE OR REPLACE FUNCTION public.expert_sla_open_ai_review(
  p_diagnostic     UUID        DEFAULT NULL,
  p_now            TIMESTAMPTZ DEFAULT now(),
  p_reaction_hours INT         DEFAULT 24,
  p_answer_hours   INT         DEFAULT 48,
  p_limit          INT         DEFAULT 200,
  p_claim          BOOLEAN     DEFAULT false,
  p_claim_queue    BOOLEAN     DEFAULT false
)
RETURNS TABLE (r_task UUID, r_change TEXT, r_source TEXT, r_client UUID, r_assignee UUID, r_via TEXT)
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_now    TIMESTAMPTZ := coalesce(p_now, now());
  v_react  INT := greatest(1, least(coalesce(p_reaction_hours, 24), 720));
  v_answer INT;
  v_limit  INT := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_start  TIMESTAMPTZ;
  v_window INTERVAL;
BEGIN
  v_answer := greatest(v_react, least(coalesce(p_answer_hours, 48), 720));
  v_window := make_interval(hours => v_answer);
  v_start := greatest(public.expert_sla_setting_ts('expert_sla_clock_start'), public.expert_sla_clock_152(v_now));

  RETURN QUERY
  WITH cand AS (
    SELECT 'pa_ai_review'::text AS src, d.id::text AS sid, d.user_id AS client, d.company_id AS company,
           CASE WHEN d.ai_status = 'failed' THEN 'Разбор ИИ Точки А (частичный) на проверке'
                ELSE 'Разбор ИИ Точки А на проверке' END AS title,
           d.user_id::text AS lin,
           coalesce(d.ai_generated_at, d.calculated_at) AS ts,
           (d.ai_expert_edits IS NOT NULL) AS edited
      FROM public.diagnostics d
     WHERE d.is_current
       AND d.ai_reviewed_at IS NULL
       AND public.expert_sla_ai_reviewable(d.ai_status, d.ai_analysis)
       AND (p_diagnostic IS NULL OR d.id = p_diagnostic)
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = d.user_id)
       AND NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks t
                        WHERE t.source = 'pa_ai_review' AND t.source_id = d.id::text AND t.closed_at IS NULL)
     ORDER BY coalesce(d.ai_generated_at, d.calculated_at)
     LIMIT v_limit
  ), pick AS (
    SELECT c.*,
           least(greatest(c.ts, v_start), v_now) AS recv,
           p.received_at AS p_recv, p.reaction_due_at AS p_react, p.answer_due_at AS p_ans,
           p.first_response_at AS p_fr, p.escalated_at AS p_esc, p.breached_at AS p_br,
           p.escalation_notified_at AS p_escn, p.breach_notified_at AS p_brn,
           CASE WHEN public.expert_sla_is_worker(ua.assignee_id) THEN ua.assignee_id END AS who
      FROM cand c
      LEFT JOIN public.user_assignments ua ON ua.user_id = c.client
      LEFT JOIN LATERAL (
        SELECT x.* FROM public.expert_sla_tasks x
         WHERE x.source = 'pa_ai_review' AND x.lineage = c.lin
           AND x.closed_at IS NOT NULL AND x.answered IS FALSE
           AND x.closed_at >= v_now - v_window
         ORDER BY x.closed_at DESC
         LIMIT 1
      ) p ON true
  ), ins AS (
    INSERT INTO public.expert_sla_tasks AS t
      (source, source_id, client_id, company_id, title, lineage, assignee_id, assigned_at, assigned_via,
       received_at, reaction_due_at, answer_due_at, first_response_at,
       escalated_at, breached_at, escalation_notified_at, breach_notified_at, assign_notified_at, queue_notified_at)
    SELECT k.src, k.sid, k.client, k.company, k.title, k.lin,
           k.who, CASE WHEN k.who IS NOT NULL THEN v_now END, CASE WHEN k.who IS NOT NULL THEN 'client' END,
           coalesce(k.p_recv, k.recv),
           coalesce(k.p_react, k.recv + make_interval(hours => v_react)),
           coalesce(k.p_ans, k.recv + make_interval(hours => v_answer)),
           coalesce(k.p_fr, CASE WHEN k.edited THEN v_now END),
           k.p_esc, k.p_br, k.p_escn, k.p_brn,
           CASE WHEN p_claim AND k.who IS NOT NULL THEN v_now END,
           CASE WHEN p_claim_queue AND k.who IS NULL THEN v_now END
      FROM pick k
    ON CONFLICT (source, source_id) WHERE closed_at IS NULL DO NOTHING
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT i.id, 'new'::text, i.source, i.client_id, i.assignee_id, i.assigned_via FROM ins i;
END;
$$;
COMMENT ON FUNCTION public.expert_sla_open_ai_review(uuid, timestamptz, int, int, int, boolean, boolean) IS
  '152: open pa_ai_review tasks — the current, unchecked AI analysis of Point A (all, or one row); the assignee is the client''s responsible worker; a new version inherits the clock of an unanswered predecessor of the client. Service role only.';

-- ─── 5. Open / drop plan_prep tasks (the scan of the app) ───────────────────
-- p_waiting  [{company, client}] — the clients the scan found waiting
--            (lib/point-b/plan/waiting.ts listClientsWaitingForPlan);
-- p_dropped  [{company, reason}] — the scan says they do not wait
--            (no_access | needs_data | no_goal). A task whose plan has an open
--            version is kept (somebody works on it); an approved version is the
--            answer — closed by expert_sla_sync.
CREATE OR REPLACE FUNCTION public.expert_sla_plan_prep(
  p_now            TIMESTAMPTZ DEFAULT now(),
  p_reaction_hours INT         DEFAULT 24,
  p_answer_hours   INT         DEFAULT 48,
  p_waiting        JSONB       DEFAULT '[]'::jsonb,
  p_dropped        JSONB       DEFAULT '[]'::jsonb,
  p_limit          INT         DEFAULT 200
)
RETURNS TABLE (r_task UUID, r_change TEXT, r_source TEXT, r_client UUID, r_assignee UUID, r_via TEXT)
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_now    TIMESTAMPTZ := coalesce(p_now, now());
  v_react  INT := greatest(1, least(coalesce(p_reaction_hours, 24), 720));
  v_answer INT;
  v_limit  INT := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_start  TIMESTAMPTZ;
  v_window INTERVAL;
BEGIN
  v_answer := greatest(v_react, least(coalesce(p_answer_hours, 48), 720));
  v_window := make_interval(hours => v_answer);
  v_start := greatest(public.expert_sla_setting_ts('expert_sla_clock_start'), public.expert_sla_clock_152(v_now));

  -- Drop first: a company the scan no longer sees waiting, nobody working on its plan.
  RETURN QUERY
  WITH d AS (
    SELECT DISTINCT ON (x.company) x.company,
           CASE WHEN x.reason IN ('no_access', 'needs_data', 'no_goal') THEN x.reason ELSE 'not_waiting' END AS reason
      FROM jsonb_to_recordset(CASE WHEN jsonb_typeof(p_dropped) = 'array' THEN p_dropped ELSE '[]'::jsonb END)
           AS x(company TEXT, reason TEXT)
     WHERE x.company IS NOT NULL
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET closed_at = greatest(v_now, t.received_at),
           close_reason = d.reason,
           answered = false
      FROM d
     WHERE t.source = 'plan_prep' AND t.closed_at IS NULL AND t.source_id = d.company
       AND NOT EXISTS (SELECT 1 FROM public.pb_plans p JOIN public.pb_plan_versions v ON v.plan_id = p.id
                        WHERE p.company_id = d.company
                          AND (v.status IN ('draft', 'in_review') OR v.approved_at IS NOT NULL))
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'closed'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  -- Open: the company is the client's, no plan version is open or approved, no open task.
  -- received_at = the moment the pass saw the client waiting (never before the clock start).
  RETURN QUERY
  WITH w AS (
    SELECT DISTINCT ON (x.company) x.company, x.client
      FROM jsonb_to_recordset(CASE WHEN jsonb_typeof(p_waiting) = 'array' THEN p_waiting ELSE '[]'::jsonb END)
           AS x(company TEXT, client UUID)
     WHERE x.company IS NOT NULL AND x.client IS NOT NULL
  ), cand AS (
    SELECT w.company, w.client
      FROM w
      JOIN public.companies c ON c.id = w.company AND c.user_id = w.client
     WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = w.client)
       AND NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks t
                        WHERE t.source = 'plan_prep' AND t.source_id = w.company AND t.closed_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.pb_plans p JOIN public.pb_plan_versions v ON v.plan_id = p.id
                        WHERE p.company_id = w.company
                          AND (v.status IN ('draft', 'in_review') OR v.approved_at IS NOT NULL))
     LIMIT v_limit
  ), pick AS (
    SELECT c.*, least(greatest(v_now, v_start), v_now) AS recv,
           p.received_at AS p_recv, p.reaction_due_at AS p_react, p.answer_due_at AS p_ans,
           p.first_response_at AS p_fr, p.escalated_at AS p_esc, p.breached_at AS p_br,
           p.escalation_notified_at AS p_escn, p.breach_notified_at AS p_brn
      FROM cand c
      LEFT JOIN LATERAL (
        SELECT x.* FROM public.expert_sla_tasks x
         WHERE x.source = 'plan_prep' AND x.lineage = c.company
           AND x.closed_at IS NOT NULL AND x.answered IS FALSE
           AND x.closed_at >= v_now - v_window
         ORDER BY x.closed_at DESC
         LIMIT 1
      ) p ON true
  ), ins AS (
    INSERT INTO public.expert_sla_tasks AS t
      (source, source_id, client_id, company_id, title, lineage,
       received_at, reaction_due_at, answer_due_at, first_response_at,
       escalated_at, breached_at, escalation_notified_at, breach_notified_at)
    SELECT 'plan_prep', k.company, k.client, k.company, 'Подготовить план Точки Б', k.company,
           coalesce(k.p_recv, k.recv),
           coalesce(k.p_react, k.recv + make_interval(hours => v_react)),
           coalesce(k.p_ans, k.recv + make_interval(hours => v_answer)),
           k.p_fr, k.p_esc, k.p_br, k.p_escn, k.p_brn
      FROM pick k
    ON CONFLICT (source, source_id) WHERE closed_at IS NULL DO NOTHING
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT i.id, 'new'::text, i.source, i.client_id, i.assignee_id, i.assigned_via FROM ins i;
END;
$$;
COMMENT ON FUNCTION public.expert_sla_plan_prep(timestamptz, int, int, jsonb, jsonb, int) IS
  '152: plan_prep tasks from the scan of the app (lib/point-b/plan/waiting.ts) — open for waiting clients (no open / approved version), drop for clients that no longer wait while nobody works on the plan. No assignee: Admin / Super Admin take it. Service role only.';

-- ─── 6. Sync = 149 + the branches of the new sources ───────────────────────
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

  -- 152: the AI analysis of Point A. Answer — the expert confirmed it (ai_reviewed_at).
  -- No answer — the row is no longer current, the analysis is gone, or nothing to check
  -- is left; a new generation of the same row ('processing') keeps the task open.
  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id::uuid AS sid FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'pa_ai_review'
  ), done AS (
    SELECT ot.id, d.ai_reviewed_at AS ts,
           CASE WHEN d.id IS NULL THEN 'gone'
                WHEN d.ai_reviewed_at IS NOT NULL THEN 'reviewed'
                WHEN NOT d.is_current THEN 'superseded'
                ELSE 'failed' END AS st
      FROM ot LEFT JOIN public.diagnostics d ON d.id = ot.sid
     WHERE d.id IS NULL
        OR d.ai_reviewed_at IS NOT NULL
        OR NOT d.is_current
        OR (coalesce(d.ai_status, 'none') <> 'processing' AND NOT public.expert_sla_ai_reviewable(d.ai_status, d.ai_analysis))
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET closed_at = least(greatest(coalesce(d.ts, v_now), t.received_at), v_now),
           close_reason = d.st,
           answered = (d.st = 'reviewed'),
           first_response_at = CASE WHEN d.st = 'reviewed'
                                    THEN coalesce(t.first_response_at, least(greatest(coalesce(d.ts, v_now), t.received_at), v_now))
                                    ELSE t.first_response_at END
      FROM done d
     WHERE t.id = d.id AND t.closed_at IS NULL
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'closed'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  -- 152: preparing the plan of Point B. Answer — a version of the plan was approved.
  -- The company deleted / given to another owner — closed without an answer ('gone');
  -- «no longer waits» comes from the scan of the app (expert_sla_plan_prep).
  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id AS cid, t.client_id, t.received_at FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'plan_prep'
  ), done AS (
    SELECT ot.id, ap.ts, (ap.ts IS NOT NULL) AS ok
      FROM ot
      LEFT JOIN public.companies c ON c.id = ot.cid
      LEFT JOIN LATERAL (
        SELECT coalesce(min(v.approved_at) FILTER (WHERE v.approved_at >= ot.received_at), max(v.approved_at)) AS ts
          FROM public.pb_plans p JOIN public.pb_plan_versions v ON v.plan_id = p.id
         WHERE p.company_id = ot.cid AND v.approved_at IS NOT NULL AND v.status IN ('approved', 'superseded')
      ) ap ON true
     WHERE ap.ts IS NOT NULL OR c.id IS NULL OR c.user_id IS DISTINCT FROM ot.client_id
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET closed_at = least(greatest(coalesce(d.ts, v_now), t.received_at), v_now),
           close_reason = CASE WHEN d.ok THEN 'approved' ELSE 'gone' END,
           answered = d.ok,
           first_response_at = CASE WHEN d.ok THEN coalesce(t.first_response_at, least(greatest(d.ts, t.received_at), v_now))
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

  -- 152: the expert started correcting the AI analysis (the review route records the
  -- exact time; this is the safety net — the moment of the pass).
  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id::uuid AS sid FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'pa_ai_review' AND t.first_response_at IS NULL
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET first_response_at = greatest(v_now, t.received_at)
      FROM ot JOIN public.diagnostics d ON d.id = ot.sid
     WHERE t.id = ot.id AND t.first_response_at IS NULL AND d.ai_expert_edits IS NOT NULL
    RETURNING t.id, t.source, t.client_id, t.assignee_id, t.assigned_via
  )
  SELECT u.id, 'reacted'::text, u.source, u.client_id, u.assignee_id, u.assigned_via FROM upd u;

  -- 152: a version of the plan was opened (a draft, or one already in review).
  RETURN QUERY
  WITH ot AS MATERIALIZED (
    SELECT t.id, t.source_id AS cid, t.received_at FROM public.expert_sla_tasks t
     WHERE t.closed_at IS NULL AND t.source = 'plan_prep' AND t.first_response_at IS NULL
  ), hit AS (
    SELECT ot.id, min(v.created_at) AS ts
      FROM ot
      JOIN public.pb_plans p ON p.company_id = ot.cid
      JOIN public.pb_plan_versions v ON v.plan_id = p.id AND v.status IN ('draft', 'in_review')
     GROUP BY ot.id
  ), upd AS (
    UPDATE public.expert_sla_tasks t
       SET first_response_at = least(greatest(h.ts, t.received_at), v_now)
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
        -- 152 (решение PO): while the plan is prepared under plan_prep, its approval is the answer of THAT task —
        -- the same Admin / Super Admin, one 48-hour deadline, one escalation. No second task for the approval.
        AND NOT EXISTS (SELECT 1 FROM public.expert_sla_tasks pp
                         WHERE pp.source = 'plan_prep' AND pp.source_id = p.company_id AND pp.closed_at IS NULL)
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

  -- 152: the AI analysis of Point A waiting for the expert (plan_prep is opened by the app's scan).
  RETURN QUERY SELECT * FROM public.expert_sla_open_ai_review(NULL, v_now, v_react, v_answer, v_limit, false, false);
END;
$$;
COMMENT ON FUNCTION public.expert_sla_sync(timestamptz, int, int, int) IS
  '145/146/149/152 (R2-B, R3-SLA): one SLA pass — clock start on the first pass, close (answered or not), follow «Эскалации», realign with the responsible, reactions, new work (inheriting the clock of unanswered predecessors). 149: Point B recommendations are not opened as SLA work. 152: the AI analysis of Point A (pa_ai_review: open / react / close) and the plan of Point B (plan_prep: react / close; opened by expert_sla_plan_prep); no plan_review while the company has an open plan_prep (PO: one deadline, one escalation). Service role only.';

-- ─── 7. Rights: service role only ───────────────────────────────────────────
DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.expert_sla_ai_reviewable(text, jsonb)',
    'public.expert_sla_setting_ts(text)',
    'public.expert_sla_clock_152(timestamptz)',
    'public.expert_sla_realign(uuid, timestamptz)',
    'public.expert_sla_open_ai_review(uuid, timestamptz, int, int, int, boolean, boolean)',
    'public.expert_sla_plan_prep(timestamptz, int, int, jsonb, jsonb, int)',
    'public.expert_sla_sync(timestamptz, int, int, int)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
