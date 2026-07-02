/**
 * lib/assistant/mascot/tours.ts — per-screen coachmark tours (ТЗ v1.4).
 *
 * Every tour is a list of steps anchored to REAL interface elements by CSS
 * selector; the coachmark engine highlights the element (spotlight) and shows
 * the mascot's card with an arrow. A step whose selector matches nothing is
 * skipped silently, so tours stay resilient to page changes. Keyed by the
 * normalized screen (hints.normalizeScreen); completed screens are stored in
 * settings.toursDone.
 */

export interface TourStep {
  /** CSS selector; the first visible match is highlighted. */
  selector: string
  title: string
  text: string
}

/** The mascot itself — the closing step of every tour. */
const MASCOT_STEP: TourStep = {
  selector: 'button[aria-label*="открыть чат с ассистентом"]',
  title: 'А это я 🐾',
  text: 'Кликните по мне — открою чат по вашим данным. В меню «⋯» — AI-инсайт, сворачивание и настройки. Иногда я гуляю или сплю — работе это не мешает.',
}

export const TOURS: Record<string, TourStep[]> = {
  '/dashboard': [
    {
      selector: '#key-metrics',
      title: 'Ключевые метрики',
      text: 'Шесть главных KPI бизнеса с зонами внимания. Пустая метрика искажает расчёты сильнее неточной — заполняйте хотя бы порядок величин.',
    },
    {
      selector: '#company-data',
      title: 'Данные компании',
      text: 'Анкета по блокам — основа всей диагностики. Видно, какие разделы заполнены, а какие ещё ждут.',
    },
    {
      selector: '#market-analysis',
      title: 'Анализ рынка',
      text: 'TAM/SAM/SOM, тренды и конкуренты. Если пусто — нажмите «Сформировать анализ», и AI заполнит 50 параметров по вашей анкете.',
    },
    MASCOT_STEP,
  ],
  '/client/dashboard': [
    {
      selector: 'h1',
      title: 'Ваш кабинет',
      text: 'Здесь прогресс диагностики и быстрые действия. Три шага до результата: анкета → документы → GRI.',
    },
    MASCOT_STEP,
  ],
  '/client/onboarding': [
    {
      selector: 'h1',
      title: 'Анкета — 12 разделов',
      text: 'Основа диагностики. Не гонитесь за точностью до тенге: приблизительные цифры лучше пустых полей — уточните позже.',
    },
    MASCOT_STEP,
  ],
  '/gri': [
    {
      selector: 'h1',
      title: 'GRI — индекс готовности к росту',
      text: 'От 0 до 10 по семи блокам. Смотрите не на сам индекс, а на топ-ограничения — работа с ними быстрее всего поднимает GRI.',
    },
    MASCOT_STEP,
  ],
  '/pulse': [
    {
      selector: 'h1',
      title: 'GRI Pulse — динамика',
      text: 'Pulse полезен в сравнении: заходите после каждого изменения данных и смотрите, как двигается индекс и блоки.',
    },
    MASCOT_STEP,
  ],
  '/point-a': [
    {
      selector: 'h1',
      title: 'Точка А — где бизнес сейчас',
      text: 'Честный разбор по блокам: финансы, продажи, операции, маркетинг, стратегия. Красные блоки — не приговор, а порядок действий.',
    },
    MASCOT_STEP,
  ],
  '/client/point-a': [
    {
      selector: 'h1',
      title: 'Точка А — где бизнес сейчас',
      text: 'Честный разбор по блокам. Начинайте с самого слабого — это самый быстрый рост.',
    },
    MASCOT_STEP,
  ],
  '/point-b': [
    {
      selector: 'h1',
      title: 'Точка B — ваша цель',
      text: 'Платформа считает разрыв до цели и требуемый темп роста. Реализм цели важнее её амбициозности.',
    },
    MASCOT_STEP,
  ],
  '/client/point-b': [
    {
      selector: 'h1',
      title: 'Точка B — ваша цель',
      text: 'Разрыв до цели, требуемый темп и оценка реалистичности — всё по вашим данным.',
    },
    MASCOT_STEP,
  ],
  '/metrics': [
    {
      selector: 'h1',
      title: 'Метрики',
      text: 'Финансовые показатели компании. Их можно вносить вручную или загрузить отчёты — AI извлечёт цифры автоматически.',
    },
    MASCOT_STEP,
  ],
  '/market': [
    {
      selector: 'main button[aria-pressed]',
      title: 'Карта рынка',
      text: 'Вкладки: карта конкурентов Казахстана, анализ ниши, чек-лист 50 параметров и новости отрасли. Всё работает на живых данных Mark-analytics.',
    },
    MASCOT_STEP,
  ],
}

/** Tour for a normalized screen, or null when the screen has none. */
export function tourForScreen(screen: string): TourStep[] | null {
  return TOURS[screen] ?? null
}
