// Spec from AIStart360_Metrics_Guide (Part 1). The 12-step client journey:
// 1 Регистрация → 2 Цели → 3 О компании → 4 Загрузка → 5 Проверка →
// 6 Уточняющий опрос → 7 Финансы → 8 Аудит базы → 9 Сегментация →
// 10 Диагностика потерь → 11 Стратегия → 12 Метрики и дашборд

export const TOTAL_STEPS = 12

export const STEPS = [
  { n: 1, title: 'Регистрация', icon: 'how_to_reg' },
  { n: 2, title: 'Цели', icon: 'flag' },
  { n: 3, title: 'О компании', icon: 'business' },
  { n: 4, title: 'Загрузка данных', icon: 'cloud_upload' },
  { n: 5, title: 'Проверка данных', icon: 'rule' },
  { n: 6, title: 'Уточняющий опрос', icon: 'quiz' },
  { n: 7, title: 'Финансы', icon: 'payments' },
  { n: 8, title: 'Аудит базы', icon: 'analytics' },
  { n: 9, title: 'Сегментация', icon: 'groups' },
  { n: 10, title: 'Диагностика потерь', icon: 'trending_down' },
  { n: 11, title: 'Стратегия', icon: 'route' },
  { n: 12, title: 'Метрики и дашборд', icon: 'monitoring' },
] as const

export type StepConfig = (typeof STEPS)[number]
