-- 067_omnichannel_reply_quiet_window.sql
-- Atomically debounce live inbound bursts in the durable processing queue.
-- Historical force-draft jobs remain independent and are never collapsed.

ALTER TABLE public.omnichannel_settings
  ALTER COLUMN reply_delay_seconds SET DEFAULT 20;

COMMENT ON COLUMN public.omnichannel_settings.reply_delay_seconds IS
  'Durable quiet window after the latest inbound message. Zero disables it; 20 seconds is the recommended default.';

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
  v_message_status TEXT;
  v_occurred_at TIMESTAMPTZ;
  v_created_at TIMESTAMPTZ;
  v_force_draft BOOLEAN;
  v_has_newer_inbound BOOLEAN := FALSE;
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

  SELECT
    m.conversation_id,
    m.direction,
    m.channel,
    m.status,
    m.occurred_at,
    m.created_at
    INTO
      v_conversation_id,
      v_direction,
      v_channel,
      v_message_status,
      v_occurred_at,
      v_created_at
    FROM public.omnichannel_messages AS m
   WHERE m.id = p_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'message does not exist' USING ERRCODE = '23503';
  END IF;
  IF v_direction <> 'in' THEN
    RAISE EXCEPTION 'only inbound messages may be queued'
      USING ERRCODE = '22023';
  END IF;

  -- Imported history is draft-only even if a malformed caller forgets the
  -- flag. This mirrors the processor's defense-in-depth historical barrier.
  v_force_draft := p_force_draft OR v_message_status = 'imported';

  -- Serialize all debounce decisions for this conversation. Ingestion and
  -- final send authorization also lock this row, closing enqueue/send races.
  PERFORM 1
    FROM public.omnichannel_conversations AS c
   WHERE c.id = v_conversation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation does not exist' USING ERRCODE = '23503';
  END IF;

  IF NOT v_force_draft THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.omnichannel_messages AS newer
       WHERE newer.conversation_id = v_conversation_id
         AND newer.direction = 'in'
         AND (
           newer.occurred_at > v_occurred_at
           OR (
             newer.occurred_at = v_occurred_at
             AND newer.created_at > v_created_at
           )
           OR (
             newer.occurred_at = v_occurred_at
             AND newer.created_at = v_created_at
             AND newer.id > p_message_id
           )
         )
    ) INTO v_has_newer_inbound;
  END IF;

  IF p_run_at IS NOT NULL THEN
    v_effective_run_at := p_run_at;
  ELSIF v_force_draft THEN
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

  -- A newer live inbound retires only older queued live work. Leased jobs are
  -- left fenced; their processor/final send claim will observe the new tail
  -- and cancel safely. Historical drafts and unresolved `sending` rows are
  -- intentionally preserved.
  IF NOT v_force_draft AND NOT v_has_newer_inbound THEN
    WITH superseded_jobs AS (
      UPDATE public.omnichannel_processing_jobs AS j
         SET status = 'succeeded',
             lease_token = NULL,
             lease_until = NULL,
             last_error_code = 'superseded_by_newer_inbound',
             last_error_at = v_now,
             completed_at = v_now
        FROM public.omnichannel_messages AS older
       WHERE j.message_id = older.id
         AND j.conversation_id = v_conversation_id
         AND j.message_id <> p_message_id
         AND j.status = 'queued'
         AND NOT j.force_draft
         AND older.status IN ('received', 'failed', 'processing', 'superseded')
         AND (
           older.occurred_at < v_occurred_at
           OR (
             older.occurred_at = v_occurred_at
             AND older.created_at < v_created_at
           )
           OR (
             older.occurred_at = v_occurred_at
             AND older.created_at = v_created_at
             AND older.id < p_message_id
           )
         )
      RETURNING j.message_id
    )
    UPDATE public.omnichannel_messages AS m
       SET status = 'superseded',
           ai_reason = 'superseded_by_newer_message',
           processed_at = v_now
      FROM superseded_jobs AS retired
     WHERE m.id = retired.message_id
       AND m.status IN ('received', 'failed', 'processing');
  END IF;

  INSERT INTO public.omnichannel_processing_jobs AS existing (
    message_id,
    conversation_id,
    status,
    force_draft,
    run_at,
    max_attempts,
    last_error_code,
    last_error_at,
    completed_at
  )
  VALUES (
    p_message_id,
    v_conversation_id,
    CASE
      WHEN NOT v_force_draft AND v_has_newer_inbound THEN 'succeeded'
      ELSE 'queued'
    END,
    v_force_draft,
    v_effective_run_at,
    p_max_attempts::SMALLINT,
    CASE
      WHEN NOT v_force_draft AND v_has_newer_inbound
        THEN 'superseded_by_newer_inbound'
      ELSE NULL
    END,
    CASE
      WHEN NOT v_force_draft AND v_has_newer_inbound THEN v_now
      ELSE NULL
    END,
    CASE
      WHEN NOT v_force_draft AND v_has_newer_inbound THEN v_now
      ELSE NULL
    END
  )
  ON CONFLICT ON CONSTRAINT omnichannel_processing_jobs_message_id_key DO UPDATE
    SET force_draft = existing.force_draft OR EXCLUDED.force_draft,
        status = CASE
          WHEN NOT existing.force_draft
               AND NOT EXCLUDED.force_draft
               AND v_has_newer_inbound
            THEN 'succeeded'
          ELSE existing.status
        END,
        run_at = CASE
          WHEN NOT existing.force_draft AND EXCLUDED.force_draft
            THEN LEAST(existing.run_at, EXCLUDED.run_at)
          ELSE existing.run_at
        END,
        last_error_code = CASE
          WHEN NOT existing.force_draft
               AND NOT EXCLUDED.force_draft
               AND v_has_newer_inbound
            THEN 'superseded_by_newer_inbound'
          ELSE existing.last_error_code
        END,
        last_error_at = CASE
          WHEN NOT existing.force_draft
               AND NOT EXCLUDED.force_draft
               AND v_has_newer_inbound
            THEN v_now
          ELSE existing.last_error_at
        END,
        completed_at = CASE
          WHEN NOT existing.force_draft
               AND NOT EXCLUDED.force_draft
               AND v_has_newer_inbound
            THEN v_now
          ELSE existing.completed_at
        END
    WHERE existing.status = 'queued'
  RETURNING existing.* INTO v_job;

  IF NOT FOUND THEN
    SELECT j.* INTO v_job
      FROM public.omnichannel_processing_jobs AS j
     WHERE j.message_id = p_message_id;
  END IF;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'processing job could not be loaded'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_force_draft AND v_has_newer_inbound THEN
    UPDATE public.omnichannel_messages AS m
       SET status = 'superseded',
           ai_reason = 'superseded_by_newer_message',
           processed_at = v_now
     WHERE m.id = p_message_id
       AND m.status IN ('received', 'failed', 'processing');
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

