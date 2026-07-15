-- 064_omnichannel_processing_jobs.sql
-- Durable, service-only queue for omnichannel message processing.
-- Customer message bodies deliberately remain in omnichannel_messages and are
-- never copied into this queue or its bounded diagnostic fields.

CREATE TABLE IF NOT EXISTS public.omnichannel_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL
    REFERENCES public.omnichannel_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL
    REFERENCES public.omnichannel_conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'leased', 'succeeded', 'dead')),
  force_draft BOOLEAN NOT NULL DEFAULT FALSE,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now()
    CHECK (isfinite(run_at)),
  attempts SMALLINT NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  max_attempts SMALLINT NOT NULL DEFAULT 5
    CHECK (max_attempts BETWEEN 1 AND 20),
  lease_token UUID,
  lease_until TIMESTAMPTZ
    CHECK (lease_until IS NULL OR isfinite(lease_until)),
  last_error_code TEXT
    CHECK (
      last_error_code IS NULL
      OR last_error_code ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
    ),
  last_error_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT omnichannel_processing_jobs_message_id_key UNIQUE (message_id),
  CONSTRAINT omnichannel_processing_jobs_attempts_max_check
    CHECK (attempts <= max_attempts),
  CONSTRAINT omnichannel_processing_jobs_lease_shape_check
    CHECK (
      (
        status = 'leased'
        AND lease_token IS NOT NULL
        AND lease_until IS NOT NULL
        AND completed_at IS NULL
      )
      OR (
        status <> 'leased'
        AND lease_token IS NULL
        AND lease_until IS NULL
      )
    ),
  CONSTRAINT omnichannel_processing_jobs_terminal_shape_check
    CHECK (
      (status IN ('succeeded', 'dead') AND completed_at IS NOT NULL)
      OR (status IN ('queued', 'leased') AND completed_at IS NULL)
    )
);

-- Fast global scan for the next runnable job. The immutable tie-breakers make
-- acquisition order deterministic when multiple jobs share the same run_at.
CREATE INDEX IF NOT EXISTS idx_omnichannel_processing_jobs_ready
  ON public.omnichannel_processing_jobs (run_at, created_at, id)
  WHERE status = 'queued';

-- Expired leases are recovered in a bounded SKIP LOCKED pass before claiming.
CREATE INDEX IF NOT EXISTS idx_omnichannel_processing_jobs_expired_lease
  ON public.omnichannel_processing_jobs (lease_until, id)
  WHERE status = 'leased';

-- The full FK index keeps conversation deletion/cascade bounded even after
-- most of its jobs have reached a terminal state.
CREATE INDEX IF NOT EXISTS idx_omnichannel_processing_jobs_conversation_fk
  ON public.omnichannel_processing_jobs (conversation_id);

-- Supports the smaller per-conversation head-of-line working set.
CREATE INDEX IF NOT EXISTS idx_omnichannel_processing_jobs_conversation_pending
  ON public.omnichannel_processing_jobs (conversation_id, created_at, id)
  WHERE status IN ('queued', 'leased');

-- Database invariant: at most one worker may own a conversation at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_omnichannel_processing_jobs_one_lease_per_conversation
  ON public.omnichannel_processing_jobs (conversation_id)
  WHERE status = 'leased';

COMMENT ON TABLE public.omnichannel_processing_jobs IS
  'Durable omnichannel processing queue. Contains identifiers and bounded control metadata only; never customer message text.';
COMMENT ON COLUMN public.omnichannel_processing_jobs.message_id IS
  'Idempotency key and reference to the message being processed; one job per message.';
COMMENT ON COLUMN public.omnichannel_processing_jobs.conversation_id IS
  'Denormalized conversation identifier used to serialize workers per conversation.';
COMMENT ON COLUMN public.omnichannel_processing_jobs.status IS
  'Queue state: queued, leased, succeeded, or permanently dead.';
COMMENT ON COLUMN public.omnichannel_processing_jobs.force_draft IS
  'Safety override requiring draft-only processing for this message.';
COMMENT ON COLUMN public.omnichannel_processing_jobs.run_at IS
  'Earliest time at which a queued job may be claimed; includes reply delay and retry backoff.';
COMMENT ON COLUMN public.omnichannel_processing_jobs.attempts IS
  'Number of leases issued. Incremented atomically at claim time.';
COMMENT ON COLUMN public.omnichannel_processing_jobs.max_attempts IS
  'Bounded terminal retry limit, from one through twenty attempts.';
COMMENT ON COLUMN public.omnichannel_processing_jobs.lease_token IS
  'Random fencing token required to complete or retry the current lease.';
