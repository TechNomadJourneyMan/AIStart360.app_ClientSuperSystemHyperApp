-- 086_agents_runtime.sql
--
-- Storage for the multi-agent runtime (docs/platform/05-agents.md, D3).
--
-- Agent *definitions* (prompt, tools, default permissions, triggers) are code
-- in lib/agents/definitions/ and are reviewed through PRs. The database holds:
--   agent_configs            runtime overrides set by admins (enable, model, schedule, budgets)
--   agent_permission_grants  per-agent ALLOW / DENY / REQUIRE_APPROVAL (code enforces a ceiling)
--   agent_tasks              durable work queue: lease, retry with backoff, dead-letter
--   agent_runs               one execution attempt: model, tokens, cost, summaries, errors
--   agent_tool_calls         every tool call with the permission decision
--   agent_approvals          human-in-the-loop decisions (admin panel or Telegram)
--   agent_events             structured agent log
--   platform_events          domain event outbox (CLIENT_CREATED, FILE_UPLOADED, …)
--
-- Everything is service-role only for writes; staff read through the admin API
-- (service role + requireGiga). Tenants can read their own runs/events summary
-- via can_read_company (no prompts, no tool arguments are exposed there).
--
-- Queue state transitions are done by SECURITY DEFINER functions so that a
-- lease is claimed atomically (FOR UPDATE SKIP LOCKED) — same pattern as the
-- omnichannel job queue (064).
--
-- Idempotent. Apply: node scripts/apply-migration.js supabase/migrations/086_agents_runtime.sql