REVOKE ALL ON FUNCTION public.enqueue_omnichannel_processing_job(
  UUID, BOOLEAN, TIMESTAMPTZ, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_omnichannel_processing_job(
  UUID, BOOLEAN, TIMESTAMPTZ, INTEGER
) TO service_role;

COMMENT ON FUNCTION public.enqueue_omnichannel_processing_job(
  UUID, BOOLEAN, TIMESTAMPTZ, INTEGER
) IS
  'Idempotently queues the newest live inbound after its durable quiet window, atomically retiring older queued live work while preserving historical drafts.';

-- Live customer traffic must not sit behind a large catch-up import. Keep
-- FIFO within each priority, but let a due live job overtake queued historical
-- drafts. An already leased draft is never preempted; the one-lease invariant
-- remains the hard conversation concurrency boundary.
CREATE INDEX IF NOT EXISTS idx_omnichannel_processing_jobs_ready_priority
  ON public.omnichannel_processing_jobs
    (force_draft, run_at, created_at, id)
  WHERE status = 'queued';

COMMENT ON INDEX public.idx_omnichannel_processing_jobs_ready_priority IS
  'Claims due live inbound work before historical draft backfill while retaining deterministic FIFO tie-breakers.';

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
       -- A queued live job may overtake historical drafts. Jobs of equal
       -- priority remain FIFO, and any queued live job blocks a draft in the
       -- same conversation regardless of creation order.
       AND NOT EXISTS (
         SELECT 1
           FROM public.omnichannel_processing_jobs AS earlier
          WHERE earlier.conversation_id = j.conversation_id
            AND earlier.status = 'queued'
            AND earlier.id <> j.id
            AND (
              (NOT earlier.force_draft AND j.force_draft)
              OR (
                earlier.force_draft = j.force_draft
                AND (
                  earlier.created_at < j.created_at
                  OR (
                    earlier.created_at = j.created_at
                    AND earlier.id < j.id
                  )
                )
              )
            )
       )
       -- Never preempt a worker that already owns this conversation.
       AND NOT EXISTS (
         SELECT 1
           FROM public.omnichannel_processing_jobs AS active
          WHERE active.conversation_id = j.conversation_id
            AND active.status = 'leased'
            AND active.id <> j.id
       )
     ORDER BY j.force_draft ASC, j.run_at, j.created_at, j.id
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

REVOKE ALL ON FUNCTION public.claim_omnichannel_processing_job(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_omnichannel_processing_job(INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.claim_omnichannel_processing_job(INTEGER) IS
  'Leases one due job with live-before-history priority, FIFO within each priority, and at most one active lease per conversation.';

NOTIFY pgrst, 'reload schema';
