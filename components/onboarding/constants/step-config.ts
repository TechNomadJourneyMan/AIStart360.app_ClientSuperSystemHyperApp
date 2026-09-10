// Titles MUST describe what the step's form actually contains and match the
// vocabulary used everywhere else (SURVEY_STEP_LABELS in lib/survey-labels.ts —
// «Мои данные», readiness widget, Google Sheet headers). E2E 2026-09-10: tabs
// still carried an older journey spec («Регистрация», «Финансы» …) while the
// forms behind them were company info, marketing …, so users hunted for fields.

export const TOTAL_STEPS = 12

// `hint` — a short fill-in tip shown under each step title to guide the user.
export const STEPS = [
  { n: 1,  title: 'О компании',            icon: 'business',        hint: 'Название, отрасль, размер, текущая выручка и цели в деньгах на 12 месяцев и 3 года, контакты.' },
  { n: 2,  title: 'Цели',                  icon: 'flag',            hint: 'Своими словами: чего хотите достичь за 12 месяцев и за 3 года, что пробовали и что мешает.' },
  { n: 3,  title: 'Позиционирование',      icon: 'ads_click',        hint: 'Кто ваш клиент, какую проблему решаете и почему выбирают вас, а не конкурентов.' },
  { n: 4,  title: 'Орг. структура',        icon: 'groups',          hint: 'Отделы, роли и как устроены управление, планёрки и отчётность.' },
  { n: 5,  title: 'Работа с базой',        icon: 'contacts',        hint: 'CRM, сделки и отказы по годам, воронка продаж и почему клиенты покупают.' },
  { n: 6,  title: 'CJM',                   icon: 'route',           hint: 'Путь клиента: скрипты звонка, встречи и коммерческого предложения.' },
  { n: 7,  title: 'Маркетинг',             icon: 'campaign',        hint: 'Каналы, бюджет, контент и разбор трёх главных конкурентов. Можно примерно.' },
  { n: 8,  title: 'Ключевые метрики',      icon: 'analytics',       hint: 'Метрики по годам (2023–2025), план и факт 2026. Можно вставить таблицу из Excel.' },
  { n: 9,  title: 'Финансы',               icon: 'payments',        hint: 'Выручка, расходы, прибыль, долги и финансовая дисциплина.' },
  { n: 10, title: 'Личные вопросы',        icon: 'person',          hint: 'Про вас как собственника: время, делегирование, видение компании.' },
  { n: 11, title: 'Карта влияния',         icon: 'hub',             hint: 'Люди и организации, которые могут повлиять на ваш бизнес, и статус отношений с ними.' },
  { n: 12, title: 'Системы и инструменты', icon: 'monitoring',      hint: 'CRM, ERP, мессенджеры и сервисы, которыми пользуется команда. Последний шаг перед Точкой А.' },
] as const

export type StepConfig = (typeof STEPS)[number]
