-- Additive Honor AI controls. Existing settings remain unchanged.
BEGIN;
ALTER TABLE public.omnichannel_settings DROP CONSTRAINT IF EXISTS omnichannel_settings_mode_check;
ALTER TABLE public.omnichannel_settings ADD CONSTRAINT omnichannel_settings_mode_check CHECK (mode IN ('off','assistant','draft','auto'));
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
    WHEN v_conversation.auto_reply_override IS FALSE THEN 'off'
    ELSE v_settings.mode
  END;
  IF v_effective_mode <> 'auto' THEN
    RETURN QUERY SELECT FALSE, 'auto_mode_disabled'::TEXT;
    RETURN;
  END IF;
  IF v_settings.automation_config->'honor_ai'->>'enabled' = 'true' AND (
       v_settings.automation_config->'honor_ai'->>'account_id' IS DISTINCT FROM v_conversation.account_external_id
       OR v_settings.automation_config->>'honor_verified_account' IS DISTINCT FROM v_conversation.account_external_id
       OR v_message.metadata->>'honorConfigHash' IS DISTINCT FROM md5((v_settings.automation_config->'honor_ai')::text)
       OR COALESCE((v_message.metadata->>'honorCatalogVerifiedAt')::timestamptz < now()-interval '2 minutes',true)
     ) THEN
    RETURN QUERY SELECT FALSE, 'honor_live_canary_required'::TEXT; RETURN;
  END IF;
  IF v_message.metadata->>'catchUp' = 'true' OR v_message.status = 'imported' THEN
    RETURN QUERY SELECT FALSE, 'historical_message'::TEXT; RETURN;
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