COMMENT ON COLUMN public.omnichannel_processing_jobs.lease_until IS
  'Exclusive lease deadline; an expired lease is no longer authorized to mutate the job.';
COMMENT ON COLUMN public.omnichannel_processing_jobs.last_error_code IS
  'Bounded machine-readable code only. Exception prose and customer content are forbidden.';
COMMENT ON INDEX public.idx_omnichannel_processing_jobs_ready IS
  'Partial queue index for due queued jobs ordered by run_at.';
COMMENT ON INDEX public.idx_omnichannel_processing_jobs_expired_lease IS
  'Partial recovery index for expired worker leases.';
COMMENT ON INDEX public.idx_omnichannel_processing_jobs_conversation_fk IS
  'Full foreign-key index used by conversation cascades, including terminal jobs.';
COMMENT ON INDEX public.idx_omnichannel_processing_jobs_conversation_pending IS
  'Partial index for pending conversation ordering and FK maintenance.';
COMMENT ON INDEX public.idx_omnichannel_processing_jobs_one_lease_per_conversation IS
  'Enforces one active processing lease per conversation.';

DROP TRIGGER IF EXISTS omnichannel_processing_jobs_updated_at
  ON public.omnichannel_processing_jobs;
CREATE TRIGGER omnichannel_processing_jobs_updated_at
  BEFORE UPDATE ON public.omnichannel_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.omnichannel_processing_jobs ENABLE ROW LEVEL SECURITY;

