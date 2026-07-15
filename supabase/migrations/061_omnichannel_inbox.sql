-- 061_omnichannel_inbox.sql
-- Service-only persistence for Instagram and WhatsApp conversations.
-- Webhook bodies and provider credentials are deliberately not stored here.

CREATE TABLE IF NOT EXISTS public.omnichannel_settings (
  channel TEXT PRIMARY KEY
    CHECK (channel IN ('instagram', 'whatsapp')),
  mode TEXT NOT NULL DEFAULT 'draft'
    CHECK (mode IN ('off', 'draft', 'auto')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  business_context TEXT,
  confidence_threshold NUMERIC(4, 3) NOT NULL DEFAULT 0.750
    CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1),
  reply_delay_seconds INTEGER NOT NULL DEFAULT 0
    CHECK (reply_delay_seconds >= 0 AND reply_delay_seconds <= 86400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.omnichannel_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL
    CHECK (channel IN ('instagram', 'whatsapp')),
  external_id TEXT NOT NULL CHECK (length(btrim(external_id)) > 0),
  display_name TEXT,
  username TEXT,
  phone TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);

CREATE TABLE IF NOT EXISTS public.omnichannel_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL
    CHECK (channel IN ('instagram', 'whatsapp')),
  account_external_id TEXT NOT NULL
    CHECK (length(btrim(account_external_id)) > 0),
  external_id TEXT NOT NULL CHECK (length(btrim(external_id)) > 0),
  contact_id UUID NOT NULL
    REFERENCES public.omnichannel_contacts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'needs_human', 'resolved', 'muted')),
  auto_reply_override BOOLEAN,
  send_suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  suppression_reason TEXT,
  suppressed_at TIMESTAMPTZ,
  intent TEXT,
  sentiment TEXT,
  lead_score SMALLINT CHECK (lead_score >= 0 AND lead_score <= 100),
  summary TEXT,
  last_message_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, account_external_id, external_id),
  UNIQUE (id, channel)
);

CREATE TABLE IF NOT EXISTS public.omnichannel_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  channel TEXT NOT NULL
    CHECK (channel IN ('instagram', 'whatsapp')),
  external_message_id TEXT NOT NULL
    CHECK (length(btrim(external_message_id)) > 0),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  message_type TEXT NOT NULL DEFAULT 'text',
  text TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN (
      'received', 'processing', 'imported', 'drafted', 'sending', 'sent', 'replied',
      'delivered', 'read', 'failed', 'ignored', 'superseded', 'needs_human'
    )),
  reply_to_external_id TEXT,
  ai_draft TEXT,
  ai_confidence NUMERIC(4, 3)
    CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  ai_reason TEXT,
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT omnichannel_messages_conversation_channel_fkey
    FOREIGN KEY (conversation_id, channel)
    REFERENCES public.omnichannel_conversations(id, channel)
    ON DELETE CASCADE,
  UNIQUE (channel, external_message_id)
);

CREATE TABLE IF NOT EXISTS public.omnichannel_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL
    CHECK (channel IN ('instagram', 'whatsapp')),
  event_hash TEXT NOT NULL CHECK (length(btrim(event_hash)) > 0),
  event_type TEXT,
  account_external_id TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'queued', 'processing', 'processed', 'failed', 'ignored')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, event_hash)
);

-- Keep the migration convergent if an earlier development revision of 061 was
-- applied before send-suppression was introduced.
ALTER TABLE public.omnichannel_conversations
  ADD COLUMN IF NOT EXISTS send_suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suppression_reason TEXT,
  ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMPTZ;

ALTER TABLE public.omnichannel_messages
  DROP CONSTRAINT IF EXISTS omnichannel_messages_status_check;
ALTER TABLE public.omnichannel_messages
  ADD CONSTRAINT omnichannel_messages_status_check
  CHECK (status IN (
    'received', 'processing', 'imported', 'drafted', 'sending', 'sent', 'replied',
    'delivered', 'read', 'failed', 'ignored', 'superseded', 'needs_human'
  ));

