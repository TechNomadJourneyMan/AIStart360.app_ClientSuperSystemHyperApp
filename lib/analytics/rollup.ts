/**
 * lib/analytics/rollup.ts — daily activity rollup (F-066), TS side.
 *
 * SQL (migration 090) does the work: rollup_daily_activity(day) rebuilds one
 * Almaty day of `daily_activity` idempotently from user_events (staff and
 * admin/impersonation/backfill events excluded) and marks it in
 * `daily_activity_runs`; analytics_missing_days(n) lists days never rolled up.
 *
 * This wrapper decides WHICH days to roll up on a cron run, in a bounded loop:
 *   1. always yesterday and the day before (late events, retries);
 *   2. then days of the last BACKFILL_DAYS never rolled up, newest first;
 * capped by `maxDays` and a time budget so one run never exceeds the function
 * timeout — the next run continues the backfill.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const ANALYTICS_TZ = 'Asia/Almaty'
export const BACKFILL_DAYS = 90
export const MAX_DAYS_PER_RUN = 90

/** YYYY-MM-DD of `date` in Asia/Almaty. */
export function almatyDay(date: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: ANALYTICS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** `day` (YYYY-MM-DD) shifted by `delta` days. */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Pure planner: yesterday + day before first, then missing days (newest first),
 * de-duplicated, never today or the future, at most `maxDays`.
 */
export function planRollupDays(now: Date, missing: string[], maxDays = MAX_DAYS_PER_RUN): string[] {
  const today = almatyDay(now)
  const oldest = shiftDay(today, -BACKFILL_DAYS)
  const out: string[] = []
  const seen = new Set<string>()
  const push = (d: string) => {
    if (!DAY_RE.test(d) || d >= today || d < oldest || seen.has(d) || out.length >= maxDays) return
    seen.add(d)
    out.push(d)
  }
  push(shiftDay(today, -1))
  push(shiftDay(today, -2))
  for (const d of [...missing].sort().reverse()) push(d)
  return out
}

export interface RollupResult {
  ok: boolean
  planned: number
  rolled: Array<{ day: string; users: number }>
  failed: Array<{ day: string; error: string }>
  stoppedEarly: boolean
}

/**
 * Run the rollup with a service-role client. Never throws; per-day errors are
 * collected. `budgetMs` stops the loop before the serverless timeout.
 */
export async function runDailyRollup(
  sb: Pick<SupabaseClient, 'rpc'>,
  opts: { now?: Date; maxDays?: number; budgetMs?: number } = {},
): Promise<RollupResult> {
  const now = opts.now ?? new Date()
  const started = Date.now()
  const budget = opts.budgetMs ?? 45_000

  let missing: string[] = []
  try {
    const { data, error } = await sb.rpc('analytics_missing_days', { p_days: BACKFILL_DAYS })
    if (error) throw new Error(error.message)
    missing = ((data ?? []) as Array<{ day?: string } | string>)
      .map((r) => (typeof r === 'string' ? r : String(r?.day ?? '')))
      .map((d) => d.slice(0, 10))
  } catch (e) {
    // Planner still covers yesterday; backfill resumes next run.
    console.error('[analytics/rollup] missing-days lookup failed:', e instanceof Error ? e.message : e)
  }

  const days = planRollupDays(now, missing, opts.maxDays ?? MAX_DAYS_PER_RUN)
  const result: RollupResult = { ok: true, planned: days.length, rolled: [], failed: [], stoppedEarly: false }
  for (const day of days) {
    if (Date.now() - started > budget) { result.stoppedEarly = true; break }
    try {
      const { data, error } = await sb.rpc('rollup_daily_activity', { p_day: day })
      if (error) throw new Error(error.message)
      result.rolled.push({ day, users: Number(data ?? 0) })
    } catch (e) {
      result.failed.push({ day, error: e instanceof Error ? e.message : String(e) })
    }
  }
  result.ok = result.failed.length === 0
  return result
}
