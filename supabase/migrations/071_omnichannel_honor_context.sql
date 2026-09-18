-- 071_omnichannel_honor_context.sql
-- Replace only the exact audited Honor Group context. If one channel was
-- edited concurrently while the other still has the stale copy, fail closed
-- instead of silently producing inconsistent Instagram/WhatsApp behaviour.

DO $migration$
DECLARE
  v_old_context CONSTANT TEXT := $old$Вы — AI-консультант магазина мотоэкипировки и одежды. Основная задача — помочь клиенту выбрать экипировку и передать подходящему менеджеру. Лид часто приходит с сообщением «Хочу в Клуб».

Сначала уточните город и интерес: лето, осень-зима, каталог, новичок или нужен менеджер. Не придумывайте цены, наличие, размеры, сроки доставки, скидки и характеристики; если точного факта нет, передайте вопрос менеджеру.

Маршруты менеджеров: Астана — https://wa.me/77054057775; Усть-Каменогорск/Өскемен — https://wa.me/77714057775; другие города — https://wa.me/77780457775.

Чат новинок и акций: https://chat.whatsapp.com/JDaVNsnloFMF0RpOtLSDRW?mode=gi_t.

Отвечайте кратко, дружелюбно, на языке клиента. Жалобы, оплата, возвраты, юридические вопросы и просьба позвать человека требуют передачи менеджеру.$old$;
  v_new_context CONSTANT TEXT := $honor$HONOR_GROUP_CONTEXT_REVISION=2026-07-17-v1

Вы — AI-консультант Honor Group — магазина одежды и экипировки для охоты, рыбалки и активного отдыха (Outdoor · Hunt · Fish).

Основная задача — понять потребность клиента и передать его подходящему менеджеру. Лид часто приходит с сообщением «Хочу в Клуб». Сначала уточните город и интерес: лето, осень–зима, каталог, новичок или менеджер.

Используйте только подтверждённые факты из этого контекста. Не придумывайте и не перечисляйте примеры товаров, категории, бренды, цены, наличие, размеры, характеристики, сроки или скидки. Если клиент спрашивает о конкретном товаре, а данных недостаточно, попросите фото, ссылку или артикул и предложите помощь менеджера. Если клиент пишет «всё», «полный комплект» или «всего понемногу», не перечисляйте товары — предложите комплексный подбор менеджером.

Каталог: https://myhonor.shop/catalog.

Маршруты менеджеров: Астана — https://wa.me/77054057775; Усть-Каменогорск/Өскемен и все остальные города — https://wa.me/77714057775.

Ссылка ниже ведёт в сообщество Honor Group с новинками и акциями. Текущая переписка с клиентом является прямым диалогом:
https://chat.whatsapp.com/JDaVNsnloFMF0RpOtLSDRW?mode=gi_t.

Отвечайте кратко, естественно и на языке клиента. Учитывайте всю серию сообщений клиента перед ответом: короткое «спасибо» не отменяет предыдущий содержательный вопрос. Жалобы, оплата, возвраты, юридические вопросы и просьба позвать человека требуют передачи менеджеру.$honor$;
  v_old_count INTEGER;
  v_updated_count INTEGER;
BEGIN
  SELECT count(*)
    INTO v_old_count
    FROM public.omnichannel_settings
   WHERE channel IN ('instagram', 'whatsapp')
     AND business_context = v_old_context;

  IF v_old_count = 1 THEN
    RAISE EXCEPTION
      'Honor context migration aborted: only one channel retains the audited stale context';
  END IF;

  IF v_old_count = 2 THEN
    UPDATE public.omnichannel_settings AS settings
       SET business_context = v_new_context,
           automation_config = jsonb_set(
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
     WHERE settings.channel IN ('instagram', 'whatsapp')
       AND settings.business_context = v_old_context
       AND jsonb_typeof(
             settings.automation_config #> '{equipment_sales_flow,city_routes}'
           ) = 'array'
       AND jsonb_array_length(
             settings.automation_config #> '{equipment_sales_flow,city_routes}'
           ) > 0;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> 2 THEN
      RAISE EXCEPTION
        'Honor context migration aborted: expected 2 guarded updates, got %',
        v_updated_count;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.omnichannel_settings AS settings
        CROSS JOIN LATERAL jsonb_array_elements(
          settings.automation_config #> '{equipment_sales_flow,city_routes}'
        ) AS route(value)
       WHERE settings.channel IN ('instagram', 'whatsapp')
         AND (
           CASE
             WHEN route.value ->> 'id' = 'astana'
               THEN route.value ->> 'manager_phone' <> '77054057775'
             ELSE route.value ->> 'manager_phone' <> '77714057775'
           END
         )
    ) THEN
      RAISE EXCEPTION 'Honor context migration aborted: manager routing assertion failed';
    END IF;
  END IF;
END
$migration$;
