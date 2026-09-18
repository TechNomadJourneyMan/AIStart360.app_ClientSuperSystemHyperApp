-- 072_omnichannel_direct_catalog.sql
-- Give explicit catalog/site requests a configured, deterministic destination.
-- Both customer channels must move together; a partial or operator-customized
-- state fails closed rather than silently overwriting one channel.

DO $migration$
DECLARE
  v_catalog CONSTANT JSONB := jsonb_build_object(
    'text', 'Конечно! Посмотреть каталог можно здесь:',
    'url', 'https://myhonor.shop/catalog'
  );
  v_target_count INTEGER;
  v_current_count INTEGER;
  v_updated_count INTEGER;
BEGIN
  SELECT count(*)
    INTO v_target_count
    FROM public.omnichannel_settings AS settings
   WHERE settings.channel IN ('instagram', 'whatsapp')
     AND settings.business_context LIKE
       'HONOR_GROUP_CONTEXT_REVISION=2026-07-17-v1%'
     AND settings.automation_config #> '{equipment_sales_flow,version}' = '1'::jsonb
     AND settings.automation_config #> '{equipment_sales_flow,opt_in_revision}' = '1'::jsonb
     AND jsonb_typeof(
       settings.automation_config #> '{equipment_sales_flow}'
     ) = 'object';

  IF v_target_count <> 2 THEN
    RAISE EXCEPTION
      'Direct catalog migration aborted: expected 2 guarded Honor channels, got %',
      v_target_count;
  END IF;

  SELECT count(*)
    INTO v_current_count
    FROM public.omnichannel_settings AS settings
   WHERE settings.channel IN ('instagram', 'whatsapp')
     AND settings.automation_config #> '{equipment_sales_flow,catalog}' = v_catalog;

  IF v_current_count = 1 THEN
    RAISE EXCEPTION
      'Direct catalog migration aborted: only one channel has the target catalog';
  END IF;

  IF v_current_count = 0 THEN
    IF EXISTS (
      SELECT 1
        FROM public.omnichannel_settings AS settings
       WHERE settings.channel IN ('instagram', 'whatsapp')
         AND settings.automation_config #> '{equipment_sales_flow,catalog}'
           IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'Direct catalog migration aborted: an operator catalog configuration already exists';
    END IF;

    UPDATE public.omnichannel_settings AS settings
       SET automation_config = jsonb_set(
             settings.automation_config,
             '{equipment_sales_flow,catalog}',
             v_catalog,
             TRUE
           ),
           updated_at = NOW()
     WHERE settings.channel IN ('instagram', 'whatsapp')
       AND settings.business_context LIKE
         'HONOR_GROUP_CONTEXT_REVISION=2026-07-17-v1%'
       AND settings.automation_config #> '{equipment_sales_flow,version}' = '1'::jsonb
       AND settings.automation_config #> '{equipment_sales_flow,opt_in_revision}' = '1'::jsonb
       AND jsonb_typeof(
         settings.automation_config #> '{equipment_sales_flow}'
       ) = 'object'
       AND settings.automation_config #> '{equipment_sales_flow,catalog}'
         IS NULL;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> 2 THEN
      RAISE EXCEPTION
        'Direct catalog migration aborted: expected 2 guarded updates, got %',
        v_updated_count;
    END IF;
  END IF;
END
$migration$;
