/**
 * lib/admin/tasks-due.ts — сроки задач персонала: фильтры API и секции
 * страницы «Мои задачи» (Просрочено / Сегодня / На неделе / Позже / Без срока).
 *
 * Границы дня считаются в часовом поясе сотрудника: браузер передаёт своё
 * смещение (`Date#getTimezoneOffset`, минуты), иначе — UTC.
 */

export const DUE_FILTERS = ['overdue', 'today', 'week', 'none'] as const
export type DueFilter = (typeof DUE_FILTERS)[number]
export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none'

export function isDueFilter(v: unknown): v is DueFilter {
  return typeof v === 'string' && (DUE_FILTERS as readonly string[]).includes(v)
}

/** Начало «сегодня» (UTC-момент) для пользователя со смещением `tzOffsetMin`. */
export function startOfLocalDay(now: Date, tzOffsetMin = 0): Date {
  const local = new Date(now.getTime() - tzOffsetMin * 60_000)
  local.setUTCHours(0, 0, 0, 0)
  return new Date(local.getTime() + tzOffsetMin * 60_000)
}

/**
 * Диапазон due_at для фильтра: [from, to). `null` у границы — без ограничения.
 * 'none' — задачи без срока (обрабатывается отдельно: due_at IS NULL).
 */
export function dueRange(filter: DueFilter, now: Date = new Date(), tzOffsetMin = 0): { from: string | null; to: string | null } | 'none' {
  if (filter === 'none') return 'none'
  const today = startOfLocalDay(now, tzOffsetMin)
  const tomorrow = new Date(today.getTime() + 86_400_000)
  if (filter === 'overdue') return { from: null, to: now.toISOString() }
  if (filter === 'today') return { from: now.toISOString(), to: tomorrow.toISOString() }
  // «На неделе» — всё, что не просрочено, в ближайшие 7 дней (включая сегодня).
  return { from: now.toISOString(), to: new Date(today.getTime() + 7 * 86_400_000).toISOString() }
}

/** Секция страницы «Мои задачи» для открытой задачи. */
export function dueBucket(dueAt: string | null, now: Date = new Date(), tzOffsetMin = 0): DueBucket {
  if (!dueAt) return 'none'
  const t = new Date(dueAt).getTime()
  if (Number.isNaN(t)) return 'none'
  if (t < now.getTime()) return 'overdue'
  const today = startOfLocalDay(now, tzOffsetMin).getTime()
  if (t < today + 86_400_000) return 'today'
  if (t < today + 7 * 86_400_000) return 'week'
  return 'later'
}
