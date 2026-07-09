/**
 * lib/assistant/mascot/tour-guide.ts — движок онбординг-экскурсии «Первые шаги».
 *
 * Экскурсия — упорядоченный маршрут «страница → короткий тур»: пользователь идёт
 * по ключевым разделам, на каждом запускается пер-страничный коачмарк-тур
 * (lib/assistant/mascot/tours.ts), а прохождение продвигает чеклист. Здесь —
 * ТОЛЬКО чистая логика (маршрут + арифметика шагов); никакого React/DOM. Оркестр
 * (переходы, ожидание маунта, PATCH прогресса) живёт в MascotAssistant.
 *
 * Маршрут детерминирован (общий для роли; staff-роли отсеяны гейтом в
 * MascotAssistant) и не зависит от текущего экрана, поэтому одинаково
 * пересобирается на каждом маунте — экскурсия переживает ремоунт между
 * layout-группами без хранения маршрута в сторе.
 *
 * stepIdx индексирует ВИДИМЫЕ шаги (visibleSteps), а не полный TOUR_GUIDE_STEPS:
 * шаг без тура в TOURS отфильтровывается, поэтому экскурсия никогда не упирается
 * в «мёртвый» экран. Батч C дополняет каталог TOURS — фильтр подхватит новые
 * туры автоматически, а счёт «N / total» останется корректным.
 */

export interface TourGuideStep {
  /** Нормализованный экран (он же ключ TOURS / hints.normalizeScreen). */
  screen: string
  /** Короткий RU-заголовок пункта чеклиста. */
  title: string
}

/**
 * Маршрут экскурсии для клиента/владельца в dashboard-группе (staff-роли отсеяны
 * гейтом в MascotAssistant). Порядок = порядок прохождения. Экраны совпадают с
 * реальными nav-href (lib/navigation.ts) и доступны клиенту (CLIENT_OK). На
 * рантайме фильтруется через visibleSteps до экранов, у которых есть тур в TOURS.
 */
export const TOUR_GUIDE_STEPS: TourGuideStep[] = [
  { screen: '/dashboard', title: 'Дашборд' },
  { screen: '/gri', title: 'GRI-диагностика' },
  { screen: '/point-a', title: 'Точка А' },
  { screen: '/point-b', title: 'Точка Б' },
  { screen: '/pulse', title: 'Клиенты и пульс' },
  { screen: '/metrics', title: 'Метрики' },
  { screen: '/market', title: 'Рынок' },
]

/** Оставить только шаги, у которых есть тур (hasTour(screen) === true). */
export function visibleSteps(
  steps: TourGuideStep[],
  hasTour: (screen: string) => boolean,
): TourGuideStep[] {
  return steps.filter((s) => hasTour(s.screen))
}

/**
 * Прижать индекс шага к целому в диапазоне 0..total. total (а не total-1)
 * допустим сознательно — это индекс-сентинел «экскурсия пройдена» (stepIdx ===
 * total при status='done'). Нечисло/NaN/Infinity → 0 / total.
 */
export function clampStepIdx(idx: number, total: number): number {
  if (!Number.isFinite(idx)) return 0
  const max = Math.max(0, total)
  return Math.min(Math.max(0, Math.trunc(idx)), max)
}

/** Следующий шаг: current+1, прижатый к диапазону (после последнего → total). */
export function nextStepIdx(current: number, total: number): number {
  return clampStepIdx(current + 1, total)
}

/** Последний ли это видимый шаг (после него — финиш экскурсии). */
export function isLastStep(idx: number, total: number): boolean {
  return total > 0 && idx === total - 1
}
