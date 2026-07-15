-- 062_omnichannel_equipment_sales_flow.sql
-- Versioned, operator-editable deterministic playbook for Instagram/WhatsApp.
-- Business routing data lives in the database; the LLM never chooses or rewrites it.

ALTER TABLE public.omnichannel_settings
  ADD COLUMN IF NOT EXISTS automation_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Repair an earlier partial development revision where the column could have
-- existed without the final default/nullability contract.
UPDATE public.omnichannel_settings
SET automation_config = '{}'::jsonb
WHERE automation_config IS NULL;
ALTER TABLE public.omnichannel_settings
  ALTER COLUMN automation_config SET DEFAULT '{}'::jsonb,
  ALTER COLUMN automation_config SET NOT NULL;

ALTER TABLE public.omnichannel_settings
  DROP CONSTRAINT IF EXISTS omnichannel_settings_automation_config_object_check;
ALTER TABLE public.omnichannel_settings
  ADD CONSTRAINT omnichannel_settings_automation_config_object_check
  CHECK (jsonb_typeof(automation_config) = 'object');

-- Seed only the missing playbook key and keep it explicitly disabled. An
-- operator enables it in draft mode after migration/smoke checks.
UPDATE public.omnichannel_settings
SET automation_config = jsonb_set(
  automation_config,
  '{equipment_sales_flow}',
  $config$
{
  "version": 1,
  "opt_in_revision": 1,
  "enabled": false,
  "messages": {
    "welcome": "Добрый день, Вы из какого города?\n\nПодбираете экипировку на лето/осень/зиму?\n\nПодключить к Вам менеджера и он поможет Вам подобрать одежду?🙋‍♂️",
    "ask_city": "Подскажите, пожалуйста, из какого Вы города?",
    "ask_interest": "Спасибо! Что Вас интересует?",
    "options_prompt": "Выберите вариант:",
    "handoff": "Подключаю к Вам менеджера — он поможет подобрать одежду 🙋‍♂️"
  },
  "choices": [
    { "id": "summer", "label": "Да, на лето", "button_label": "Да, на лето" },
    { "id": "autumn_winter", "label": "Да, осень-зима", "button_label": "Да, осень-зима" },
    { "id": "catalog", "label": "Хочу ознакомиться с каталогом", "button_label": "Открыть каталог" },
    { "id": "beginner", "label": "Я-новичок", "button_label": "Я-новичок" },
    { "id": "manager", "label": "Позовите менеджера", "button_label": "Позовите менеджера" }
  ],
  "city_routes": [
    {
      "id": "astana",
      "label": "Астана",
      "aliases": ["астана", "астаны", "астане", "астану", "astana", "нур-султан", "нур султан", "nur-sultan", "nur sultan"],
      "manager_phone": "77054057775"
    },
    {
      "id": "ust_kamenogorsk",
      "label": "Усть-Каменогорск",
      "aliases": ["усть-каменогорск", "усть-каменогорска", "усть-каменогорске", "усть каменогорск", "усть каменогорска", "усть каменогорске", "устькаменогорск", "өскемен", "өскеменде", "оскемен", "оскемена", "oskemen", "ust-kamenogorsk"],
      "manager_phone": "77714057775"
    },
    {
      "id": "other",
      "label": "Другой город",
      "aliases": ["другой город", "другие города"],
      "manager_phone": "77780457775"
    }
  ],
  "fallback_route_id": "other",
  "community": {
    "text": "Присоединяйтесь в чат, здесь будем публиковать все новинки и акции",
    "url": "https://chat.whatsapp.com/JDaVNsnloFMF0RpOtLSDRW?mode=gi_t"
  }
}
$config$::jsonb,
  true
)
WHERE NOT (automation_config ? 'equipment_sales_flow');

-- An unfinished development revision of 062 seeded version 1 as enabled. Reset
-- that revision exactly once without replacing operator-edited messages/routes.
-- The marker makes later reruns idempotent and preserves a subsequent opt-in.
UPDATE public.omnichannel_settings
SET automation_config = jsonb_set(
  jsonb_set(
    automation_config,
    '{equipment_sales_flow,enabled}',
    'false'::jsonb,
    TRUE
  ),
  '{equipment_sales_flow,opt_in_revision}',
  '1'::jsonb,
  TRUE
)
WHERE automation_config #> '{equipment_sales_flow,version}' = '1'::jsonb
  AND automation_config #> '{equipment_sales_flow,opt_in_revision}' IS NULL;

-- Replace the first development signature so rerunning 062 converges to one
-- unambiguous PostgREST RPC. The settings timestamp binds the provider send to
-- the exact playbook revision used to render the reply.
DROP FUNCTION IF EXISTS public.claim_omnichannel_equipment_flow_send(UUID);