-- Direct mutation is intentionally unavailable even to the service client;
-- all state transitions go through the fenced SECURITY DEFINER functions.
REVOKE ALL ON TABLE public.omnichannel_processing_jobs
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.omnichannel_processing_jobs
  TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_omnichannel_processing_job(
  p_message_id UUID,
  p_force_draft BOOLEAN DEFAULT FALSE,
  p_run_at TIMESTAMPTZ DEFAULT NULL,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS TABLE (
  job_id UUID,
  message_id UUID,
  conversation_id UUID,
  status TEXT,
  force_draft BOOLEAN,
  run_at TIMESTAMPTZ,
  attempts INTEGER,
  max_attempts INTEGER,
  lease_token UUID,
  lease_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id UUID;
  v_direction TEXT;
  v_channel TEXT;
  v_reply_delay_seconds INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_effective_run_at TIMESTAMPTZ;
  v_job public.omnichannel_processing_jobs%ROWTYPE;
BEGIN
  IF p_message_id IS NULL THEN
    RAISE EXCEPTION 'message_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_force_draft IS NULL THEN
    RAISE EXCEPTION 'force_draft is required' USING ERRCODE = '22004';
  END IF;
  IF p_run_at IS NOT NULL AND NOT isfinite(p_run_at) THEN
    RAISE EXCEPTION 'run_at must be finite' USING ERRCODE = '22023';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'max_attempts must be between 1 and 20'
      USING ERRCODE = '22023';
  END IF;

  SELECT m.conversation_id, m.direction, m.channel
    INTO v_conversation_id, v_direction, v_channel
    FROM public.omnichannel_messages AS m
   WHERE m.id = p_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'message does not exist' USING ERRCODE = '23503';
  END IF;
  IF v_direction <> 'in' THEN
    RAISE EXCEPTION 'only inbound messages may be queued'
      USING ERRCODE = '22023';
  END IF;

  -- A caller may choose an explicit schedule. Otherwise draft-only work is
  -- immediately available, while live work inherits the channel's current
  -- reply delay atomically from the database instead of trusting a worker's
  -- potentially stale settings snapshot.
  IF p_run_at IS NOT NULL THEN
    v_effective_run_at := p_run_at;
  ELSIF p_force_draft THEN
    v_effective_run_at := v_now;
  ELSE
    SELECT s.reply_delay_seconds
      INTO v_reply_delay_seconds
      FROM public.omnichannel_settings AS s
     WHERE s.channel = v_channel;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'channel settings do not exist' USING ERRCODE = '23503';
    END IF;

    v_effective_run_at := v_now + make_interval(
      secs => v_reply_delay_seconds
    );
  END IF;

  INSERT INTO public.omnichannel_processing_jobs AS existing (
    message_id,
    conversation_id,
    force_draft,
    run_at,
    max_attempts
  )
  VALUES (
    p_message_id,
    v_conversation_id,
    p_force_draft,
    v_effective_run_at,
    p_max_attempts::SMALLINT
  )
  ON CONFLICT ON CONSTRAINT omnichannel_processing_jobs_message_id_key DO UPDATE
    SET force_draft = existing.force_draft OR EXCLUDED.force_draft,
        run_at = CASE
          WHEN NOT existing.force_draft AND EXCLUDED.force_draft
            THEN LEAST(existing.run_at, EXCLUDED.run_at)
          ELSE existing.run_at
        END
    WHERE existing.status = 'queued'
  RETURNING existing.* INTO v_job;

  -- ON CONFLICT ... WHERE returns no row when the existing job is already
  -- leased or terminal. Return that durable row without changing its state.
  IF NOT FOUND THEN
    SELECT j.* INTO v_job
      FROM public.omnichannel_processing_jobs AS j
     WHERE j.message_id = p_message_id;
  END IF;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'processing job could not be loaded'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT
    v_job.id,
    v_job.message_id,
    v_job.conversation_id,
    v_job.status,
    v_job.force_draft,
    v_job.run_at,
    v_job.attempts::INTEGER,
    v_job.max_attempts::INTEGER,
    v_job.lease_token,
    v_job.lease_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_omnichannel_processing_job(
  p_lease_seconds INTEGER DEFAULT 180
)
RETURNS TABLE (
  job_id UUID,
  message_id UUID,
  conversation_id UUID,
  status TEXT,
  force_draft BOOLEAN,
  run_at TIMESTAMPTZ,
  attempts INTEGER,
  max_attempts INTEGER,
  lease_token UUID,
  lease_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 15 AND 900 THEN
    RAISE EXCEPTION 'lease_seconds must be between 15 and 900'
      USING ERRCODE = '22023';
  END IF;

  -- Recover a bounded set of abandoned leases without waiting for another
  -- recovery worker. Each retry gets deterministic exponential backoff; an
  -- exhausted lease becomes terminal and unblocks the next conversation job.
  WITH expired AS MATERIALIZED (
    SELECT j.id
      FROM public.omnichannel_processing_jobs AS j
     WHERE j.status = 'leased'
       AND j.lease_until <= v_now
     ORDER BY j.lease_until, j.id
     LIMIT 100
     FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE public.omnichannel_processing_jobs AS j
     SET status = CASE
           WHEN j.attempts >= j.max_attempts THEN 'dead'
           ELSE 'queued'
         END,
         run_at = CASE
           WHEN j.attempts >= j.max_attempts THEN j.run_at
           ELSE v_now + make_interval(
             secs => LEAST(
               300,
               (
                 5 * power(
                   2::NUMERIC,
                   LEAST(GREATEST(j.attempts::INTEGER - 1, 0), 6)
                 )
               )::INTEGER
             )
           )
         END,
         lease_token = NULL,
         lease_until = NULL,
         last_error_code = CASE
           WHEN j.attempts >= j.max_attempts
             THEN 'lease_expired_max_attempts'
           ELSE 'lease_expired'
         END,
         last_error_at = v_now,
         completed_at = CASE
           WHEN j.attempts >= j.max_attempts THEN v_now
           ELSE NULL
         END
    FROM expired AS e
   WHERE j.id = e.id;

  RETURN QUERY
  WITH candidate AS MATERIALIZED (
    SELECT j.id
      FROM public.omnichannel_processing_jobs AS j
     WHERE j.status = 'queued'
       AND j.run_at <= v_now
       AND j.attempts < j.max_attempts
       -- Never overtake an older non-terminal message in the conversation.
       AND NOT EXISTS (
         SELECT 1
           FROM public.omnichannel_processing_jobs AS earlier
          WHERE earlier.conversation_id = j.conversation_id
            AND earlier.status IN ('queued', 'leased')
            AND (
              earlier.created_at < j.created_at
              OR (
                earlier.created_at = j.created_at
                AND earlier.id < j.id
              )
            )
       )
       -- Also protects against a malformed state in which a newer row owns
       -- the conversation. The partial unique index is the final invariant.
       AND NOT EXISTS (
         SELECT 1
           FROM public.omnichannel_processing_jobs AS active
          WHERE active.conversation_id = j.conversation_id
            AND active.status = 'leased'
            AND active.id <> j.id
       )
     ORDER BY j.run_at, j.created_at, j.id
     LIMIT 1
     FOR UPDATE OF j SKIP LOCKED
  ), acquired AS (
    UPDATE public.omnichannel_processing_jobs AS j
       SET status = 'leased',
           attempts = j.attempts + 1,
           lease_token = gen_random_uuid(),
           lease_until = v_now + make_interval(secs => p_lease_seconds),
           completed_at = NULL
      FROM candidate AS c
     WHERE j.id = c.id
    RETURNING j.*
  )
  SELECT
    a.id,
    a.message_id,
    a.conversation_id,
    a.status,
    a.force_draft,
    a.run_at,
    a.attempts::INTEGER,
    a.max_attempts::INTEGER,
    a.lease_token,
    a.lease_until
  FROM acquired AS a;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_omnichannel_processing_job(
  p_job_id UUID,
  p_lease_token UUID
)
RETURNS TABLE (completed BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH finished AS (
    UPDATE public.omnichannel_processing_jobs AS j
       SET status = 'succeeded',
           lease_token = NULL,
           lease_until = NULL,
           completed_at = clock_timestamp()
     WHERE j.id = p_job_id
       AND j.status = 'leased'
       AND j.lease_token = p_lease_token
       AND j.lease_until > clock_timestamp()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM finished) AS completed;
$$;

CREATE OR REPLACE FUNCTION public.retry_omnichannel_processing_job(
  p_job_id UUID,
  p_lease_token UUID,
  p_error_code TEXT,
  p_retryable BOOLEAN DEFAULT TRUE,
  p_retry_after_seconds INTEGER DEFAULT NULL
)
RETURNS TABLE (
  accepted BOOLEAN,
  next_status TEXT,
  next_run_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_status TEXT;
  v_run_at TIMESTAMPTZ;
BEGIN
  IF p_job_id IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'job_id and lease_token are required'
      USING ERRCODE = '22004';
  END IF;
  IF p_error_code IS NULL
     OR p_error_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$' THEN
    RAISE EXCEPTION 'error_code must be a bounded machine-readable code'
      USING ERRCODE = '22023';
  END IF;
  IF p_retryable IS NULL THEN
    RAISE EXCEPTION 'retryable is required' USING ERRCODE = '22004';
  END IF;
  IF p_retry_after_seconds IS NOT NULL
     AND p_retry_after_seconds NOT BETWEEN 0 AND 86400 THEN
    RAISE EXCEPTION 'retry_after_seconds must be between 0 and 86400'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.omnichannel_processing_jobs AS j
     SET status = CASE
           WHEN NOT p_retryable OR j.attempts >= j.max_attempts THEN 'dead'
           ELSE 'queued'
         END,
         run_at = CASE
           WHEN NOT p_retryable OR j.attempts >= j.max_attempts THEN j.run_at
           ELSE v_now + make_interval(
             secs => COALESCE(
               p_retry_after_seconds,
               LEAST(
                 300,
                 (
                   5 * power(
                     2::NUMERIC,
                     LEAST(GREATEST(j.attempts::INTEGER - 1, 0), 6)
                   )
                 )::INTEGER
               )
             )
           )
         END,
         lease_token = NULL,
         lease_until = NULL,
         last_error_code = p_error_code,
         last_error_at = v_now,
         completed_at = CASE
           WHEN NOT p_retryable OR j.attempts >= j.max_attempts THEN v_now
           ELSE NULL
         END
   WHERE j.id = p_job_id
     AND j.status = 'leased'
     AND j.lease_token = p_lease_token
     AND j.lease_until > v_now
  RETURNING j.status, j.run_at INTO v_status, v_run_at;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, v_status, v_run_at;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_omnichannel_processing_job(
  UUID, BOOLEAN, TIMESTAMPTZ, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_omnichannel_processing_job(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_omnichannel_processing_job(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_omnichannel_processing_job(
  UUID, UUID, TEXT, BOOLEAN, INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_omnichannel_processing_job(
  UUID, BOOLEAN, TIMESTAMPTZ, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_omnichannel_processing_job(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_omnichannel_processing_job(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_omnichannel_processing_job(
  UUID, UUID, TEXT, BOOLEAN, INTEGER
) TO service_role;

COMMENT ON FUNCTION public.enqueue_omnichannel_processing_job(
  UUID, BOOLEAN, TIMESTAMPTZ, INTEGER
) IS
  'Idempotently creates one processing job per inbound message without copying message content.';
COMMENT ON FUNCTION public.claim_omnichannel_processing_job(INTEGER) IS
  'Recovers stale leases, then atomically claims one due conversation head using SKIP LOCKED and a fencing token.';
COMMENT ON FUNCTION public.complete_omnichannel_processing_job(UUID, UUID) IS
  'Completes only a live lease whose fencing token still matches.';
COMMENT ON FUNCTION public.retry_omnichannel_processing_job(
  UUID, UUID, TEXT, BOOLEAN, INTEGER
) IS
  'Requeues a live fenced lease with bounded backoff or marks it dead at the retry limit.';

NOTIFY pgrst, 'reload schema';
