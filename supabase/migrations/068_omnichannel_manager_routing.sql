-- 068_omnichannel_manager_routing.sql
-- Business rule: Astana keeps its dedicated manager; every other city uses
-- the shared manager number. Keep the rule consistent across channels so an
-- Instagram flow cannot be enabled later with stale routing.

UPDATE public.omnichannel_settings AS settings
SET automation_config = jsonb_set(
      settings.automation_config,
      '{equipment_sales_flow,city_routes}',
      (
        SELECT jsonb_agg(
                 CASE
                   WHEN route.value ->> 'id' = 'astana'
                     THEN jsonb_set(route.value, '{manager_phone}', to_jsonb('77054057775'::TEXT), TRUE)
                   ELSE jsonb_set(route.value, '{manager_phone}', to_jsonb('77714057775'::TEXT), TRUE)
                 END
                 ORDER BY route.ordinality
               )
        FROM jsonb_array_elements(
               settings.automation_config #> '{equipment_sales_flow,city_routes}'
             ) WITH ORDINALITY AS route(value, ordinality)
      ),
      TRUE
    ),
    updated_at = NOW()
WHERE jsonb_typeof(
        settings.automation_config #> '{equipment_sales_flow,city_routes}'
      ) = 'array'
  AND jsonb_array_length(
        settings.automation_config #> '{equipment_sales_flow,city_routes}'
      ) > 0;