CREATE OR REPLACE FUNCTION public.honor_ai_control(p_action text, p_channel text DEFAULT 'whatsapp', p_config jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_action = 'stop' THEN
    UPDATE public.omnichannel_settings SET enabled=false,mode='off',updated_at=now();
  ELSIF p_action = 'configure' AND p_channel IN ('whatsapp','instagram') AND jsonb_typeof(p_config)='object' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ecommerce_products WHERE user_id=(p_config->>'user_id')::uuid AND company_id=(p_config->>'company_id')::uuid AND source='myhonor.shop') THEN
      RAISE EXCEPTION 'honor_catalog_binding_invalid';
    END IF;
    UPDATE public.omnichannel_settings SET automation_config=(automation_config-'honor_verified_account') || jsonb_build_object('honor_ai',p_config),mode='draft',updated_at=now() WHERE channel=p_channel;
  ELSE RAISE EXCEPTION 'invalid_honor_control'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.honor_ai_control(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.honor_ai_control(text,text,jsonb) TO service_role;

-- Observe verified human echoes. Legacy unattributed outgoing rows stay unknown.
CREATE OR REPLACE FUNCTION public.honor_pause_after_human() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.direction='out' AND NOT NEW.ai_generated AND (NEW.metadata->>'source'='giga_admin_manual' OR NEW.metadata->>'isEcho'='true' OR NEW.metadata->>'humanOutbound'='true') THEN
  UPDATE public.omnichannel_conversations SET auto_reply_override=false WHERE id=NEW.conversation_id;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.honor_pause_after_human() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS honor_pause_after_human ON public.omnichannel_messages;
CREATE TRIGGER honor_pause_after_human AFTER INSERT ON public.omnichannel_messages FOR EACH ROW EXECUTE FUNCTION public.honor_pause_after_human();

CREATE TABLE IF NOT EXISTS public.honor_commerce_evidence (
 user_id uuid NOT NULL,
 company_id uuid NOT NULL,
 source_event_id text PRIMARY KEY CHECK(length(source_event_id) BETWEEN 1 AND 160),
 message_id uuid NOT NULL REFERENCES public.omnichannel_messages(id),
 event_type text NOT NULL CHECK(event_type IN ('click','cart','order','paid')),
 order_external_id text,
 confirmed_revenue numeric(18,2) CHECK(confirmed_revenue>=0),
 occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.honor_commerce_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.honor_commerce_evidence FROM anon,authenticated;
GRANT SELECT,INSERT ON public.honor_commerce_evidence TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS honor_order_once ON public.honor_commerce_evidence(user_id,company_id,order_external_id) WHERE event_type='order';
CREATE UNIQUE INDEX IF NOT EXISTS honor_paid_once ON public.honor_commerce_evidence(user_id,company_id,order_external_id) WHERE event_type='paid';
CREATE OR REPLACE FUNCTION public.honor_record_commerce_evidence(p_event jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_config jsonb; v_paid numeric; v_existing public.honor_commerce_evidence%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_event->>'source_event_id',0));
 SELECT s.automation_config->'honor_ai' INTO v_config FROM public.omnichannel_messages m
 JOIN public.omnichannel_conversations c ON c.id=m.conversation_id JOIN public.omnichannel_settings s ON s.channel=c.channel
 WHERE m.id=(p_event->>'message_id')::uuid AND m.direction='out' AND m.status IN ('sent','delivered','read')
 AND c.account_external_id=s.automation_config->'honor_ai'->>'account_id';
 IF v_config IS NULL THEN RAISE EXCEPTION 'unbound_message'; END IF;
 IF p_event->>'event_type' IN ('order','paid') THEN
  SELECT CASE WHEN p_event->>'event_type'='paid' THEN o.net_paid_amount ELSE NULL END INTO v_paid
  FROM public.ecommerce_orders o WHERE o.external_id=p_event->>'order_external_id'
   AND o.user_id=(v_config->>'user_id')::uuid AND o.company_id=(v_config->>'company_id')::uuid AND o.source='myhonor.shop'
   AND (p_event->>'event_type'<>'paid' OR (o.paid_at IS NOT NULL AND o.net_paid_amount>0 AND o.cancelled_at IS NULL));
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_confirmed'; END IF;
 END IF;
 SELECT * INTO v_existing FROM public.honor_commerce_evidence WHERE source_event_id=p_event->>'source_event_id';
 IF FOUND THEN
  IF v_existing.message_id<>(p_event->>'message_id')::uuid OR v_existing.event_type<>p_event->>'event_type' OR v_existing.order_external_id IS DISTINCT FROM p_event->>'order_external_id' THEN RAISE EXCEPTION 'event_conflict'; END IF;
  RETURN;
 END IF;
 INSERT INTO public.honor_commerce_evidence(user_id,company_id,source_event_id,message_id,event_type,order_external_id,confirmed_revenue,occurred_at)
 VALUES((v_config->>'user_id')::uuid,(v_config->>'company_id')::uuid,p_event->>'source_event_id',(p_event->>'message_id')::uuid,p_event->>'event_type',p_event->>'order_external_id',v_paid,(p_event->>'occurred_at')::timestamptz)
 ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.honor_record_commerce_evidence(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.honor_record_commerce_evidence(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.honor_verify_live_canary(p_message_id uuid,p_actor_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_channel text;v_account text;
BEGIN
 SELECT c.channel,c.account_external_id INTO v_channel,v_account FROM public.omnichannel_messages m
 JOIN public.omnichannel_conversations c ON c.id=m.conversation_id JOIN public.omnichannel_settings s ON s.channel=c.channel
 WHERE m.id=p_message_id AND m.direction='in' AND m.occurred_at>now()-interval '24 hours'
  AND m.metadata->>'providerTimestampTrusted'='true' AND m.metadata->>'catchUp' IS DISTINCT FROM 'true'
  AND m.metadata->>'honorConfigHash'=md5((s.automation_config->'honor_ai')::text)
  AND (m.metadata->>'honorCatalogVerifiedAt')::timestamptz>now()-interval '24 hours'
  AND m.ai_draft IS NOT NULL AND m.ai_confidence>=s.confidence_threshold AND c.auto_reply_override=false
  AND s.automation_config->'honor_ai'->>'account_id'=c.account_external_id
  AND EXISTS(SELECT 1 FROM public.omnichannel_messages o WHERE o.conversation_id=c.id AND o.direction='out' AND o.status IN ('sent','delivered','read')
   AND NOT o.ai_generated AND o.occurred_at>m.occurred_at AND o.metadata->>'source'='giga_admin_manual' AND o.metadata->>'actorId'=p_actor_id::text)
 FOR UPDATE OF c,s;
 IF NOT FOUND THEN RAISE EXCEPTION 'live_canary_required'; END IF;
 UPDATE public.omnichannel_settings SET automation_config=automation_config||jsonb_build_object('honor_verified_account',v_account,'honor_verified_at',now(),'honor_verified_by',p_actor_id),updated_at=now() WHERE channel=v_channel;
END;
$$;
REVOKE ALL ON FUNCTION public.honor_verify_live_canary(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.honor_verify_live_canary(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.honor_mark_catalog_verified(p_message_id uuid,p_config jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.omnichannel_messages m SET metadata=m.metadata||jsonb_build_object('honorCatalogVerifiedAt',now(),'honorConfigHash',md5(p_config::text))
 FROM public.omnichannel_conversations c,public.omnichannel_settings s
 WHERE m.id=p_message_id AND m.direction='in' AND c.id=m.conversation_id AND s.channel=c.channel
 AND s.automation_config->'honor_ai'=p_config AND c.account_external_id=p_config->>'account_id';
 IF NOT FOUND THEN RAISE EXCEPTION 'honor_configuration_changed'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.honor_mark_catalog_verified(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.honor_mark_catalog_verified(uuid,jsonb) TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aistart360_omnichannel_runtime') THEN
  GRANT EXECUTE ON FUNCTION public.honor_mark_catalog_verified(uuid,jsonb) TO aistart360_omnichannel_runtime;
 END IF;
END $$;
-- Reconcile paid revenue against current order truth, including later refunds.
CREATE OR REPLACE VIEW public.honor_commerce_metrics WITH (security_invoker=true) AS
 SELECT e.source_event_id,e.message_id,e.event_type,e.occurred_at,
 CASE WHEN e.event_type='paid' AND o.paid_at IS NOT NULL AND o.cancelled_at IS NULL
 THEN greatest(o.net_paid_amount,0) ELSE NULL END AS confirmed_revenue
 FROM public.honor_commerce_evidence e LEFT JOIN public.ecommerce_orders o
 ON o.user_id=e.user_id AND o.company_id=e.company_id AND o.source='myhonor.shop' AND o.external_id=e.order_external_id;
REVOKE ALL ON public.honor_commerce_metrics FROM anon,authenticated;
GRANT SELECT ON public.honor_commerce_metrics TO service_role;
COMMIT;
