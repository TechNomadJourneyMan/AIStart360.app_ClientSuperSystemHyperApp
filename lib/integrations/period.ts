/**
 * Day arithmetic and the sync window planner shared by the adapters.
 *
 * Days are YYYY-MM-DD strings in the provider's documented time zone (offset
 * in minutes: Moscow +180 for МойСклад / Wildberries, Almaty +300 for Kaspi,
 * UTC for the rest). Only COMPLETE days are synced (up to yesterday): a fact
 * of a day is final once written, then refreshed a few more times because
 * marketplaces revise recent days (cancellations, returns, late payments).
 */

export const MSK_OFFSET_MIN = 180
export const ALMATY_OFFSET_MIN = 300

/** How far back a new connection is filled. */
export const BACKFILL_DAYS = 35
/** Recent days re-fetched once the history is filled. */
export const REFRESH_DAYS = 3

const DAY_MS = 86_400_000

export function dayOf(date: Date, offsetMin = 0): string {
  return new Date(date.getTime() + offsetMin * 60_000).toISOString().slice(0, 10)
}

export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * DAY_MS
  return new Date(t).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d)
  return out
}

/** Start of `day` in the provider's zone as epoch ms. */
export function dayStartMs(day: string, offsetMin = 0): number {
  return Date.parse(`${day}T00:00:00Z`) - offsetMin * 60_000
}

/** Day (in the provider's zone) of an epoch-ms timestamp. */
export function dayOfMs(ms: number, offsetMin = 0): string {
  return dayOf(new Date(ms), offsetMin)
}

export interface DayCursor {
  /** Last day whose facts are written (inclusive). */
  filled_to?: string
}

export interface DayWindow {
  from: string
  to: string
  days: string[]
  /** true when the history was already filled and this run only refreshes recent days. */
  refresh: boolean
}

/**
 * Days to fetch in this run: first the history (BACKFILL_DAYS up to
 * yesterday) in chronological chunks of at most `maxDays`, then — once filled
 * — the last REFRESH_DAYS days again. Null when there is nothing to fetch.
 */
export function planDays(cursor: DayCursor, now: Date, offsetMin: number, maxDays: number): DayWindow | null {
  const yesterday = addDays(dayOf(now, offsetMin), -1)
  const historyStart = addDays(yesterday, -(BACKFILL_DAYS - 1))
  const filled = typeof cursor.filled_to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cursor.filled_to) ? cursor.filled_to : null
  let from: string
  let refresh = false
  if (!filled || filled < addDays(historyStart, -1)) from = historyStart
  else if (filled < yesterday) from = addDays(filled, 1)
  else {
    from = addDays(yesterday, -(REFRESH_DAYS - 1))
    refresh = true
  }
  const cap = Math.max(1, Math.floor(maxDays))
  let to = addDays(from, cap - 1)
  if (to > yesterday) to = yesterday
  if (from > to) return null
  return { from, to, days: daysBetween(from, to), refresh }
}

/**
 * Days per run: the adapter's maximum, or less after the sync engine halved
 * the window because a run spent its request budget (cursor.window_days).
 */
export function maxDaysFor(cursor: Record<string, unknown>, max: number): number {
  const n = Number(cursor.window_days)
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : max
}

/** Cursor after a window was written completely. */
export function advanceCursor<C extends DayCursor>(cursor: C, window: DayWindow): C {
  const prev = cursor.filled_to ?? ''
  return { ...cursor, filled_to: window.to > prev ? window.to : prev }
}
