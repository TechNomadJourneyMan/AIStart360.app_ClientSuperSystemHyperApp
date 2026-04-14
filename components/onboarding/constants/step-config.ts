export const TOTAL_STEPS = 12

export const STEPS = [
  { n: 1, title: 'О компании', icon: 'business' },
  { n: 2, title: 'Цели', icon: 'flag' },
  { n: 3, title: 'Позиционирование', icon: 'groups' },
  { n: 4, title: 'Орг. структура', icon: 'account_tree' },
  { n: 5, title: 'Работа с базой', icon: 'database' },
  { n: 6, title: 'CJM', icon: 'route' },
  { n: 7, title: 'Маркетинг', icon: 'campaign' },
  { n: 8, title: 'Ключевые метрики', icon: 'monitoring' },
  { n: 9, title: 'Финансы', icon: 'payments' },
  { n: 10, title: 'Личные вопросы', icon: 'person' },
  { n: 11, title: 'Карта влияния', icon: 'hub' },
  { n: 12, title: 'Инструменты', icon: 'build' },
] as const

export type StepConfig = (typeof STEPS)[number]