-- ─── Config & permissions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_configs (
  agent_key           TEXT        PRIMARY KEY CHECK (agent_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
  tier_override       TEXT        CHECK (tier_override IS NULL OR tier_override IN ('light', 'standard', 'premium')),
  model_override      TEXT        CHECK (model_override IS NULL OR model_override ~ '^[a-z0-9._-]+/[a-z0-9._:-]+$'),
  schedule_cron       TEXT,
  per_run_budget_usd  NUMERIC(10,4) CHECK (per_run_budget_usd IS NULL OR per_run_budget_usd >= 0),
  daily_budget_usd    NUMERIC(10,4) CHECK (daily_budget_usd IS NULL OR daily_budget_usd >= 0),
  max_output_tokens   INTEGER     CHECK (max_output_tokens IS NULL OR max_output_tokens BETWEEN 64 AND 32000),
  settings            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_permission_grants (
  agent_key   TEXT        NOT NULL,
  permission  TEXT        NOT NULL CHECK (permission ~ '^[A-Z_]{3,40}$'),
  decision    TEXT        NOT NULL CHECK (decision IN ('ALLOW', 'DENY', 'REQUIRE_APPROVAL')),
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_key, permission)
);

-- ─── Tasks (queue) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key        TEXT        NOT NULL,
  company_id       TEXT        REFERENCES public.companies(id) ON DELETE CASCADE,  -- NULL = platform task
  session_id       UUID        REFERENCES public.diagnostic_sessions(id) ON DELETE SET NULL,
  parent_task_id   UUID        REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  trigger          TEXT        NOT NULL CHECK (trigger IN ('manual', 'event', 'schedule', 'agent', 'approval')),
  trigger_ref      TEXT,                      -- event name / cron / parent agent
  requested_by     TEXT,                      -- auth uid | 'agent:<key>' | 'system'
  input            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key  TEXT        UNIQUE,
  status           TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN
                     ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'dead', 'cancelled')),
  priority         SMALLINT    NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 9),   -- 1 = highest
  attempts         SMALLINT    NOT NULL DEFAULT 0,
  max_attempts     SMALLINT    NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  run_after        TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token      UUID,
  lease_until      TIMESTAMPTZ,
  last_error_code  TEXT,
  last_error       TEXT,
  result_summary   JSONB,
  cancelled_by     TEXT,
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_tasks_lease_consistent CHECK (
    (status = 'running') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS agent_tasks_due_idx
  ON public.agent_tasks (priority, run_after) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS agent_tasks_running_idx
  ON public.agent_tasks (lease_until) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS agent_tasks_agent_idx
  ON public.agent_tasks (agent_key, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_tasks_company_idx
  ON public.agent_tasks (company_id, created_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_tasks_session_idx
  ON public.agent_tasks (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_tasks_parent_idx
  ON public.agent_tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;

-- ─── Runs ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID        NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  agent_key        TEXT        NOT NULL,
  agent_version    TEXT        NOT NULL,
  company_id       TEXT        REFERENCES public.companies(id) ON DELETE CASCADE,
  attempt          SMALLINT    NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'succeeded', 'failed', 'awaiting_approval', 'cancelled')),
  tier             TEXT        CHECK (tier IS NULL OR tier IN ('none', 'light', 'standard', 'premium')),
  model            TEXT,                      -- last model actually used
  prompt_version   TEXT,
  input_summary    TEXT,
  output_summary   TEXT,
  tools_used       TEXT[]      NOT NULL DEFAULT '{}',
  llm_calls        INTEGER     NOT NULL DEFAULT 0,
  tokens_in        INTEGER     NOT NULL DEFAULT 0,
  tokens_out       INTEGER     NOT NULL DEFAULT 0,
  cost_usd         NUMERIC(12,6) NOT NULL DEFAULT 0,
  sources          JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{type, ref}] inputs that were read
  error_code       TEXT,
  error_message    TEXT,                      -- redacted, never a secret
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  duration_ms      INTEGER
);
CREATE INDEX IF NOT EXISTS agent_runs_task_idx    ON public.agent_runs (task_id, attempt);
CREATE INDEX IF NOT EXISTS agent_runs_agent_idx   ON public.agent_runs (agent_key, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_company_idx ON public.agent_runs (company_id, started_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_runs_day_idx     ON public.agent_runs (started_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diagnostic_findings_agent_run_fk') THEN
    ALTER TABLE public.diagnostic_findings
      ADD CONSTRAINT diagnostic_findings_agent_run_fk FOREIGN KEY (agent_run_id)
      REFERENCES public.agent_runs(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diagnostic_recommendations_agent_run_fk') THEN
    ALTER TABLE public.diagnostic_recommendations
      ADD CONSTRAINT diagnostic_recommendations_agent_run_fk FOREIGN KEY (agent_run_id)
      REFERENCES public.agent_runs(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS diagnostic_findings_run_idx
  ON public.diagnostic_findings (agent_run_id) WHERE agent_run_id IS NOT NULL;

-- ─── Tool calls (agent actions) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_tool_calls (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id           UUID        NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  seq              INTEGER     NOT NULL,
  tool             TEXT        NOT NULL,
  permission       TEXT        NOT NULL,
  decision         TEXT        NOT NULL CHECK (decision IN ('ALLOW', 'DENY', 'REQUIRE_APPROVAL')),
  status           TEXT        NOT NULL CHECK (status IN ('ok', 'error', 'denied', 'pending_approval')),
  args_redacted    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result_summary   TEXT,
  error_code       TEXT,
  approval_id      UUID,
  duration_ms      INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

-- ─── Approvals ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_approvals (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID        NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  run_id           UUID        REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  agent_key        TEXT        NOT NULL,
  company_id       TEXT        REFERENCES public.companies(id) ON DELETE CASCADE,
  tool             TEXT        NOT NULL,
  permission       TEXT        NOT NULL,
  summary          TEXT        NOT NULL,      -- human-readable "agent wants to …"
  payload          JSONB       NOT NULL,      -- exact action to execute after approval
  payload_hash     TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  decided_by       TEXT,
  decided_via      TEXT        CHECK (decided_via IS NULL OR decided_via IN ('admin', 'telegram', 'system')),
  decision_reason  TEXT,
  decided_at       TIMESTAMPTZ,
  executed_at      TIMESTAMPTZ,
  CONSTRAINT agent_approvals_decision_consistent CHECK (
    (status IN ('pending', 'expired')) OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS agent_approvals_pending_idx
  ON public.agent_approvals (requested_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS agent_approvals_task_idx ON public.agent_approvals (task_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tool_calls_approval_fk') THEN
    ALTER TABLE public.agent_tool_calls
      ADD CONSTRAINT agent_tool_calls_approval_fk FOREIGN KEY (approval_id)
      REFERENCES public.agent_approvals(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── Agent log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_events (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id     UUID        REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  run_id      UUID        REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  agent_key   TEXT        NOT NULL,
  company_id  TEXT,
  level       TEXT        NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  type        TEXT        NOT NULL,
  message     TEXT        NOT NULL,
  data        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_events_run_idx   ON public.agent_events (run_id, id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_events_task_idx  ON public.agent_events (task_id, id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_events_level_idx ON public.agent_events (created_at DESC) WHERE level IN ('warn', 'error');

-- ─── Platform event outbox ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_events (
  id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           TEXT        NOT NULL CHECK (name ~ '^[A-Z][A-Z_]{2,63}$'),
  company_id     TEXT,
  subject_type   TEXT,
  subject_id     TEXT,
  actor          TEXT,
  payload        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key     TEXT        UNIQUE,
  dispatched_at  TIMESTAMPTZ,
  dispatch_error TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_events_undispatched_idx
  ON public.platform_events (id) WHERE dispatched_at IS NULL;
CREATE INDEX IF NOT EXISTS platform_events_company_idx
  ON public.platform_events (company_id, created_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_events_name_idx
  ON public.platform_events (name, created_at DESC);

-- ─── updated_at triggers ────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_configs', 'agent_permission_grants', 'agent_tasks'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t || '_updated_at', t
    );
  END LOOP;
END $$;

-- ─── Queue functions ────────────────────────────────────────────────────────
-- Claim up to p_limit due tasks atomically. Returns the claimed rows with
-- their new lease token; callers must present it to finish the task.
CREATE OR REPLACE FUNCTION public.agent_claim_tasks(
  p_limit       INTEGER DEFAULT 5,
  p_lease_secs  INTEGER DEFAULT 300,
  p_agent_keys  TEXT[]  DEFAULT NULL
)
RETURNS SETOF public.agent_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT t.id FROM public.agent_tasks t
    WHERE t.status = 'queued'
      AND t.run_after <= now()
      AND (p_agent_keys IS NULL OR t.agent_key = ANY (p_agent_keys))
    ORDER BY t.priority, t.run_after
    LIMIT greatest(1, least(p_limit, 50))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.agent_tasks t
  SET status      = 'running',
      attempts    = t.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_until = now() + make_interval(secs => greatest(30, least(p_lease_secs, 3600))),
      started_at  = coalesce(t.started_at, now())
  FROM due
  WHERE t.id = due.id
  RETURNING t.*;
END;
$$;

-- Claim one specific task (manual "run now" / event fast path).
CREATE OR REPLACE FUNCTION public.agent_claim_task(p_task_id UUID, p_lease_secs INTEGER DEFAULT 300)
RETURNS SETOF public.agent_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.agent_tasks t
  SET status      = 'running',
      attempts    = t.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_until = now() + make_interval(secs => greatest(30, least(p_lease_secs, 3600))),
      started_at  = coalesce(t.started_at, now())
  WHERE t.id = (
    SELECT id FROM public.agent_tasks
    WHERE id = p_task_id AND status = 'queued' AND run_after <= now()
    FOR UPDATE SKIP LOCKED
  )
  RETURNING t.*;
END;
$$;

-- Finish a leased task. p_outcome: succeeded | failed | awaiting_approval | cancelled.
-- 'failed' is retried with exponential backoff (30s · 4^(attempt-1), max 1h)
-- until max_attempts, then moves to 'dead' (dead-letter). Returns the final status,
-- or NULL when the lease was lost (another worker / reaper took over).
CREATE OR REPLACE FUNCTION public.agent_finish_task(
  p_task_id     UUID,
  p_lease_token UUID,
  p_outcome     TEXT,
  p_error_code  TEXT  DEFAULT NULL,
  p_error       TEXT  DEFAULT NULL,
  p_result      JSONB DEFAULT NULL,
  p_retryable   BOOLEAN DEFAULT TRUE
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_task   public.agent_tasks;
  v_status TEXT;
BEGIN
  IF p_outcome NOT IN ('succeeded', 'failed', 'awaiting_approval', 'cancelled') THEN
    RAISE EXCEPTION 'agent_finish_task: bad outcome %', p_outcome;
  END IF;

  SELECT * INTO v_task FROM public.agent_tasks
  WHERE id = p_task_id AND status = 'running' AND lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_outcome = 'failed' THEN
    v_status := CASE WHEN p_retryable AND v_task.attempts < v_task.max_attempts THEN 'queued' ELSE 'dead' END;
  ELSE
    v_status := p_outcome;
  END IF;

  UPDATE public.agent_tasks
  SET status          = v_status,
      lease_token     = NULL,
      lease_until     = NULL,
      last_error_code = CASE WHEN p_outcome = 'failed' THEN p_error_code ELSE last_error_code END,
      last_error      = CASE WHEN p_outcome = 'failed' THEN left(p_error, 2000) ELSE last_error END,
      result_summary  = coalesce(p_result, result_summary),
      run_after       = CASE WHEN v_status = 'queued'
                          THEN now() + make_interval(secs => least(3600, 30 * power(4, greatest(v_task.attempts - 1, 0))::int))
                          ELSE run_after END,
      finished_at     = CASE WHEN v_status IN ('succeeded', 'dead', 'cancelled') THEN now() ELSE finished_at END
  WHERE id = p_task_id;

  RETURN v_status;
END;
$$;

-- Return expired leases to the queue (worker crashed / timed out). A task whose
-- attempts are exhausted goes to 'dead'. Returns the number of reaped tasks.
CREATE OR REPLACE FUNCTION public.agent_reap_expired_leases()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids UUID[];
BEGIN
  WITH expired AS (
    SELECT id FROM public.agent_tasks
    WHERE status = 'running' AND lease_until < now()
    FOR UPDATE SKIP LOCKED
  ), reaped AS (
    UPDATE public.agent_tasks t
    SET status          = CASE WHEN t.attempts < t.max_attempts THEN 'queued' ELSE 'dead' END,
        lease_token     = NULL,
        lease_until     = NULL,
        last_error_code = 'LEASE_EXPIRED',
        last_error      = 'worker did not finish before the lease expired',
        run_after       = now() + interval '30 seconds',
        finished_at     = CASE WHEN t.attempts < t.max_attempts THEN t.finished_at ELSE now() END
    FROM expired
    WHERE t.id = expired.id
    RETURNING t.id
  )
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM reaped;

  UPDATE public.agent_runs
  SET status = 'failed', error_code = 'LEASE_EXPIRED', finished_at = now(),
      duration_ms = (extract(epoch FROM now() - started_at) * 1000)::int
  WHERE task_id = ANY (v_ids) AND status = 'running';

  RETURN cardinality(v_ids);
END;
$$;

-- Expire pending approvals past their deadline; their tasks are cancelled.
CREATE OR REPLACE FUNCTION public.agent_expire_approvals()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE public.agent_approvals
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < now()
    RETURNING task_id
  )
  UPDATE public.agent_tasks t
  SET status = 'cancelled', finished_at = now(), last_error_code = 'APPROVAL_EXPIRED'
  FROM expired
  WHERE t.id = expired.task_id AND t.status = 'awaiting_approval';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.agent_claim_tasks(integer, integer, text[])',
    'public.agent_claim_task(uuid, integer)',
    'public.agent_finish_task(uuid, uuid, text, text, text, jsonb, boolean)',
    'public.agent_reap_expired_leases()',
    'public.agent_expire_approvals()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- ─── RLS ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agent_configs', 'agent_permission_grants', 'agent_tasks', 'agent_runs',
    'agent_tool_calls', 'agent_approvals', 'agent_events', 'platform_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
  END LOOP;
  -- Configuration, prompts' tool arguments, approvals and the raw outbox are staff-only
  -- (read through the admin API with the service role).
  FOREACH t IN ARRAY ARRAY['agent_configs', 'agent_permission_grants', 'agent_tool_calls', 'agent_approvals', 'platform_events'] LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- A tenant may see that agents worked on their company (status, timing, cost),
-- which is what the client-facing "AI Agents / Activity" view shows.
DROP POLICY IF EXISTS agent_tasks_tenant_select ON public.agent_tasks;
CREATE POLICY agent_tasks_tenant_select ON public.agent_tasks FOR SELECT
  USING (company_id IS NOT NULL AND public.can_read_company(company_id));

DROP POLICY IF EXISTS agent_runs_tenant_select ON public.agent_runs;
CREATE POLICY agent_runs_tenant_select ON public.agent_runs FOR SELECT
  USING (company_id IS NOT NULL AND public.can_read_company(company_id));

DROP POLICY IF EXISTS agent_events_tenant_select ON public.agent_events;
CREATE POLICY agent_events_tenant_select ON public.agent_events FOR SELECT
  USING (company_id IS NOT NULL AND level IN ('info', 'warn', 'error') AND public.can_read_company(company_id));

NOTIFY pgrst, 'reload schema';
