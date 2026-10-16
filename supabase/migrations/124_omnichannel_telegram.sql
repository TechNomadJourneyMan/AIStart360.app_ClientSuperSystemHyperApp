-- 124_omnichannel_telegram.sql
-- Telegram as the third channel of the GIGA «Единый inbox» (Honor Group's
-- business inbox; separate from the platform's GIGA «Сообщения», lib/comm).
--
--   1. Every omnichannel channel CHECK accepts 'telegram'.
--   2. public.omnichannel_telegram_bots — the business bot connection
--      (service role only, RLS on): encrypted token, SHA-256 of the webhook
--      secret, bot id/@username, status. Never readable by anon/authenticated.
--   3. The 'telegram' settings row (draft, disabled, equipment flow OFF),
--      seeded from the WhatsApp row's business context when present.
--   4. claim_omnichannel_auto_send: Telegram has no 24-hour reply window, so
--      the window bound is skipped for channel 'telegram' only (the future-
--      timestamp guard and every other gate stay).
--   5. set_omnichannel_equipment_flow_enabled accepts 'telegram'.
--
-- Idempotent: safe to run more than once. Not applied automatically.

-- ─── 1. Channel CHECKs ────────────────────────────────────────────────────────
DO $migration$
DECLARE
  v_table TEXT;
  v_constraint RECORD;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'omnichannel_settings',
    'omnichannel_contacts',
    'omnichannel_conversations',
    'omnichannel_messages',
    'omnichannel_webhook_events'
  ]
  LOOP
    -- 061 declared the checks inline (auto-generated names); drop whichever
    -- CHECK restricts `channel` to the old list, then add a named one.
    FOR v_constraint IN
      SELECT con.conname
        FROM pg_constraint AS con
       WHERE con.conrelid = format('public.%I', v_table)::regclass
         AND con.contype = 'c'
         AND pg_get_constraintdef(con.oid) ~ '\mchannel\M'
         AND pg_get_constraintdef(con.oid) ~ 'instagram'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_table, v_constraint.conname);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (channel IN (''instagram'', ''whatsapp'', ''telegram''))',
      v_table,
      v_table || '_channel_check'
    );
  END LOOP;
END;
$migration$;

-- ─── 2. Business bot connection ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.omnichannel_telegram_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id TEXT NOT NULL CHECK (bot_id ~ '^[0-9]{3,20}$'),
  bot_username TEXT NOT NULL CHECK (length(btrim(bot_username)) BETWEEN 1 AND 64),
  bot_name TEXT CHECK (bot_name IS NULL OR length(bot_name) <= 128),
  -- lib/crypto/secrets.ts AES-256-GCM payload; plaintext tokens never stored.
  token_ciphertext TEXT NOT NULL CHECK (token_ciphertext LIKE 'v1:%'),
  -- SHA-256 (hex) of the setWebhook secret_token; the secret itself is not stored.
  webhook_secret_hash TEXT NOT NULL CHECK (webhook_secret_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'error')),
  webhook_ok BOOLEAN NOT NULL DEFAULT FALSE,
  webhook_set_at TIMESTAMPTZ,
  last_update_at TIMESTAMPTZ,
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 300),
  connected_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One business bot per inbox; a bot id cannot be connected twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_omnichannel_telegram_bots_single
  ON public.omnichannel_telegram_bots ((TRUE));
CREATE UNIQUE INDEX IF NOT EXISTS idx_omnichannel_telegram_bots_bot_id
  ON public.omnichannel_telegram_bots (bot_id);

DROP TRIGGER IF EXISTS omnichannel_telegram_bots_updated_at
  ON public.omnichannel_telegram_bots;
CREATE TRIGGER omnichannel_telegram_bots_updated_at
  BEFORE UPDATE ON public.omnichannel_telegram_bots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.omnichannel_telegram_bots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.omnichannel_telegram_bots FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.omnichannel_telegram_bots TO service_role;

COMMENT ON TABLE public.omnichannel_telegram_bots IS
  'GIGA inbox Telegram business bot. Service role only. Token encrypted (SECRETS_ENCRYPTION_KEY), webhook secret stored as SHA-256 only.';

-- ─── 3. Settings row ─────────────────────────────────────────────────────────
-- Start like the other channels: disabled, draft. Reuse the reviewed WhatsApp
-- business context and scenario copy, but the scenario stays OFF until an
-- operator enables it for Telegram explicitly.
INSERT INTO public.omnichannel_settings (
  channel, mode, enabled, business_context, automation_config,
  confidence_threshold, reply_delay_seconds
)
SELECT
  'telegram',
  'draft',
  FALSE,
  source.business_context,
  CASE
    WHEN jsonb_typeof(source.automation_config #> '{equipment_sales_flow}') = 'object'
      THEN jsonb_set(source.automation_config, '{equipment_sales_flow,enabled}', 'false'::jsonb, TRUE)
    ELSE COALESCE(source.automation_config, '{}'::jsonb)
  END,
  source.confidence_threshold,
  source.reply_delay_seconds
FROM public.omnichannel_settings AS source
WHERE source.channel = 'whatsapp'
ON CONFLICT (channel) DO NOTHING;

INSERT INTO public.omnichannel_settings (channel, mode, enabled)
VALUES ('telegram', 'draft', FALSE)
ON CONFLICT (channel) DO NOTHING;

-- ─── 4. Auto-send claim without a Telegram window ────────────────────────────
-- Body identical to 061 except the 24-hour lower bound, which now applies to
-- Meta channels only. Grants (070: service_role/runtime revoked; called via
-- the SECURITY DEFINER *_owned wrappers) are preserved by CREATE OR REPLACE.
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
     OR (
       v_message.channel <> 'telegram'
       AND v_message.occurred_at < now() - INTERVAL '24 hours'
     ) THEN
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

-- ─── 5. Equipment-flow toggle for Telegram ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_omnichannel_equipment_flow_enabled(
  p_channel TEXT,
  p_enabled BOOLEAN
)
RETURNS SETOF public.omnichannel_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_channel IS NULL OR p_channel NOT IN ('instagram', 'whatsapp', 'telegram') THEN
    RAISE EXCEPTION 'invalid omnichannel channel';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'equipment flow enabled flag is required';
  END IF;

  RETURN QUERY
  UPDATE public.omnichannel_settings
  SET automation_config = jsonb_set(
    automation_config,
    '{equipment_sales_flow,enabled}',
    to_jsonb(p_enabled),
    FALSE
  )
  WHERE channel = p_channel
    AND jsonb_typeof(automation_config #> '{equipment_sales_flow}') = 'object'
    AND automation_config #> '{equipment_sales_flow,version}' = '1'::jsonb
    AND automation_config #> '{equipment_sales_flow,opt_in_revision}' = '1'::jsonb
    AND jsonb_typeof(automation_config #> '{equipment_sales_flow,enabled}') = 'boolean'
  RETURNING *;
END;
$$;

NOTIFY pgrst, 'reload schema';
