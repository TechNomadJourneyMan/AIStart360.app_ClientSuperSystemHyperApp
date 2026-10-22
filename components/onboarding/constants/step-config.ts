// Titles MUST describe what the step's form actually contains and match the
// vocabulary used everywhere else (SURVEY_STEP_LABELS in lib/survey-labels.ts —
// «Мои данные», readiness widget, Google Sheet headers). E2E 2026-09-10: tabs
// still carried an older journey spec («Регистрация», «Финансы» …) while the
// forms behind them were company info, marketing …, so users hunted for fields.

export const TOTAL_STEPS = 12

// `hint` — a short fill-in tip shown under each step title to guide the user.
// `minutes` — typing time without searching for data, from the question
// inventory (docs/superpowers/specs/2026-10-22-survey-audit-inventory.md);
// the tab shows «~N мин», a started step «осталось ~N мин».
// `why` — «Зачем спрашиваем → что получите» in the step header (survey audit
// 2026-10-22, MVP item 6): trust, fewer skipped questions.
export const STEPS = [
  { n: 1,  title: 'О компании',            minutes: 4, icon: 'business',        hint: 'Название, отрасль, размер, текущая выручка и цели в деньгах на 12 месяцев и 3 года, контакты.', why: { ask: 'масштаб бизнеса и цель в деньгах', get: 'разрыв до цели и нужный темп роста в Точке Б' } },
  { n: 2,  title: 'Цели',                  minutes: 8, icon: 'flag',            hint: 'Своими словами: чего хотите достичь за 12 месяцев и за 3 года, что пробовали и что мешает.', why: { ask: 'цель своими словами задаёт, что считать успехом', get: 'план Точки Б строится вокруг вашей цели' } },
  { n: 3,  title: 'Позиционирование',      minutes: 9, icon: 'ads_click',        hint: 'Кто ваш клиент, какую проблему решаете и почему выбирают вас, а не конкурентов.', why: { ask: 'за что вам платят и чем вы отличаетесь', get: 'сильные и слабые стороны позиционирования в разборе Точки А' } },
  { n: 4,  title: 'Орг. структура',        minutes: 5, icon: 'groups',          hint: 'Отделы, роли и как устроены управление, планёрки и отчётность.', why: { ask: 'держится ли бизнес на вас или на системе', get: 'оценку блока «Операции» и узкие места управления' } },
  { n: 5,  title: 'Работа с базой',        minutes: 12, icon: 'contacts',        hint: 'CRM, сделки и отказы по годам, воронка продаж и почему клиенты покупают.', why: { ask: 'где теряются клиенты между заявкой и оплатой', get: 'воронку и потери в деньгах; «Не знаю» — тоже вывод' } },
  { n: 6,  title: 'Путь клиента',          minutes: 5, icon: 'route',           hint: 'Путь клиента: скрипты звонка, встречи и коммерческого предложения.', why: { ask: 'как клиент проходит путь до покупки и после', get: 'точки, где клиенты уходят, и что поправить первым' } },
  { n: 7,  title: 'Маркетинг',             minutes: 10, icon: 'campaign',        hint: 'Каналы, бюджет, контент и разбор трёх главных конкурентов. Можно примерно.', why: { ask: 'откуда приходят клиенты и сколько это стоит', get: 'оценку маркетинга и карту потерь' } },
  { n: 8,  title: 'Ключевые метрики',      minutes: 8, icon: 'analytics',       hint: 'Метрики по годам (2023–2025), план и факт 2026. Можно вставить таблицу из Excel.', why: { ask: 'динамика ключевых цифр по годам', get: 'тренд выручки и проверку реалистичности цели; можно частично' } },
  { n: 9,  title: 'Финансы',               minutes: 8, icon: 'payments',        hint: 'Выручка, расходы, прибыль, долги и финансовая дисциплина.', why: { ask: 'маржа, расходы, долги и запас прочности', get: 'оценку блока «Финансы» и финансовую модель Точки Б; деликатное можно пропустить' } },
  { n: 10, title: 'Личные вопросы',        minutes: 9, icon: 'person',          hint: 'Про вас как собственника: время, делегирование, видение компании.', why: { ask: 'ваше время и роль — частое узкое место роста', get: 'рекомендации по делегированию и психопрофиль' } },
  { n: 11, title: 'Карта влияния',         minutes: 4, icon: 'hub',             hint: 'Люди и организации, которые могут повлиять на ваш бизнес, и статус отношений с ними.', why: { ask: 'кто может ускорить рост или помешать', get: 'подсказку эксперта, с кем выстроить отношения; можно пропустить' } },
  { n: 12, title: 'Системы и инструменты', minutes: 2, icon: 'monitoring',      hint: 'CRM, ERP, мессенджеры и сервисы, которыми пользуется команда. Последний шаг перед Точкой А.', why: { ask: 'на каких системах работает команда', get: 'что автоматизировать в первую очередь' } },
] as const

export type StepConfig = (typeof STEPS)[number]

/**
 * Delicate or effortful questions: one line under the label — why we ask and
 * that it can be skipped (survey audit К10: «Прозрачность», долги, прибыль
 * had no explanation and no «можно пропустить»).
 */
export const FIELD_NOTES: Readonly<Record<string, string>> = {
  s9n_net_profit: 'Для маржи и точки безубыточности. Можно примерно или «Не знаю».',
  s9n_debts_amount: 'Для запаса прочности в финансовой модели. Можно пропустить.',
  s9n_transparency_pct: 'Только для оценки рисков, третьим лицам не передаётся. Можно пропустить.',
  s9n_tax_system: 'Влияет на расчёт налоговой нагрузки. Можно пропустить.',
  s9n_tax_audits: 'Для оценки рисков. Можно пропустить.',
  s9n_audit_preparedness: 'Для оценки рисков. Можно пропустить.',
  s9n_dividend_policy: 'Чтобы учесть, сколько денег выводится из бизнеса. Можно пропустить.',
  s10_who_to_blame: 'Речь о причинах, а не о поиске виноватых. Можно пропустить.',
  s10_dept_assessment: 'Видите только вы и ваш эксперт. Можно пропустить.',
}
