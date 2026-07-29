-- Fence direct Meta/bridge sends by the concrete durable execution that owns
-- them. A webhook can be retried after the Workflow start succeeded but before
-- its HTTP response reached us; those duplicate runs must never both cross the
-- provider boundary.

CREATE OR REPLACE FUNCTION public.claim_omnichannel_auto_send_owned(
  p_message_id UUID,
  p_owner_token TEXT
)
RETURNS TABLE (claimed BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base RECORD;
  v_message public.omnichannel_messages%ROWTYPE;
  v_conversation_id UUID;
  v_owner TEXT := NULLIF(btrim(p_owner_token), '');
  v_existing_owner TEXT;
BEGIN
  IF v_owner IS NULL OR length(v_owner) > 200 THEN
    RETURN QUERY SELECT FALSE, 'invalid_send_claim_owner'::TEXT;
    RETURN;
  END IF;

  SELECT conversation_id INTO v_conversation_id
  FROM public.omnichannel_messages
  WHERE id = p_message_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'message_not_found'::TEXT;
    RETURN;
  END IF;

  -- Match the base claim's conversation -> message lock order, but inspect the
  -- execution fence first. A replay must surface ambiguous delivery even if a
  -- newer message or operator setting would now fail a later policy check.
  PERFORM 1
  FROM public.omnichannel_conversations
  WHERE id = v_conversation_id
  FOR UPDATE;
  SELECT * INTO v_message
  FROM public.omnichannel_messages
  WHERE id = p_message_id
  FOR UPDATE;
  v_existing_owner := v_message.metadata ->> 'sendClaimOwner';
  IF v_existing_owner IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, CASE
      WHEN v_existing_owner = v_owner THEN 'send_claim_already_acquired'::TEXT
      ELSE 'send_claim_owned_by_other_worker'::TEXT
    END;
    RETURN;
  END IF;

  -- The existing claim remains the single place that checks channel mode,
  -- confidence, newest-message ordering and the provider reply window. It also
  -- locks the conversation/message rows through the end of this transaction.
  SELECT * INTO v_base
  FROM public.claim_omnichannel_auto_send(p_message_id);
  IF NOT COALESCE(v_base.claimed, FALSE) THEN
    RETURN QUERY SELECT FALSE, COALESCE(v_base.reason, 'claim_denied')::TEXT;
    RETURN;
  END IF;

  UPDATE public.omnichannel_messages
     SET metadata = jsonb_set(
       jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{sendClaimOwner}',
         to_jsonb(v_owner),
         TRUE
       ),
       '{sendClaimedAt}',
       to_jsonb(now()::TEXT),
       TRUE
     )
   WHERE id = p_message_id;

  RETURN QUERY SELECT TRUE, 'claimed'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_omnichannel_equipment_flow_send_owned(
  p_message_id UUID,
  p_expected_settings_updated_at TIMESTAMPTZ,
  p_owner_token TEXT
)
RETURNS TABLE (claimed BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base RECORD;
  v_message public.omnichannel_messages%ROWTYPE;
  v_conversation_id UUID;
  v_owner TEXT := NULLIF(btrim(p_owner_token), '');
  v_existing_owner TEXT;
BEGIN
  IF v_owner IS NULL OR length(v_owner) > 200 THEN
    RETURN QUERY SELECT FALSE, 'invalid_send_claim_owner'::TEXT;
    RETURN;
  END IF;

  SELECT conversation_id INTO v_conversation_id
  FROM public.omnichannel_messages
  WHERE id = p_message_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'message_not_found'::TEXT;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.omnichannel_conversations
  WHERE id = v_conversation_id
  FOR UPDATE;
  SELECT * INTO v_message
  FROM public.omnichannel_messages
  WHERE id = p_message_id
  FOR UPDATE;
  v_existing_owner := v_message.metadata ->> 'sendClaimOwner';
  IF v_existing_owner IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, CASE
      WHEN v_existing_owner = v_owner THEN 'send_claim_already_acquired'::TEXT
      ELSE 'send_claim_owned_by_other_worker'::TEXT
    END;
    RETURN;
  END IF;

  SELECT * INTO v_base
  FROM public.claim_omnichannel_equipment_flow_send(
    p_message_id,
    p_expected_settings_updated_at
  );
  IF NOT COALESCE(v_base.claimed, FALSE) THEN
    RETURN QUERY SELECT FALSE, COALESCE(v_base.reason, 'claim_denied')::TEXT;
    RETURN;
  END IF;

  UPDATE public.omnichannel_messages
     SET metadata = jsonb_set(
       jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{sendClaimOwner}',
         to_jsonb(v_owner),
         TRUE
       ),
       '{sendClaimedAt}',
       to_jsonb(now()::TEXT),
       TRUE
     )
   WHERE id = p_message_id;

  RETURN QUERY SELECT TRUE, 'claimed'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_omnichannel_auto_send_owned(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_omnichannel_equipment_flow_send_owned(
  UUID, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;

-- Rolling deployments must fail closed. Older workers know only the legacy
-- unfenced entry points; revoking their direct grants prevents one old and one
-- new worker from both crossing the provider boundary during a rollout. The
-- SECURITY DEFINER owned/outbound wrappers can still call these base policy
-- functions as their owner.
REVOKE EXECUTE ON FUNCTION public.claim_omnichannel_auto_send(UUID)
  FROM service_role, aistart360_omnichannel_runtime;
REVOKE EXECUTE ON FUNCTION public.claim_omnichannel_equipment_flow_send(
  UUID, TIMESTAMPTZ
) FROM service_role, aistart360_omnichannel_runtime;

GRANT EXECUTE ON FUNCTION public.claim_omnichannel_auto_send_owned(UUID, TEXT)
  TO service_role, aistart360_omnichannel_runtime;
GRANT EXECUTE ON FUNCTION public.claim_omnichannel_equipment_flow_send_owned(
  UUID, TIMESTAMPTZ, TEXT
) TO service_role, aistart360_omnichannel_runtime;

COMMENT ON FUNCTION public.claim_omnichannel_auto_send_owned(UUID, TEXT) IS
  'Final direct-send claim fenced by one durable execution owner.';
COMMENT ON FUNCTION public.claim_omnichannel_equipment_flow_send_owned(
  UUID, TIMESTAMPTZ, TEXT
) IS 'Equipment-flow direct-send claim fenced by one durable execution owner.';

-- Backfill one latest pending message per chat. Limiting raw messages lets one
-- noisy burst consume the whole batch and was the reason an inbox with ~90
-- chats could appear to import only a small subset.
CREATE OR REPLACE FUNCTION public.list_omnichannel_whatsapp_history_for_draft(
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (message_id UUID, conversation_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT latest.id, latest.conversation_id
  FROM (
    SELECT DISTINCT ON (m.conversation_id)
      m.id,
      m.conversation_id,
      m.occurred_at,
      m.created_at
    FROM public.omnichannel_messages AS m
    WHERE m.channel = 'whatsapp'
      AND m.direction = 'in'
      AND m.status = 'imported'
      AND m.ai_draft IS NULL
      AND m.metadata @> '{"transport":"whatsapp_web","catchUp":true}'::jsonb
    ORDER BY m.conversation_id, m.occurred_at DESC, m.created_at DESC, m.id DESC
  ) AS latest
  ORDER BY latest.occurred_at DESC, latest.created_at DESC, latest.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.list_omnichannel_whatsapp_history_for_draft(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_omnichannel_whatsapp_history_for_draft(INTEGER)
  TO service_role, aistart360_omnichannel_runtime;

COMMENT ON FUNCTION public.list_omnichannel_whatsapp_history_for_draft(INTEGER) IS
  'Latest unanalysed WhatsApp Web catch-up inbound per conversation.';

NOTIFY pgrst, 'reload schema';
