-- Durable, idempotent transactional WhatsApp notifications for myhonor.shop.
-- The public integration can access this state only through SECURITY DEFINER
-- RPCs. Provider delivery is fenced in two phases: leased work is safe to
-- retry, while an interrupted authorized send becomes delivery_unknown.

CREATE TABLE IF NOT EXISTS public.myhonor_order_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE
    CHECK (event_id ~ '^[A-Za-z0-9._:-]{8,200}$'),
  idempotency_key TEXT NOT NULL UNIQUE
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  request_hash TEXT NOT NULL
    CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  occurred_at TIMESTAMPTZ NOT NULL CHECK (isfinite(occurred_at)),
  order_id TEXT NOT NULL CHECK (length(btrim(order_id)) BETWEEN 1 AND 100),
  order_number TEXT NOT NULL
    CHECK (length(btrim(order_number)) BETWEEN 1 AND 64),
  order_status TEXT NOT NULL
    CHECK (order_status IN ('confirmed', 'shipped', 'delivered', 'cancelled')),
  status_version INTEGER NOT NULL CHECK (status_version BETWEEN 0 AND 1000000000),
  recipient_phone_e164 TEXT NOT NULL
    CHECK (recipient_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  recipient_name TEXT NOT NULL
    CHECK (length(btrim(recipient_name)) BETWEEN 1 AND 80),
  whatsapp_opt_in BOOLEAN NOT NULL CHECK (whatsapp_opt_in),
  locale TEXT NOT NULL DEFAULT 'ru'
    CHECK (locale ~ '^[a-z]{2,3}(?:_[A-Z]{2})?$'),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (
      jsonb_typeof(details) = 'object'
      AND pg_column_size(details) <= 8192
    ),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN (
      'queued', 'leased', 'authorized', 'accepted', 'sent', 'delivered',
      'read', 'failed', 'delivery_unknown'
    )),
  run_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(run_at)),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  max_attempts SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  lease_owner TEXT CHECK (
    lease_owner IS NULL OR length(btrim(lease_owner)) BETWEEN 1 AND 200
  ),
  lease_token UUID,
  lease_until TIMESTAMPTZ CHECK (lease_until IS NULL OR isfinite(lease_until)),
  authorized_at TIMESTAMPTZ CHECK (authorized_at IS NULL OR isfinite(authorized_at)),
  provider_message_id TEXT,
  provider_accepted_at TIMESTAMPTZ
    CHECK (provider_accepted_at IS NULL OR isfinite(provider_accepted_at)),
  last_error_code TEXT CHECK (
    last_error_code IS NULL
    OR last_error_code ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
  ),
  last_error_at TIMESTAMPTZ CHECK (last_error_at IS NULL OR isfinite(last_error_at)),
  completed_at TIMESTAMPTZ CHECK (completed_at IS NULL OR isfinite(completed_at)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT myhonor_order_notifications_event_key_match CHECK (
    event_id = idempotency_key
  ),
  CONSTRAINT myhonor_order_notifications_attempts_max CHECK (
    attempts <= max_attempts
  ),
  CONSTRAINT myhonor_order_notifications_lease_shape CHECK (
    (
      state IN ('leased', 'authorized')
      AND lease_owner IS NOT NULL
      AND lease_token IS NOT NULL
      AND lease_until IS NOT NULL
      AND completed_at IS NULL
    )
    OR (
      state NOT IN ('leased', 'authorized')
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_until IS NULL
    )
  ),
  CONSTRAINT myhonor_order_notifications_completion_shape CHECK (
    (
      state IN ('queued', 'leased', 'authorized')
      AND completed_at IS NULL
    )
    OR (
      state IN (
        'accepted', 'sent', 'delivered', 'read', 'failed', 'delivery_unknown'
      )
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT myhonor_order_notifications_provider_shape CHECK (
    state NOT IN ('accepted', 'sent', 'delivered', 'read')
    OR provider_message_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_myhonor_order_notifications_provider_id
  ON public.myhonor_order_notifications (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_myhonor_order_notifications_ready
  ON public.myhonor_order_notifications (run_at, created_at, id)
  WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS idx_myhonor_order_notifications_lease
  ON public.myhonor_order_notifications (lease_until, id)
  WHERE state IN ('leased', 'authorized');
CREATE INDEX IF NOT EXISTS idx_myhonor_order_notifications_order
  ON public.myhonor_order_notifications (order_id, status_version, created_at);

COMMENT ON TABLE public.myhonor_order_notifications IS
  'Idempotent myhonor.shop WhatsApp utility-template delivery queue and audit state.';
COMMENT ON COLUMN public.myhonor_order_notifications.request_hash IS
  'SHA-256 of the canonical validated request; prevents idempotency-key payload reuse.';
COMMENT ON COLUMN public.myhonor_order_notifications.authorized_at IS
  'Provider boundary fence. An interrupted authorized send is never automatically repeated.';

DROP TRIGGER IF EXISTS myhonor_order_notifications_updated_at
  ON public.myhonor_order_notifications;
CREATE TRIGGER myhonor_order_notifications_updated_at
  BEFORE UPDATE ON public.myhonor_order_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.myhonor_order_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.myhonor_order_notifications
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enqueue_myhonor_order_notification(
  p_event_id TEXT,
  p_idempotency_key TEXT,
  p_request_hash TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_order_id TEXT,
  p_order_number TEXT,
  p_order_status TEXT,
  p_status_version INTEGER,
  p_recipient_phone_e164 TEXT,
  p_recipient_name TEXT,
  p_whatsapp_opt_in BOOLEAN,
  p_locale TEXT,
  p_details JSONB,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS TABLE (
  notification_id UUID,
  notification_state TEXT,
  provider_message_id TEXT,
  run_at TIMESTAMPTZ,
  created BOOLEAN,
  conflict BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.myhonor_order_notifications%ROWTYPE;
  v_created public.myhonor_order_notifications%ROWTYPE;
BEGIN
  IF p_event_id IS NULL
     OR p_event_id !~ '^[A-Za-z0-9._:-]{8,200}$'
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$'
     OR p_event_id <> p_idempotency_key THEN
    RAISE EXCEPTION 'invalid or mismatched idempotency key'
      USING ERRCODE = '22023';
  END IF;
  IF p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid request hash' USING ERRCODE = '22023';
  END IF;
  IF p_occurred_at IS NULL OR NOT isfinite(p_occurred_at) THEN
    RAISE EXCEPTION 'invalid occurred_at' USING ERRCODE = '22023';
  END IF;
  IF p_order_id IS NULL OR length(btrim(p_order_id)) NOT BETWEEN 1 AND 100
     OR p_order_number IS NULL
     OR length(btrim(p_order_number)) NOT BETWEEN 1 AND 64
     OR p_order_status NOT IN ('confirmed', 'shipped', 'delivered', 'cancelled')
     OR p_status_version IS NULL OR p_status_version NOT BETWEEN 0 AND 1000000000 THEN
    RAISE EXCEPTION 'invalid order notification fields' USING ERRCODE = '22023';
  END IF;
  IF p_recipient_phone_e164 IS NULL
     OR p_recipient_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     OR p_recipient_name IS NULL
     OR length(btrim(p_recipient_name)) NOT BETWEEN 1 AND 80
     OR NOT COALESCE(p_whatsapp_opt_in, FALSE) THEN
    RAISE EXCEPTION 'invalid or unconsented recipient' USING ERRCODE = '22023';
  END IF;
  IF p_locale IS NULL OR p_locale !~ '^[a-z]{2,3}(?:_[A-Z]{2})?$' THEN
    RAISE EXCEPTION 'invalid locale' USING ERRCODE = '22023';
  END IF;
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR pg_column_size(p_details) > 8192 THEN
    RAISE EXCEPTION 'invalid notification details' USING ERRCODE = '22023';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid max_attempts' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  SELECT * INTO v_existing
    FROM public.myhonor_order_notifications
   WHERE idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing.id,
      v_existing.state,
      v_existing.provider_message_id,
      v_existing.run_at,
      FALSE,
      v_existing.request_hash <> p_request_hash;
    RETURN;
  END IF;

  INSERT INTO public.myhonor_order_notifications (
    event_id,
    idempotency_key,
    request_hash,
    occurred_at,
    order_id,
    order_number,
    order_status,
    status_version,
    recipient_phone_e164,
    recipient_name,
    whatsapp_opt_in,
    locale,
    details,
    max_attempts
  ) VALUES (
    p_event_id,
    p_idempotency_key,
    p_request_hash,
    p_occurred_at,
    btrim(p_order_id),
    btrim(p_order_number),
    p_order_status,
    p_status_version,
    p_recipient_phone_e164,
    btrim(p_recipient_name),
    p_whatsapp_opt_in,
    p_locale,
    p_details,
    p_max_attempts::SMALLINT
  ) RETURNING * INTO v_created;

  RETURN QUERY SELECT
    v_created.id,
    v_created.state,
    v_created.provider_message_id,
    v_created.run_at,
    TRUE,
    FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_myhonor_order_notification(
  p_notification_id UUID,
  p_owner_token TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  notification_id UUID,
  lease_token UUID,
  event_id TEXT,
  order_id TEXT,
  order_number TEXT,
  order_status TEXT,
  status_version INTEGER,
  recipient_phone_e164 TEXT,
  recipient_name TEXT,
  locale TEXT,
  details JSONB,
  attempts INTEGER,
  max_attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_row public.myhonor_order_notifications%ROWTYPE;
BEGIN
  IF p_notification_id IS NULL
     OR p_owner_token IS NULL
     OR length(btrim(p_owner_token)) NOT BETWEEN 1 AND 200
     OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION 'invalid notification claim' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
    FROM public.myhonor_order_notifications
   WHERE id = p_notification_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- A retry of the same durable Workflow is safe before authorization.
  IF v_row.state = 'leased' AND v_row.lease_owner = btrim(p_owner_token) THEN
    UPDATE public.myhonor_order_notifications
       SET lease_until = v_now + make_interval(secs => p_lease_seconds)
     WHERE id = v_row.id
     RETURNING * INTO v_row;
  ELSIF v_row.state = 'authorized'
        AND v_row.lease_owner = btrim(p_owner_token) THEN
    UPDATE public.myhonor_order_notifications
       SET state = 'delivery_unknown',
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = 'authorized_workflow_replayed',
           last_error_at = v_now,
           completed_at = v_now
     WHERE id = v_row.id;
    RETURN;
  ELSIF v_row.state = 'authorized' AND v_row.lease_until <= v_now THEN
    UPDATE public.myhonor_order_notifications
       SET state = 'delivery_unknown',
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = 'authorized_lease_expired',
           last_error_at = v_now,
           completed_at = v_now
     WHERE id = v_row.id;
    RETURN;
  ELSIF v_row.state = 'leased' AND v_row.lease_until <= v_now THEN
    UPDATE public.myhonor_order_notifications
       SET state = 'queued',
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = 'lease_expired_before_authorization',
           last_error_at = v_now,
           run_at = v_now
     WHERE id = v_row.id
     RETURNING * INTO v_row;
  END IF;

  IF v_row.state = 'leased' AND v_row.lease_owner = btrim(p_owner_token) THEN
    NULL;
  ELSIF v_row.state <> 'queued' OR v_row.run_at > v_now THEN
    RETURN;
  ELSIF v_row.attempts >= v_row.max_attempts THEN
    UPDATE public.myhonor_order_notifications
       SET state = 'failed',
           last_error_code = 'max_attempts_exhausted',
           last_error_at = v_now,
           completed_at = v_now
     WHERE id = v_row.id;
    RETURN;
  ELSE
    UPDATE public.myhonor_order_notifications
       SET state = 'leased',
           attempts = attempts + 1,
           lease_owner = btrim(p_owner_token),
           lease_token = gen_random_uuid(),
           lease_until = v_now + make_interval(secs => p_lease_seconds)
     WHERE id = v_row.id
     RETURNING * INTO v_row;
  END IF;

  RETURN QUERY SELECT
    v_row.id,
    v_row.lease_token,
    v_row.event_id,
    v_row.order_id,
    v_row.order_number,
    v_row.order_status,
    v_row.status_version,
    v_row.recipient_phone_e164,
    v_row.recipient_name,
    v_row.locale,
    v_row.details,
    v_row.attempts::INTEGER,
    v_row.max_attempts::INTEGER;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_myhonor_order_notification(
  p_notification_id UUID,
  p_lease_token UUID,
  p_owner_token TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (authorized BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RETURN QUERY SELECT FALSE, 'invalid_lease_seconds'::TEXT;
    RETURN;
  END IF;

  UPDATE public.myhonor_order_notifications
     SET state = 'authorized',
         authorized_at = v_now,
         lease_until = v_now + make_interval(secs => p_lease_seconds)
   WHERE id = p_notification_id
     AND state = 'leased'
     AND lease_token = p_lease_token
     AND lease_owner = NULLIF(btrim(p_owner_token), '')
     AND lease_until > v_now;
  IF FOUND THEN
    RETURN QUERY SELECT TRUE, 'authorized'::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE, 'authorization_fence_rejected'::TEXT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_myhonor_order_notification(
  p_notification_id UUID,
  p_lease_token UUID,
  p_owner_token TEXT,
  p_outcome TEXT,
  p_provider_message_id TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_retryable BOOLEAN DEFAULT FALSE,
  p_retry_after_seconds INTEGER DEFAULT 15
)
RETURNS TABLE (
  accepted BOOLEAN,
  notification_state TEXT,
  next_run_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_row public.myhonor_order_notifications%ROWTYPE;
  v_next_state TEXT;
  v_next_run TIMESTAMPTZ;
BEGIN
  IF p_outcome NOT IN ('accepted', 'failed', 'delivery_unknown')
     OR p_error_code IS NOT NULL
        AND p_error_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
     OR p_retry_after_seconds IS NULL
        OR p_retry_after_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'invalid notification outcome' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
    FROM public.myhonor_order_notifications
   WHERE id = p_notification_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_row.lease_token IS DISTINCT FROM p_lease_token
     OR v_row.lease_owner IS DISTINCT FROM NULLIF(btrim(p_owner_token), '')
     OR v_row.state NOT IN ('leased', 'authorized') THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_outcome IN ('accepted', 'delivery_unknown')
     AND v_row.state <> 'authorized' THEN
    RETURN QUERY SELECT FALSE, v_row.state, v_row.run_at;
    RETURN;
  END IF;
  IF p_outcome = 'accepted'
     AND (p_provider_message_id IS NULL
          OR length(btrim(p_provider_message_id)) NOT BETWEEN 1 AND 500) THEN
    RAISE EXCEPTION 'accepted outcome requires provider message id'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'failed'
     AND p_retryable
     AND v_row.state = 'authorized'
     AND v_row.attempts < v_row.max_attempts THEN
    v_next_state := 'queued';
    v_next_run := v_now + make_interval(secs => p_retry_after_seconds);
    UPDATE public.myhonor_order_notifications
       SET state = v_next_state,
           run_at = v_next_run,
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           last_error_code = COALESCE(p_error_code, 'provider_retryable_error'),
           last_error_at = v_now
     WHERE id = v_row.id;
  ELSE
    v_next_state := p_outcome;
    v_next_run := v_row.run_at;
    UPDATE public.myhonor_order_notifications
       SET state = v_next_state,
           lease_owner = NULL,
           lease_token = NULL,
           lease_until = NULL,
           provider_message_id = CASE
             WHEN p_outcome = 'accepted' THEN btrim(p_provider_message_id)
             ELSE provider_message_id
           END,
           provider_accepted_at = CASE
             WHEN p_outcome = 'accepted' THEN v_now
             ELSE provider_accepted_at
           END,
           last_error_code = CASE
             WHEN p_outcome = 'accepted' THEN NULL
             ELSE COALESCE(p_error_code, p_outcome)
           END,
           last_error_at = CASE
             WHEN p_outcome = 'accepted' THEN NULL
             ELSE v_now
           END,
           completed_at = v_now
     WHERE id = v_row.id;
  END IF;

  RETURN QUERY SELECT TRUE, v_next_state, v_next_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_myhonor_order_notification_delivery_status(
  p_provider_message_id TEXT,
  p_status TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_error_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  matched BOOLEAN,
  notification_id UUID,
  notification_state TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.myhonor_order_notifications%ROWTYPE;
  v_rank JSONB := '{"accepted":0,"sent":1,"delivered":2,"read":3,"failed":4}'::jsonb;
  v_next_state TEXT;
  v_when TIMESTAMPTZ := COALESCE(p_occurred_at, clock_timestamp());
BEGIN
  IF p_provider_message_id IS NULL OR length(btrim(p_provider_message_id)) NOT BETWEEN 1 AND 500
     OR p_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN
    RAISE EXCEPTION 'invalid delivery status' USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NOT NULL
     AND p_error_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$' THEN
    RAISE EXCEPTION 'invalid delivery error code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
    FROM public.myhonor_order_notifications
   WHERE provider_message_id = btrim(p_provider_message_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  IF v_row.state IN ('delivery_unknown', 'failed') THEN
    v_next_state := v_row.state;
  ELSIF COALESCE((v_rank ->> p_status)::INTEGER, 0)
        >= COALESCE((v_rank ->> v_row.state)::INTEGER, 0) THEN
    v_next_state := p_status;
  ELSE
    v_next_state := v_row.state;
  END IF;

  UPDATE public.myhonor_order_notifications
     SET state = v_next_state,
         completed_at = COALESCE(completed_at, v_when),
         last_error_code = CASE
           WHEN p_status = 'failed' THEN COALESCE(p_error_code, 'provider_delivery_failed')
           ELSE last_error_code
         END,
         last_error_at = CASE
           WHEN p_status = 'failed' THEN v_when
           ELSE last_error_at
         END
   WHERE id = v_row.id;

  RETURN QUERY SELECT TRUE, v_row.id, v_next_state;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_myhonor_order_notification(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER,
  TEXT, TEXT, BOOLEAN, TEXT, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_myhonor_order_notification(
  UUID, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authorize_myhonor_order_notification(
  UUID, UUID, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_myhonor_order_notification(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_myhonor_order_notification_delivery_status(
  TEXT, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_myhonor_order_notification(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER,
  TEXT, TEXT, BOOLEAN, TEXT, JSONB, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_myhonor_order_notification(
  UUID, TEXT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.authorize_myhonor_order_notification(
  UUID, UUID, TEXT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_myhonor_order_notification(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_myhonor_order_notification_delivery_status(
  TEXT, TEXT, TIMESTAMPTZ, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';
