-- 069_omnichannel_conversation_ux.sql
-- Make the equipment lead flow conversational: ask one question per turn,
-- use natural option labels, and keep the community invite for final handoff.

UPDATE public.omnichannel_settings
SET automation_config = jsonb_set(
      automation_config,
      '{equipment_sales_flow}',
      (automation_config #> '{equipment_sales_flow}') || jsonb_build_object(
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
        'community', (automation_config #> '{equipment_sales_flow,community}') || jsonb_build_object(
          'text', 'Новинки и акции — в нашем сообществе:'
        )
      ),
      TRUE
    ),
    updated_at = NOW()
WHERE jsonb_typeof(automation_config #> '{equipment_sales_flow}') = 'object'
  AND automation_config #> '{equipment_sales_flow,version}' = '1'::jsonb
  AND automation_config #> '{equipment_sales_flow,opt_in_revision}' = '1'::jsonb
  AND automation_config #> '{equipment_sales_flow,conversation_ux_revision}' IS NULL;