CREATE INDEX IF NOT EXISTS idx_omnichannel_contacts_last_seen
  ON public.omnichannel_contacts (channel, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_omnichannel_conversations_contact
  ON public.omnichannel_conversations (contact_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_omnichannel_conversations_queue
  ON public.omnichannel_conversations (channel, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_omnichannel_messages_timeline
  ON public.omnichannel_messages (conversation_id, occurred_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_omnichannel_messages_reply_to
  ON public.omnichannel_messages (channel, reply_to_external_id)
  WHERE reply_to_external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_omnichannel_messages_pending
  ON public.omnichannel_messages (status, occurred_at)
  WHERE status IN ('received', 'processing', 'drafted', 'sending');
CREATE INDEX IF NOT EXISTS idx_omnichannel_webhook_events_pending
  ON public.omnichannel_webhook_events (status, received_at)
  WHERE status IN ('received', 'queued', 'processing', 'failed');

CREATE OR REPLACE FUNCTION public.sync_omnichannel_conversation_from_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.omnichannel_conversations
  SET
    last_message_at = CASE
      WHEN last_message_at IS NULL THEN NEW.occurred_at
      ELSE GREATEST(last_message_at, NEW.occurred_at)
    END,
    last_inbound_at = CASE
      WHEN NEW.direction <> 'in' THEN last_inbound_at
      WHEN last_inbound_at IS NULL THEN NEW.occurred_at
      ELSE GREATEST(last_inbound_at, NEW.occurred_at)
    END,
    last_outbound_at = CASE
      WHEN NEW.direction <> 'out' THEN last_outbound_at
      WHEN last_outbound_at IS NULL THEN NEW.occurred_at
      ELSE GREATEST(last_outbound_at, NEW.occurred_at)
    END,
    status = CASE
      WHEN NEW.direction = 'in' AND status = 'resolved' THEN 'open'
      ELSE status
    END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS omnichannel_message_sync_conversation
  ON public.omnichannel_messages;
CREATE TRIGGER omnichannel_message_sync_conversation
  AFTER INSERT ON public.omnichannel_messages
  FOR EACH ROW EXECUTE FUNCTION public.sync_omnichannel_conversation_from_message();

DROP TRIGGER IF EXISTS omnichannel_settings_updated_at
  ON public.omnichannel_settings;
CREATE TRIGGER omnichannel_settings_updated_at
  BEFORE UPDATE ON public.omnichannel_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS omnichannel_contacts_updated_at
  ON public.omnichannel_contacts;
CREATE TRIGGER omnichannel_contacts_updated_at
  BEFORE UPDATE ON public.omnichannel_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS omnichannel_conversations_updated_at
  ON public.omnichannel_conversations;
CREATE TRIGGER omnichannel_conversations_updated_at
  BEFORE UPDATE ON public.omnichannel_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS omnichannel_messages_updated_at
  ON public.omnichannel_messages;
CREATE TRIGGER omnichannel_messages_updated_at
  BEFORE UPDATE ON public.omnichannel_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS omnichannel_webhook_events_updated_at
  ON public.omnichannel_webhook_events;
CREATE TRIGGER omnichannel_webhook_events_updated_at
  BEFORE UPDATE ON public.omnichannel_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Final, transactional guard immediately before an automated provider call.
-- The AI proposal is not authorization: this claim re-checks the operator kill
-- switch, per-conversation mode, policy timestamp, confidence and newest row,
-- then moves processing -> sending under row locks.
CREATE OR REPLACE FUNCTION public.claim_omnichannel_auto_send(p_message_id UUID)
RETURNS TABLE (claimed BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message public.omnichannel_messages%ROWTYPE;
  v_conversation public.omnichannel_conversations%ROWTYPE;
  v_settings public.omnichannel_settings%ROWTYPE;
  v_conversation_id UUID;
  v_latest_message_id UUID;
  v_effective_mode TEXT;
BEGIN
  SELECT conversation_id INTO v_conversation_id
  FROM public.omnichannel_messages
  WHERE id = p_message_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'message_not_found'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_conversation
  FROM public.omnichannel_conversations
  WHERE id = v_conversation_id
  FOR UPDATE;
  IF NOT FOUND OR v_conversation.status <> 'open' OR v_conversation.send_suppressed THEN
    RETURN QUERY SELECT FALSE, 'conversation_not_open'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_message
  FROM public.omnichannel_messages
  WHERE id = p_message_id
  FOR UPDATE;
  IF v_message.direction <> 'in' OR v_message.status NOT IN ('processing', 'sending') THEN
    RETURN QUERY SELECT FALSE, 'message_not_processing'::TEXT;
    RETURN;
  END IF;
  IF v_message.metadata ->> 'providerTimestampTrusted' IS DISTINCT FROM 'true' THEN
    RETURN QUERY SELECT FALSE, 'provider_timestamp_untrusted'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_settings
  FROM public.omnichannel_settings
  WHERE channel = v_message.channel
  FOR UPDATE;
  IF NOT FOUND OR NOT v_settings.enabled THEN
    RETURN QUERY SELECT FALSE, 'channel_disabled'::TEXT;
    RETURN;
  END IF;

  v_effective_mode := CASE
    WHEN v_conversation.auto_reply_override IS TRUE THEN 'auto'
    WHEN v_conversation.auto_reply_override IS FALSE THEN 'off'
    ELSE v_settings.mode
  END;
  IF v_effective_mode <> 'auto' THEN
    RETURN QUERY SELECT FALSE, 'auto_mode_disabled'::TEXT;
    RETURN;
  END IF;
  IF v_message.ai_confidence IS NULL
     OR v_message.ai_confidence < v_settings.confidence_threshold THEN
    RETURN QUERY SELECT FALSE, 'confidence_below_threshold'::TEXT;
    RETURN;
  END IF;

  SELECT id INTO v_latest_message_id
  FROM public.omnichannel_messages
  WHERE conversation_id = v_message.conversation_id
  ORDER BY occurred_at DESC, created_at DESC
  LIMIT 1;
  IF v_latest_message_id IS DISTINCT FROM v_message.id THEN
    RETURN QUERY SELECT FALSE, 'superseded_by_newer_message'::TEXT;
    RETURN;
  END IF;

  IF v_message.occurred_at > now() + INTERVAL '5 minutes'
     OR v_message.occurred_at < now() - INTERVAL '24 hours' THEN
    RETURN QUERY SELECT FALSE, 'standard_window_expired'::TEXT;
    RETURN;
  END IF;

  IF v_message.status = 'processing' THEN
    UPDATE public.omnichannel_messages
    SET status = 'sending'
    WHERE id = v_message.id;
  END IF;

  RETURN QUERY SELECT TRUE, 'claimed'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_omnichannel_manual_reply(p_conversation_id UUID)
RETURNS TABLE (reserved BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation public.omnichannel_conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_conversation
  FROM public.omnichannel_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'conversation_not_found'::TEXT;
    RETURN;
  END IF;
  IF v_conversation.send_suppressed THEN
    RETURN QUERY SELECT FALSE, 'send_suppressed'::TEXT;
    RETURN;
  END IF;

  UPDATE public.omnichannel_conversations
  SET auto_reply_override = FALSE
  WHERE id = p_conversation_id;

  UPDATE public.omnichannel_messages
  SET
    status = 'superseded',
    ai_reason = 'manual_operator_takeover',
    processed_at = now()
  WHERE conversation_id = p_conversation_id
    AND direction = 'in'
    AND status IN ('processing', 'sending');

  RETURN QUERY SELECT TRUE, 'reserved'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_omnichannel_inbox(
  p_channel TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (conversation JSONB, contact JSONB, last_message JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    jsonb_build_object(
      'id', c.id,
      'channel', c.channel,
      'status', c.status,
      'auto_reply_override', c.auto_reply_override,
      'send_suppressed', c.send_suppressed,
      'suppression_reason', c.suppression_reason,
      'suppressed_at', c.suppressed_at,
      'external_id', c.external_id,
      'intent', c.intent,
      'sentiment', c.sentiment,
      'lead_score', c.lead_score,
      'summary', c.summary,
      'last_message_at', c.last_message_at,
      'last_inbound_at', c.last_inbound_at,
      'last_outbound_at', c.last_outbound_at
    ),
    jsonb_build_object(
      'id', ct.id,
      'external_id', ct.external_id,
      'display_name', ct.display_name,
      'username', ct.username,
      'phone', ct.phone
    ),
    (
      SELECT jsonb_build_object(
        'id', m.id,
        'direction', m.direction,
        'text', m.text,
        'status', m.status,
        'message_type', m.message_type,
        'ai_draft', m.ai_draft,
        'ai_confidence', m.ai_confidence,
        'ai_reason', m.ai_reason,
        'ai_generated', m.ai_generated,
        'occurred_at', m.occurred_at
      )
      FROM public.omnichannel_messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.occurred_at DESC, m.created_at DESC
      LIMIT 1
    )
  FROM public.omnichannel_conversations c
  JOIN public.omnichannel_contacts ct ON ct.id = c.contact_id
  WHERE p_channel IS NULL OR c.channel = p_channel
  ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

-- Default-deny: webhook ingestion and inbox processing use the service-role client.
ALTER TABLE public.omnichannel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omnichannel_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.omnichannel_settings FROM anon, authenticated;
REVOKE ALL ON TABLE public.omnichannel_contacts FROM anon, authenticated;
REVOKE ALL ON TABLE public.omnichannel_conversations FROM anon, authenticated;
REVOKE ALL ON TABLE public.omnichannel_messages FROM anon, authenticated;
REVOKE ALL ON TABLE public.omnichannel_webhook_events FROM anon, authenticated;

GRANT ALL ON TABLE public.omnichannel_settings TO service_role;
GRANT ALL ON TABLE public.omnichannel_contacts TO service_role;
GRANT ALL ON TABLE public.omnichannel_conversations TO service_role;
GRANT ALL ON TABLE public.omnichannel_messages TO service_role;
GRANT ALL ON TABLE public.omnichannel_webhook_events TO service_role;

REVOKE ALL ON FUNCTION public.claim_omnichannel_auto_send(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_omnichannel_auto_send(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_omnichannel_manual_reply(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_omnichannel_manual_reply(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.list_omnichannel_inbox(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_omnichannel_inbox(TEXT, INTEGER) TO service_role;

INSERT INTO public.omnichannel_settings (channel, mode, enabled)
VALUES
  ('instagram', 'draft', FALSE),
  ('whatsapp', 'draft', FALSE)
ON CONFLICT (channel) DO NOTHING;

COMMENT ON TABLE public.omnichannel_webhook_events IS
  'Idempotency and processing audit only. Raw webhook bodies and credentials must not be stored.';

NOTIFY pgrst, 'reload schema';
