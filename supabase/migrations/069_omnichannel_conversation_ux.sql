-- 069_omnichannel_conversation_ux.sql
-- Make the equipment lead flow conversational: ask one question per turn,
-- use natural option labels, and keep the community invite for final handoff.
--
-- The exact source signature is intentional. A missing target marker alone is
-- not enough evidence that the row still contains revision 0: an operator may
-- already have edited the copy or choices. In that case this migration must be
-- a no-op, preserving both the manual settings and settings.updated_at (which
-- is used to invalidate pending provider sends rendered from older settings).

WITH expected_revision AS (
  SELECT
    jsonb_build_object(
      'welcome', E'Добрый день, Вы из какого города?\n\nПодбираете экипировку на лето/осень/зиму?\n\nПодключить к Вам менеджера и он поможет Вам подобрать одежду?🙋‍♂️',
      'ask_city', 'Подскажите, пожалуйста, из какого Вы города?',
      'ask_interest', 'Спасибо! Что Вас интересует?',
      'options_prompt', 'Выберите вариант:',
      'handoff', 'Подключаю к Вам менеджера — он поможет подобрать одежду 🙋‍♂️'
    ) AS messages,
    jsonb_build_array(
      jsonb_build_object('id', 'summer', 'label', 'Да, на лето', 'button_label', 'Да, на лето'),
      jsonb_build_object('id', 'autumn_winter', 'label', 'Да, осень-зима', 'button_label', 'Да, осень-зима'),
      jsonb_build_object('id', 'catalog', 'label', 'Хочу ознакомиться с каталогом', 'button_label', 'Открыть каталог'),
      jsonb_build_object('id', 'beginner', 'label', 'Я-новичок', 'button_label', 'Я-новичок'),
      jsonb_build_object('id', 'manager', 'label', 'Позовите менеджера', 'button_label', 'Позовите менеджера')
    ) AS choices,
    'Присоединяйтесь в чат, здесь будем публиковать все новинки и акции'::TEXT AS community_text
)
UPDATE public.omnichannel_settings AS settings
SET automation_config = jsonb_set(
      settings.automation_config,
      '{equipment_sales_flow}',
      (settings.automation_config #> '{equipment_sales_flow}') || jsonb_build_object(
        'conversation_ux_revision', 1,
        'messages', jsonb_build_object(
          'welcome', E'Здравствуйте! Спасибо за интерес к Honor Club 🙌\nПодскажите, пожалуйста, из какого вы города?',
          'ask_city', 'Подскажите, пожалуйста, из какого вы города?',
          'ask_interest', 'Отлично! Что вас интересует?',
          'options_prompt', 'Выберите вариант — можно ответить номером или своими словами 😊',
          'handoff', 'Отлично! Менеджер поможет вам с выбором 🙌',
          'handoff_by_choice', jsonb_build_object(
            'summer', 'Отлично! Менеджер поможет подобрать экипировку на лето 🙌',
            'autumn_winter', 'Отлично! Менеджер поможет подобрать экипировку на осень и зиму 🙌',
            'catalog', 'Отлично! Менеджер отправит актуальный каталог и поможет с выбором 🙌',
            'beginner', 'Конечно! Менеджер поможет подобрать экипировку с нуля 🙌',
            'manager', 'Хорошо! Передаю вас менеджеру 🙌'
          )
        ),
        'choices', jsonb_build_array(
          jsonb_build_object('id', 'summer', 'label', 'Экипировка на лето', 'button_label', 'На лето'),
          jsonb_build_object('id', 'autumn_winter', 'label', 'Экипировка на осень–зиму', 'button_label', 'Осень–зима'),
          jsonb_build_object('id', 'catalog', 'label', 'Посмотреть каталог', 'button_label', 'Каталог'),
          jsonb_build_object('id', 'beginner', 'label', 'Я новичок, нужна помощь', 'button_label', 'Я новичок'),
          jsonb_build_object('id', 'manager', 'label', 'Связаться с менеджером', 'button_label', 'Менеджер')
        ),
        'community', (settings.automation_config #> '{equipment_sales_flow,community}') || jsonb_build_object(
          'text', 'Новинки и акции — в нашем сообществе:'
        )
      ),
      TRUE
    )
FROM expected_revision AS expected
WHERE jsonb_typeof(settings.automation_config #> '{equipment_sales_flow}') = 'object'
  AND settings.automation_config #> '{equipment_sales_flow,version}' = '1'::jsonb
  AND settings.automation_config #> '{equipment_sales_flow,opt_in_revision}' = '1'::jsonb
  AND settings.automation_config #> '{equipment_sales_flow,conversation_ux_revision}' IS NULL
  AND settings.automation_config #> '{equipment_sales_flow,messages}' = expected.messages
  AND settings.automation_config #> '{equipment_sales_flow,choices}' = expected.choices
  AND settings.automation_config #>> '{equipment_sales_flow,community,text}' = expected.community_text;