CREATE OR REPLACE FUNCTION public.claim_omnichannel_equipment_flow_send(
  p_message_id UUID,
  p_expected_settings_updated_at TIMESTAMPTZ
)
RETURNS TABLE (claimed BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base RECORD;
  v_settings public.omnichannel_settings%ROWTYPE;
  v_channel TEXT;
BEGIN
  SELECT * INTO v_base
  FROM public.claim_omnichannel_auto_send(p_message_id);
  IF NOT COALESCE(v_base.claimed, FALSE) THEN
    RETURN QUERY SELECT FALSE, COALESCE(v_base.reason, 'claim_denied')::TEXT;
    RETURN;
  END IF;

  SELECT channel INTO v_channel
  FROM public.omnichannel_messages
  WHERE id = p_message_id;

  SELECT * INTO v_settings
  FROM public.omnichannel_settings
  WHERE channel = v_channel
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.omnichannel_messages
    SET status = 'processing'
    WHERE id = p_message_id
      AND status = 'sending';
    RETURN QUERY SELECT FALSE, 'equipment_flow_settings_not_found'::TEXT;
    RETURN;
  END IF;

  IF p_expected_settings_updated_at IS NULL
     OR v_settings.updated_at IS DISTINCT FROM p_expected_settings_updated_at THEN
    UPDATE public.omnichannel_messages
    SET status = 'processing'
    WHERE id = p_message_id
      AND status = 'sending';
    RETURN QUERY SELECT FALSE, 'equipment_flow_settings_changed'::TEXT;
    RETURN;
  END IF;

  IF v_settings.automation_config #> '{equipment_sales_flow,enabled}'
       IS DISTINCT FROM 'true'::jsonb
     OR v_settings.automation_config #> '{equipment_sales_flow,version}'
       IS DISTINCT FROM '1'::jsonb
     OR v_settings.automation_config #> '{equipment_sales_flow,opt_in_revision}'
       IS DISTINCT FROM '1'::jsonb THEN
    -- The base claim may have moved processing -> sending. Revert that state
    -- inside this transaction when the scenario-specific authorization fails.
    UPDATE public.omnichannel_messages
    SET status = 'processing'
    WHERE id = p_message_id
      AND status = 'sending';
    RETURN QUERY SELECT FALSE, 'equipment_flow_disabled_or_changed'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, 'claimed'::TEXT;
END;
$$;

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
  IF p_channel IS NULL OR p_channel NOT IN ('instagram', 'whatsapp') THEN
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

CREATE OR REPLACE FUNCTION public.finalize_omnichannel_equipment_flow_reply(
  p_message_id UUID,
  p_conversation_id UUID,
  p_stage TEXT,
  p_choice_id TEXT,
  p_choice_label TEXT,
  p_city_route_id TEXT,
  p_city_label TEXT,
  p_manager_url TEXT,
  p_community_included BOOLEAN,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_existing_community_sent_at TEXT;
  v_state JSONB;
BEGIN
  IF p_stage NOT IN ('welcome', 'awaiting_city', 'awaiting_interest', 'routed') THEN
    RAISE EXCEPTION 'invalid equipment flow stage';
  END IF;

  SELECT metadata #>> '{equipmentSalesFlow,communitySentAt}'
  INTO v_existing_community_sent_at
  FROM public.omnichannel_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  v_state := jsonb_strip_nulls(jsonb_build_object(
    'version', 1,
    'stage', p_stage,
    'choiceId', p_choice_id,
    'cityRouteId', p_city_route_id,
    'cityLabel', p_city_label,
    'managerUrl', p_manager_url,
    'communitySentAt', CASE
      WHEN p_community_included THEN v_now::TEXT
      ELSE v_existing_community_sent_at
    END,
    'updatedAt', v_now::TEXT,
    'routedAt', CASE WHEN p_stage = 'routed' THEN v_now::TEXT ELSE NULL END
  ));

  UPDATE public.omnichannel_messages
  SET
    status = 'replied',
    ai_reason = left(COALESCE(p_reason, 'safe_auto_reply'), 500),
    processed_at = v_now
  WHERE id = p_message_id
    AND conversation_id = p_conversation_id
    AND direction = 'in'
    AND status = 'sending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inbound message not found';
  END IF;

  UPDATE public.omnichannel_conversations
  SET
    metadata = jsonb_set(metadata, '{equipmentSalesFlow}', v_state, TRUE),
    status = CASE WHEN p_stage = 'routed' THEN 'needs_human' ELSE status END,
    auto_reply_override = CASE WHEN p_stage = 'routed' THEN FALSE ELSE auto_reply_override END,
    summary = CASE
      WHEN p_stage = 'routed' THEN left(
        'Лид по экипировке: ' || COALESCE(p_choice_label, 'вариант не указан')
        || '; город ' || COALESCE(p_city_label, 'не указан')
        || '; направлен менеджеру.',
        800
      )
      ELSE summary
    END
  WHERE id = p_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_omnichannel_equipment_flow_send(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_omnichannel_equipment_flow_send(UUID, TIMESTAMPTZ)
  TO service_role;
REVOKE ALL ON FUNCTION public.set_omnichannel_equipment_flow_enabled(TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_omnichannel_equipment_flow_enabled(TEXT, BOOLEAN)
  TO service_role;
REVOKE ALL ON FUNCTION public.finalize_omnichannel_equipment_flow_reply(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_omnichannel_equipment_flow_reply(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';
