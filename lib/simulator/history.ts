/**
 * lib/simulator/history.ts — the client's monthly revenue for the simulator's base pace (R-039, I1).
 *
 * The source is the same as the Point B model's: `loadRevenueHistory` (metric_facts of the revenue metric,
 * month periods only, best source per month, a monthly figure kept ×12 by the data layer divided back).
 * The simulator needs CONSECUTIVE months ending near today: the trailing unbroken run is taken; a gap of a
 * month ends it, and a run whose last month is older than STALE_MONTHS before now is no base for a forecast.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadRevenueHistory } from '@/lib/point-b/model/history'

/** The latest month must be at most this many months before the current one. */
export const STALE_MONTHS = 3

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

function monthIndex(period: string): number | null {
  const m = MONTH_RE.exec(period)
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}

/** Pure: {period 'YYYY-MM', revenue}[] (any order) → monthly revenue, oldest → newest, the trailing unbroken run. */
export function trailingMonthlyRevenue(
  history: ReadonlyArray<{ period: string; revenue: number }>,
  now: Date = new Date(),
): number[] {
  const byMonth = new Map<number, number>()
  for (const h of history) {
    const i = monthIndex(h.period)
    if (i === null || !Number.isFinite(h.revenue) || h.revenue <= 0) continue
    byMonth.set(i, h.revenue)
  }
  if (!byMonth.size) return []
  const last = Math.max(...byMonth.keys())
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth()
  if (current - last > STALE_MONTHS) return []
  const out: number[] = []
  for (let i = last; byMonth.has(i); i--) out.unshift(byMonth.get(i) as number)
  return out
}

/** The company's monthly revenue history for runSimulation; any failure → [] (the result then says «нет данных»). */
export async function loadSimulatorHistory(sb: SupabaseClient, companyId: string, now: Date = new Date()): Promise<number[]> {
  try {
    return trailingMonthlyRevenue(await loadRevenueHistory(sb, companyId), now)
  } catch (err) {
    console.error('[simulator] revenue history not read — no forecast', err instanceof Error ? err.message : err)
    return []
  }
}
