-- 066_omnichannel_outbound_deliveries.sql
-- Durable pull-based WhatsApp Web delivery. Customer text lives once in the
-- protected payload table; the lease/fencing queue contains control data only.

CREATE TABLE IF NOT EXISTS public.omnichannel_outbound_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL
    REFERENCES public.omnichannel_conversations(id) ON DELETE CASCADE,
  source_inbound_message_id UUID
    REFERENCES public.omnichannel_messages(id) ON DELETE SET NULL,
  actor TEXT NOT NULL CHECK (actor IN ('automated', 'manual')),
  text TEXT CHECK (text IS NULL OR (length(btrim(text)) BETWEEN 1 AND 4096)),
  reply_to_external_id TEXT,
  message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'button', 'interactive')),
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  finalization JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(finalization) = 'object'),
  typing_delay_ms INTEGER NOT NULL DEFAULT 0
    CHECK (typing_delay_ms BETWEEN 0 AND 15000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.omnichannel_outbound_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload_id UUID NOT NULL UNIQUE
    REFERENCES public.omnichannel_outbound_payloads(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL
    REFERENCES public.omnichannel_conversations(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL
    CHECK (session_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  idempotency_key TEXT NOT NULL UNIQUE
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  payload_hash TEXT NOT NULL
    CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'leased', 'authorized', 'sent', 'cancelled',
      'delivery_unknown', 'dead'
    )),
  run_at TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(run_at)),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts SMALLINT NOT NULL DEFAULT 20
    CHECK (max_attempts BETWEEN 1 AND 50),
  lease_token UUID,
  lease_until TIMESTAMPTZ
    CHECK (lease_until IS NULL OR isfinite(lease_until)),
  provider_message_id TEXT,
  last_error_code TEXT CHECK (
    last_error_code IS NULL
    OR last_error_code ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
  ),
  last_error_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT omnichannel_outbound_deliveries_attempts_max_check
    CHECK (attempts <= max_attempts),
  CONSTRAINT omnichannel_outbound_deliveries_lease_shape_check CHECK (
    (
      status IN ('leased', 'authorized')
      AND lease_token IS NOT NULL
      AND lease_until IS NOT NULL
      AND completed_at IS NULL
    )
    OR (
      status NOT IN ('leased', 'authorized')
      AND lease_token IS NULL
      AND lease_until IS NULL
    )
  ),
  CONSTRAINT omnichannel_outbound_deliveries_terminal_shape_check CHECK (
    (
      status IN ('sent', 'cancelled', 'delivery_unknown', 'dead')
      AND completed_at IS NOT NULL
    )
    OR (
      status IN ('queued', 'leased', 'authorized')
      AND completed_at IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_omnichannel_outbound_deliveries_ready
  ON public.omnichannel_outbound_deliveries (session_id, run_at, created_at, id)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_omnichannel_outbound_deliveries_expired
  ON public.omnichannel_outbound_deliveries (lease_until, id)
  WHERE status IN ('leased', 'authorized');
CREATE INDEX IF NOT EXISTS idx_omnichannel_outbound_deliveries_conversation
  ON public.omnichannel_outbound_deliveries (conversation_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_omnichannel_outbound_one_active_conversation
  ON public.omnichannel_outbound_deliveries (conversation_id)
  WHERE status IN ('leased', 'authorized');

COMMENT ON TABLE public.omnichannel_outbound_payloads IS
  'Canonical protected payload for a pull-based outbound delivery. Not an AI history row and not directly readable by application roles.';
COMMENT ON TABLE public.omnichannel_outbound_deliveries IS
  'RPC-only WhatsApp Web delivery queue containing control metadata and hashes only; never customer or reply text.';
COMMENT ON COLUMN public.omnichannel_outbound_deliveries.payload_hash IS
  'SHA-256 of the canonical payload, used to reject idempotency-key reuse with different content.';
COMMENT ON COLUMN public.omnichannel_outbound_deliveries.lease_token IS
  'Fencing token required by authorization and result reporting.';

DROP TRIGGER IF EXISTS omnichannel_outbound_payloads_updated_at
  ON public.omnichannel_outbound_payloads;
CREATE TRIGGER omnichannel_outbound_payloads_updated_at
  BEFORE UPDATE ON public.omnichannel_outbound_payloads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS omnichannel_outbound_deliveries_updated_at
  ON public.omnichannel_outbound_deliveries;
CREATE TRIGGER omnichannel_outbound_deliveries_updated_at
  BEFORE UPDATE ON public.omnichannel_outbound_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.omnichannel_outbound_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_outbound_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.omnichannel_outbound_payloads
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.omnichannel_outbound_deliveries
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enqueue_omnichannel_outbound_delivery(
  p_conversation_id UUID,
  p_source_inbound_message_id UUID,
  p_session_id TEXT,
  p_idempotency_key TEXT,
  p_text TEXT,
  p_reply_to_external_id TEXT,
  p_actor TEXT,
  p_ai_generated BOOLEAN,
  p_message_type TEXT,
  p_metadata JSONB,
  p_finalization JSONB,
  p_typing_delay_ms INTEGER DEFAULT 0,
  p_max_attempts INTEGER DEFAULT 20
)
RETURNS TABLE (
  delivery_id UUID,
  delivery_status TEXT,
  idempotency_key TEXT,
  created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation public.omnichannel_conversations%ROWTYPE;
  v_source public.omnichannel_messages%ROWTYPE;
  v_payload public.omnichannel_outbound_payloads%ROWTYPE;
  v_existing RECORD;
  v_delivery public.omnichannel_outbound_deliveries%ROWTYPE;
  v_hash TEXT;
BEGIN
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_session_id IS NULL OR p_session_id !~ '^[A-Za-z0-9._-]{1,64}$' THEN
    RAISE EXCEPTION 'invalid session_id' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$' THEN
    RAISE EXCEPTION 'invalid idempotency_key' USING ERRCODE = '22023';
  END IF;
  IF p_text IS NULL OR length(btrim(p_text)) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'invalid outbound text' USING ERRCODE = '22023';
  END IF;
  IF p_actor NOT IN ('automated', 'manual') THEN
    RAISE EXCEPTION 'invalid outbound actor' USING ERRCODE = '22023';
  END IF;
  IF p_ai_generated IS NULL OR (p_actor = 'manual' AND p_ai_generated) THEN
    RAISE EXCEPTION 'invalid ai_generated flag' USING ERRCODE = '22023';
  END IF;
  IF p_message_type NOT IN ('text', 'button', 'interactive') THEN
    RAISE EXCEPTION 'invalid message_type' USING ERRCODE = '22023';
  END IF;
  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object'
     OR pg_column_size(p_metadata) > 32768 THEN
    RAISE EXCEPTION 'invalid outbound metadata' USING ERRCODE = '22023';
  END IF;
  IF p_finalization IS NULL OR jsonb_typeof(p_finalization) <> 'object'
     OR pg_column_size(p_finalization) > 16384
     OR p_finalization ->> 'kind' NOT IN ('auto', 'equipment', 'manual') THEN
    RAISE EXCEPTION 'invalid outbound finalization' USING ERRCODE = '22023';
  END IF;
  IF (p_actor = 'manual' AND p_finalization ->> 'kind' <> 'manual')
     OR (p_actor = 'automated'
         AND p_finalization ->> 'kind' NOT IN ('auto', 'equipment')) THEN
    RAISE EXCEPTION 'outbound finalization does not match actor'
      USING ERRCODE = '22023';
  END IF;
  IF p_typing_delay_ms IS NULL OR p_typing_delay_ms NOT BETWEEN 0 AND 15000 THEN
    RAISE EXCEPTION 'invalid typing_delay_ms' USING ERRCODE = '22023';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid max_attempts' USING ERRCODE = '22023';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'conversation_id', p_conversation_id,
    'source_inbound_message_id', p_source_inbound_message_id,
    'session_id', p_session_id,
    'text', btrim(p_text),
    'reply_to_external_id', p_reply_to_external_id,
    'actor', p_actor,
    'ai_generated', p_ai_generated,
    'message_type', p_message_type,
    'metadata', p_metadata,
    'finalization', p_finalization,
    'typing_delay_ms', p_typing_delay_ms
  )::text, 'UTF8')), 'hex');

  -- Serialize equal idempotency keys before checking/inserting. The unique
  -- constraint remains the final invariant; the lock avoids orphan payloads.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  SELECT d.*, p.text AS existing_text
    INTO v_existing
    FROM public.omnichannel_outbound_deliveries AS d
    JOIN public.omnichannel_outbound_payloads AS p ON p.id = d.payload_id
   WHERE d.idempotency_key = p_idempotency_key
   FOR UPDATE OF d, p;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'idempotency key payload conflict'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT
      v_existing.id::UUID,
      v_existing.status::TEXT,
      v_existing.idempotency_key::TEXT,
      FALSE;
    RETURN;
  END IF;

  -- New work takes the same conversation/source lock order as authorization.
  -- Duplicate work returned above never holds a conversation lock while
  -- waiting on a delivery row, avoiding a cross-order deadlock.
  SELECT * INTO v_conversation
    FROM public.omnichannel_conversations
   WHERE id = p_conversation_id
   FOR SHARE;
  IF NOT FOUND
     OR v_conversation.channel <> 'whatsapp'
     OR v_conversation.account_external_id <> 'waweb:' || p_session_id THEN
    RAISE EXCEPTION 'conversation does not belong to the Web session'
      USING ERRCODE = '22023';
  END IF;
  IF v_conversation.external_id !~ '^[A-Za-z0-9._:-]+@(s\.whatsapp\.net|lid)$' THEN
    RAISE EXCEPTION 'conversation has an invalid recipient'
      USING ERRCODE = '22023';
  END IF;
  IF v_conversation.send_suppressed THEN
    RAISE EXCEPTION 'conversation sends are suppressed'
      USING ERRCODE = '55000';
  END IF;

  IF p_source_inbound_message_id IS NOT NULL THEN
    SELECT * INTO v_source
      FROM public.omnichannel_messages
     WHERE id = p_source_inbound_message_id
     FOR SHARE;
    IF NOT FOUND OR v_source.conversation_id <> p_conversation_id
       OR v_source.direction <> 'in' THEN
      RAISE EXCEPTION 'invalid source inbound message'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'outbound delivery requires a source inbound message'
      USING ERRCODE = '22004';
  END IF;

  INSERT INTO public.omnichannel_outbound_payloads (
    conversation_id,
    source_inbound_message_id,
    actor,
    text,
    reply_to_external_id,
    message_type,
    ai_generated,
    metadata,
    finalization,
    typing_delay_ms
  ) VALUES (
    p_conversation_id,
    p_source_inbound_message_id,
    p_actor,
    btrim(p_text),
    p_reply_to_external_id,
    p_message_type,
    p_ai_generated,
    p_metadata,
    p_finalization,
    p_typing_delay_ms
  ) RETURNING * INTO v_payload;

  INSERT INTO public.omnichannel_outbound_deliveries (
    payload_id,
    conversation_id,
    session_id,
    idempotency_key,
    payload_hash,
    max_attempts
  ) VALUES (
    v_payload.id,
    p_conversation_id,
    p_session_id,
    p_idempotency_key,
    v_hash,
    p_max_attempts::SMALLINT
  ) RETURNING * INTO v_delivery;

  -- Lets a reclaimed upstream processing job recognize that durable delivery
  -- already owns this automated send. It can complete without re-running the
  -- provider path or falsely treating a merely queued reply as ambiguous.
  IF p_actor = 'automated' THEN
    UPDATE public.omnichannel_messages
       SET metadata = metadata || jsonb_build_object(
         'outboundDeliveryId', v_delivery.id,
         'outboundDeliveryQueuedAt', clock_timestamp()
       )
     WHERE id = p_source_inbound_message_id
       AND direction = 'in';
  END IF;

  RETURN QUERY SELECT
    v_delivery.id,
    v_delivery.status,
    v_delivery.idempotency_key,
    TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.reap_omnichannel_outbound_deliveries(
  p_session_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (requeued INTEGER, delivery_unknown INTEGER, dead INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_expired RECORD;
  v_requeued INTEGER := 0;
  v_unknown INTEGER := 0;
  v_dead INTEGER := 0;
BEGIN
  IF p_session_id IS NOT NULL
     AND p_session_id !~ '^[A-Za-z0-9._-]{1,64}$' THEN
    RAISE EXCEPTION 'invalid session_id' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid reap limit' USING ERRCODE = '22023';
  END IF;

  FOR v_expired IN
    SELECT d.id, d.status, d.attempts, d.max_attempts,
           p.source_inbound_message_id, d.conversation_id
      FROM public.omnichannel_outbound_deliveries AS d
      JOIN public.omnichannel_outbound_payloads AS p ON p.id = d.payload_id
     WHERE (p_session_id IS NULL OR d.session_id = p_session_id)
       AND d.status IN ('leased', 'authorized')
       AND d.lease_until <= v_now
     ORDER BY d.lease_until, d.id
     LIMIT p_limit
     FOR UPDATE OF d SKIP LOCKED
  LOOP
    IF v_expired.status = 'authorized' THEN
      UPDATE public.omnichannel_outbound_deliveries
         SET status = 'delivery_unknown', lease_token = NULL,
             lease_until = NULL, last_error_code = 'authorized_lease_expired',
             last_error_at = v_now, completed_at = v_now
       WHERE id = v_expired.id;
      IF v_expired.source_inbound_message_id IS NOT NULL THEN
        UPDATE public.omnichannel_messages
           SET status = 'needs_human',
               ai_reason = 'outbound_delivery_unknown:authorized_lease_expired',
               processed_at = v_now
         WHERE id = v_expired.source_inbound_message_id
           AND direction = 'in';
      END IF;
      UPDATE public.omnichannel_conversations
         SET status = 'needs_human', auto_reply_override = FALSE
       WHERE id = v_expired.conversation_id;
      v_unknown := v_unknown + 1;
    ELSIF v_expired.attempts >= v_expired.max_attempts THEN
      UPDATE public.omnichannel_outbound_deliveries
         SET status = 'dead', lease_token = NULL, lease_until = NULL,
             last_error_code = 'lease_expired_max_attempts',
             last_error_at = v_now, completed_at = v_now
       WHERE id = v_expired.id;
      IF v_expired.source_inbound_message_id IS NOT NULL THEN
        UPDATE public.omnichannel_messages
           SET status = 'needs_human',
               ai_reason = 'outbound_delivery_dead:lease_expired_max_attempts',
               processed_at = v_now
         WHERE id = v_expired.source_inbound_message_id
           AND direction = 'in';
      END IF;
      UPDATE public.omnichannel_conversations
         SET status = 'needs_human', auto_reply_override = FALSE
       WHERE id = v_expired.conversation_id;
      v_dead := v_dead + 1;
    ELSE
      UPDATE public.omnichannel_outbound_deliveries
         SET status = 'queued', lease_token = NULL, lease_until = NULL,
             run_at = v_now + make_interval(secs => LEAST(60, 2 * v_expired.attempts)),
             last_error_code = 'lease_expired_before_authorization',
             last_error_at = v_now
       WHERE id = v_expired.id;
      v_requeued := v_requeued + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_requeued, v_unknown, v_dead;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_omnichannel_outbound_delivery(
  p_session_id TEXT,
  p_lease_seconds INTEGER DEFAULT 180
)
RETURNS TABLE (
  delivery_id UUID,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  recipient TEXT,
  typing_delay_ms INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_session_id IS NULL OR p_session_id !~ '^[A-Za-z0-9._-]{1,64}$' THEN
    RAISE EXCEPTION 'invalid session_id' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION 'invalid lease_seconds' USING ERRCODE = '22023';
  END IF;

  -- This is also called by an independent five-minute maintenance schedule, so
  -- an offline bridge cannot leave an authorized/ambiguous send fenced forever.
  PERFORM public.reap_omnichannel_outbound_deliveries(p_session_id, 100);

  RETURN QUERY
  WITH candidate AS MATERIALIZED (
    SELECT d.id
      FROM public.omnichannel_outbound_deliveries AS d
      JOIN public.omnichannel_outbound_payloads AS p ON p.id = d.payload_id
     WHERE d.session_id = p_session_id
       AND d.status = 'queued'
       AND d.run_at <= v_now
       AND d.attempts < d.max_attempts
       AND p.text IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.omnichannel_outbound_deliveries AS active
          WHERE active.conversation_id = d.conversation_id
            AND active.status IN ('leased', 'authorized')
            AND active.id <> d.id
       )
       -- Preserve per-conversation ordering, including while an older delivery
       -- is waiting for a safe pre-provider retry. A later reply must never
       -- overtake it and change the meaning of the conversation.
       AND NOT EXISTS (
         SELECT 1
           FROM public.omnichannel_outbound_deliveries AS earlier
          WHERE earlier.conversation_id = d.conversation_id
            AND earlier.status IN ('queued', 'leased', 'authorized')
            AND (
              earlier.created_at < d.created_at
              OR (earlier.created_at = d.created_at AND earlier.id < d.id)
            )
       )
     ORDER BY d.run_at, d.created_at, d.id
     LIMIT 1
     FOR UPDATE OF d SKIP LOCKED
  ), acquired AS (
    UPDATE public.omnichannel_outbound_deliveries AS d
       SET status = 'leased', attempts = d.attempts + 1,
           lease_token = gen_random_uuid(),
           lease_until = v_now + make_interval(secs => p_lease_seconds)
      FROM candidate AS c
     WHERE d.id = c.id
    RETURNING d.*
  )
  SELECT a.id, a.lease_token, a.lease_until, c.external_id,
         p.typing_delay_ms
    FROM acquired AS a
    JOIN public.omnichannel_outbound_payloads AS p ON p.id = a.payload_id
    JOIN public.omnichannel_conversations AS c ON c.id = a.conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_omnichannel_outbound_delivery(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_session_id TEXT,
  p_authorized_lease_seconds INTEGER DEFAULT 180
)
RETURNS TABLE (
  authorized BOOLEAN,
  reason TEXT,
  recipient TEXT,
  message_text TEXT,
  reply_to_external_id TEXT,
  idempotency_key TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_delivery public.omnichannel_outbound_deliveries%ROWTYPE;
  v_payload public.omnichannel_outbound_payloads%ROWTYPE;
  v_conversation public.omnichannel_conversations%ROWTYPE;
  v_source public.omnichannel_messages%ROWTYPE;
  v_claim RECORD;
  v_reason TEXT;
  v_expected_settings TIMESTAMPTZ;
  v_latest_inbound_id UUID;
BEGIN
  IF p_delivery_id IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'delivery_id and lease_token are required'
      USING ERRCODE = '22004';
  END IF;
  IF p_session_id IS NULL OR p_session_id !~ '^[A-Za-z0-9._-]{1,64}$' THEN
    RAISE EXCEPTION 'invalid session_id' USING ERRCODE = '22023';
  END IF;
  IF p_authorized_lease_seconds IS NULL
     OR p_authorized_lease_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION 'invalid authorized lease seconds' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_delivery
    FROM public.omnichannel_outbound_deliveries
   WHERE id = p_delivery_id
   FOR UPDATE;
  IF NOT FOUND OR v_delivery.session_id <> p_session_id THEN
    RETURN QUERY SELECT FALSE, 'delivery_not_found'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;
  IF v_delivery.status <> 'leased'
     OR v_delivery.lease_token <> p_lease_token
     OR v_delivery.lease_until <= v_now THEN
    RETURN QUERY SELECT FALSE, 'lease_not_live'::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_payload
    FROM public.omnichannel_outbound_payloads
   WHERE id = v_delivery.payload_id
   FOR UPDATE;
  SELECT * INTO v_conversation
    FROM public.omnichannel_conversations
   WHERE id = v_delivery.conversation_id
   FOR UPDATE;
  IF NOT FOUND OR v_payload.text IS NULL
     OR v_conversation.channel <> 'whatsapp'
     OR v_conversation.account_external_id <> 'waweb:' || p_session_id
     OR v_conversation.send_suppressed THEN
    v_reason := 'conversation_not_sendable';
  ELSIF v_payload.actor = 'manual' THEN
    SELECT * INTO v_source
      FROM public.omnichannel_messages
     WHERE id = v_payload.source_inbound_message_id
       AND conversation_id = v_payload.conversation_id
       AND direction = 'in'
     FOR UPDATE;
    IF NOT FOUND
       OR v_source.metadata ->> 'providerTimestampTrusted' IS DISTINCT FROM 'true' THEN
      v_reason := 'manual_send_window_untrusted';
    ELSIF v_source.occurred_at > v_now + INTERVAL '5 minutes' THEN
      v_reason := 'manual_send_window_untrusted';
    ELSIF v_source.occurred_at < v_now - INTERVAL '24 hours' THEN
      v_reason := 'manual_send_window_expired';
    ELSE
      SELECT id INTO v_latest_inbound_id
        FROM public.omnichannel_messages
       WHERE conversation_id = v_payload.conversation_id
         AND direction = 'in'
       ORDER BY occurred_at DESC, created_at DESC, id DESC
       LIMIT 1;
      IF v_latest_inbound_id IS DISTINCT FROM v_source.id THEN
        v_reason := 'manual_reply_superseded_by_newer_message';
      END IF;
    END IF;
  ELSIF v_payload.actor = 'automated' THEN
    IF v_payload.finalization ->> 'kind' = 'equipment' THEN
      BEGIN
        v_expected_settings := (v_payload.finalization ->> 'settingsUpdatedAt')::TIMESTAMPTZ;
      EXCEPTION WHEN OTHERS THEN
        v_expected_settings := NULL;
      END;
      SELECT * INTO v_claim
        FROM public.claim_omnichannel_equipment_flow_send(
          v_payload.source_inbound_message_id,
          v_expected_settings
        );
    ELSE
      SELECT * INTO v_claim
        FROM public.claim_omnichannel_auto_send(
          v_payload.source_inbound_message_id
        );
    END IF;
    IF NOT COALESCE(v_claim.claimed, FALSE) THEN
      v_reason := COALESCE(v_claim.reason, 'auto_send_not_authorized');
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE public.omnichannel_outbound_deliveries
       SET status = 'cancelled', lease_token = NULL, lease_until = NULL,
           last_error_code = left(
             regexp_replace(lower(v_reason), '[^a-z0-9._:-]+', '_', 'g'),
             120
           ),
           last_error_at = v_now, completed_at = v_now
     WHERE id = v_delivery.id;
    IF v_payload.actor = 'automated'
       AND v_payload.source_inbound_message_id IS NOT NULL THEN
      UPDATE public.omnichannel_messages
         SET status = 'superseded',
             ai_reason = left('outbound_delivery_cancelled:' || v_reason, 500),
             processed_at = v_now
       WHERE id = v_payload.source_inbound_message_id
         AND direction = 'in'
         AND status IN ('processing', 'sending');
    END IF;
    RETURN QUERY SELECT FALSE, v_reason,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE public.omnichannel_outbound_deliveries
     SET status = 'authorized',
         lease_until = v_now + make_interval(secs => p_authorized_lease_seconds)
   WHERE id = v_delivery.id;

  RETURN QUERY SELECT TRUE, 'authorized'::TEXT,
    v_conversation.external_id,
    v_payload.text,
    v_payload.reply_to_external_id,
    v_delivery.idempotency_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_omnichannel_outbound_delivery(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_session_id TEXT,
  p_outcome TEXT,
  p_provider_message_id TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  accepted BOOLEAN,
  delivery_status TEXT,
  external_message_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_delivery public.omnichannel_outbound_deliveries%ROWTYPE;
  v_payload public.omnichannel_outbound_payloads%ROWTYPE;
  v_external_message_id TEXT;
  v_outbound_message_id UUID;
  v_source_status TEXT;
  v_next_status TEXT;
  v_safe_retry_codes CONSTANT TEXT[] := ARRAY[
    'session_disconnected',
    'send_rate_limited',
    'send_queue_full',
    'idempotency_cache_full',
    'idempotency_cache_persist_failed'
  ];
BEGIN
  IF p_delivery_id IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'delivery_id and lease_token are required'
      USING ERRCODE = '22004';
  END IF;
  IF p_session_id IS NULL OR p_session_id !~ '^[A-Za-z0-9._-]{1,64}$' THEN
    RAISE EXCEPTION 'invalid session_id' USING ERRCODE = '22023';
  END IF;
  IF p_outcome NOT IN ('sent', 'retryable_failure', 'delivery_unknown') THEN
    RAISE EXCEPTION 'invalid delivery outcome' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_delivery
    FROM public.omnichannel_outbound_deliveries
   WHERE id = p_delivery_id
   FOR UPDATE;
  IF NOT FOUND OR v_delivery.session_id <> p_session_id THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Result POSTs are idempotent. A late conflicting result can never replace a
  -- terminal outcome or revive a fenced delivery.
  IF v_delivery.status IN ('sent', 'cancelled', 'delivery_unknown', 'dead') THEN
    v_external_message_id := CASE
      WHEN v_delivery.provider_message_id IS NOT NULL
        THEN 'waweb:' || p_session_id || ':' || v_delivery.provider_message_id
      ELSE NULL
    END;
    RETURN QUERY SELECT
      (v_delivery.status = 'sent' AND p_outcome = 'sent'
       AND v_delivery.provider_message_id = p_provider_message_id)
      OR (v_delivery.status = 'delivery_unknown' AND p_outcome = 'delivery_unknown'),
      v_delivery.status,
      v_external_message_id;
    RETURN;
  END IF;

  IF v_delivery.status <> 'authorized'
     OR v_delivery.lease_token <> p_lease_token THEN
    RETURN QUERY SELECT FALSE, v_delivery.status, NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_payload
    FROM public.omnichannel_outbound_payloads
   WHERE id = v_delivery.payload_id
   FOR UPDATE;
  IF NOT FOUND OR v_payload.text IS NULL THEN
    RAISE EXCEPTION 'outbound payload is unavailable' USING ERRCODE = '55000';
  END IF;

  IF p_outcome = 'sent' THEN
    IF p_provider_message_id IS NULL
       OR length(p_provider_message_id) NOT BETWEEN 1 AND 256
       OR p_provider_message_id !~ '^[A-Za-z0-9._:/+=-]+$' THEN
      RAISE EXCEPTION 'invalid provider message id' USING ERRCODE = '22023';
    END IF;
    v_external_message_id := 'waweb:' || p_session_id || ':' || p_provider_message_id;

    INSERT INTO public.omnichannel_messages (
      conversation_id, channel, external_message_id, direction, message_type,
      text, status, reply_to_external_id, ai_generated, metadata,
      occurred_at, processed_at
    ) VALUES (
      v_payload.conversation_id, 'whatsapp', v_external_message_id, 'out',
      v_payload.message_type, v_payload.text, 'sent',
      v_payload.reply_to_external_id, v_payload.ai_generated,
      v_payload.metadata || jsonb_build_object(
        'transport', 'whatsapp_web',
        'bridgeSessionId', p_session_id,
        'bridgeMessageId', p_provider_message_id,
        'outboundDeliveryId', v_delivery.id
      ),
      v_now, v_now
    )
    ON CONFLICT ON CONSTRAINT omnichannel_messages_channel_external_message_id_key
    DO UPDATE SET
      direction = 'out',
      message_type = EXCLUDED.message_type,
      text = EXCLUDED.text,
      status = CASE
        WHEN omnichannel_messages.status IN ('delivered', 'read', 'failed')
          THEN omnichannel_messages.status
        ELSE 'sent'
      END,
      reply_to_external_id = EXCLUDED.reply_to_external_id,
      ai_generated = omnichannel_messages.ai_generated OR EXCLUDED.ai_generated,
      metadata = omnichannel_messages.metadata || EXCLUDED.metadata,
      processed_at = EXCLUDED.processed_at
    WHERE omnichannel_messages.conversation_id = EXCLUDED.conversation_id
      AND omnichannel_messages.direction = 'out'
    RETURNING id INTO v_outbound_message_id;
    IF v_outbound_message_id IS NULL THEN
      RAISE EXCEPTION 'provider message id belongs to another message'
        USING ERRCODE = '23505';
    END IF;

    IF v_payload.source_inbound_message_id IS NOT NULL THEN
      SELECT status INTO v_source_status
        FROM public.omnichannel_messages
       WHERE id = v_payload.source_inbound_message_id
       FOR UPDATE;
      IF v_payload.finalization ->> 'kind' = 'equipment'
         AND v_source_status = 'sending' THEN
        PERFORM public.finalize_omnichannel_equipment_flow_reply(
          v_payload.source_inbound_message_id,
          v_payload.conversation_id,
          v_payload.finalization ->> 'stage',
          v_payload.finalization ->> 'choiceId',
          v_payload.finalization ->> 'choiceLabel',
          v_payload.finalization ->> 'cityRouteId',
          v_payload.finalization ->> 'cityLabel',
          v_payload.finalization ->> 'managerUrl',
          COALESCE((v_payload.finalization ->> 'communityIncluded')::BOOLEAN, FALSE),
          COALESCE(v_payload.finalization ->> 'reason', 'safe_auto_reply')
        );
      ELSE
        UPDATE public.omnichannel_messages
           SET status = 'replied',
               ai_reason = left(
                 COALESCE(v_payload.finalization ->> 'reason',
                          CASE WHEN v_payload.actor = 'manual'
                            THEN 'manual_operator_reply'
                            ELSE 'safe_auto_reply' END),
                 500
               ),
               processed_at = v_now
         WHERE id = v_payload.source_inbound_message_id
           AND direction = 'in'
           AND status IN ('processing', 'sending', 'superseded', 'needs_human');
      END IF;
    END IF;

    UPDATE public.omnichannel_outbound_deliveries
       SET status = 'sent', provider_message_id = p_provider_message_id,
           lease_token = NULL, lease_until = NULL, completed_at = v_now,
           last_error_code = NULL, last_error_at = NULL
     WHERE id = v_delivery.id;
    -- The durable omnichannel message now owns the only retained copy of text.
    UPDATE public.omnichannel_outbound_payloads
       SET text = NULL
     WHERE id = v_payload.id;

    RETURN QUERY SELECT TRUE, 'sent'::TEXT, v_external_message_id;
    RETURN;
  END IF;

  IF p_error_code IS NULL
     OR p_error_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$' THEN
    RAISE EXCEPTION 'invalid error_code' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'retryable_failure'
     AND p_error_code = ANY(v_safe_retry_codes)
     AND v_delivery.attempts < v_delivery.max_attempts THEN
    UPDATE public.omnichannel_outbound_deliveries
       SET status = 'queued', lease_token = NULL, lease_until = NULL,
           run_at = v_now + make_interval(
             secs => LEAST(60, 2 * power(2, LEAST(v_delivery.attempts, 5))::INTEGER)
           ),
           last_error_code = p_error_code, last_error_at = v_now
     WHERE id = v_delivery.id;
    RETURN QUERY SELECT TRUE, 'queued'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  v_next_status := CASE
    WHEN p_outcome = 'retryable_failure'
         AND p_error_code = ANY(v_safe_retry_codes)
      THEN 'dead'
    ELSE 'delivery_unknown'
  END;
  UPDATE public.omnichannel_outbound_deliveries
     SET status = v_next_status, lease_token = NULL, lease_until = NULL,
         last_error_code = p_error_code, last_error_at = v_now,
         completed_at = v_now
   WHERE id = v_delivery.id;
  IF v_payload.source_inbound_message_id IS NOT NULL THEN
    UPDATE public.omnichannel_messages
       SET status = 'needs_human',
           ai_reason = left('outbound_' || v_next_status || ':' || p_error_code, 500),
           processed_at = v_now
     WHERE id = v_payload.source_inbound_message_id
       AND direction = 'in';
  END IF;
  UPDATE public.omnichannel_conversations
     SET status = 'needs_human', auto_reply_override = FALSE
   WHERE id = v_payload.conversation_id;

  RETURN QUERY SELECT TRUE, v_next_status, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_omnichannel_outbound_delivery(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT,
  JSONB, JSONB, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reap_omnichannel_outbound_deliveries(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_omnichannel_outbound_delivery(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authorize_omnichannel_outbound_delivery(
  UUID, UUID, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_omnichannel_outbound_delivery(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_omnichannel_outbound_delivery(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT,
  JSONB, JSONB, INTEGER, INTEGER
) TO service_role, aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.reap_omnichannel_outbound_deliveries(TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_omnichannel_outbound_delivery(TEXT, INTEGER)
  TO service_role, aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.authorize_omnichannel_outbound_delivery(
  UUID, UUID, TEXT, INTEGER
) TO service_role, aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.report_omnichannel_outbound_delivery(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT
) TO service_role, aistart360_omnichannel_runtime;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.enqueue_omnichannel_outbound_delivery(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT,
  JSONB, JSONB, INTEGER, INTEGER
) IS 'Atomically stores one canonical payload and one idempotent control-only delivery row.';
COMMENT ON FUNCTION public.claim_omnichannel_outbound_delivery(TEXT, INTEGER) IS
  'Recovers safe pre-authorization leases, terminally escalates expired authorized leases, then acquires one fenced delivery.';
COMMENT ON FUNCTION public.authorize_omnichannel_outbound_delivery(
  UUID, UUID, TEXT, INTEGER
) IS 'Re-checks all database safety gates immediately before exposing text for provider send.';
COMMENT ON FUNCTION public.report_omnichannel_outbound_delivery(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT
) IS 'Persists a confirmed provider result or fails closed; ambiguous provider outcomes are never requeued.';

NOTIFY pgrst, 'reload schema';
