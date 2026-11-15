/**
 * lib/point-b/finmodel/revenue-history.ts — «Выручка по месяцам» of the «Финмодель» tab (R3, M2): the owner types the
 * revenue of the last 12–24 finished months BEFORE the plan, so the overview can forecast «при текущем ходе» and give a
 * verdict (lib/point-b/model/forecast.ts needs 12 months in a row, the last not older than 4 months).
 *
 * Storage: pb_monthly_facts (migration 132), metric 'revenue', source 'revenue_history' (migration 151) — the SAME table
 * as «Факт за месяц» of the reconciliation, so the overview, the recompute and the plan-fact read ONE history
 * (lib/point-b/model/history.ts). Not metric_overrides (a month would become the ANNUAL revenue of Point A) and not
 * metric_facts (a derived table the data layer rewrites).
 *
 *   revenueHistoryPeriods   the months of the table: the last 24 FINISHED months, oldest first
 *   validateRevenueHistory  { months: [{ period, revenue }] }: only those months, a number ≥ 0 (₸ per month) or null
 *                           (= clear), no repeats, at least one
 *   saveRevenueHistory      upsert by (company, month, 'revenue'); null deletes the month's revenue (any source)
 *   loadRevenueTable        the table: every month with its value and where it came from, plus the run of months in a
 *                           row the forecast counts
 * Service-role client; the routes authorise the user / company first. Pure parts have no IO.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { HISTORY_MAX_LAG_MONTHS, HISTORY_MIN_MONTHS } from '../model/forecast'
import { loadRevenueHistory } from '../model/history'

export const REVENUE_HISTORY_SOURCE = 'revenue_history'
export const REVENUE_HISTORY_MONTHS = 24
export const REVENUE_MAX = 1e13

export type RevenueHistoryErrorCode = 'invalid' | 'not_ready'

export class RevenueHistoryError extends Error {
  constructor(public readonly code: RevenueHistoryErrorCode, message: string, public readonly field?: string) {
    super(message)
    this.name = 'RevenueHistoryError'
  }
}

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

const ordinal = (period: string): number | null => {
  const m = PERIOD_RE.exec(period)
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}
const fromOrdinal = (o: number): string => `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, '0')}`

/** The last `months` finished months (the current one is not over), oldest first. */
export function revenueHistoryPeriods(now: Date, months = REVENUE_HISTORY_MONTHS): string[] {
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth()
  const out: string[] = []
  for (let i = months; i >= 1; i--) out.push(fromOrdinal(current - i))
  return out
}

export interface RevenueMonthInput { period: string; revenue: number | null }

/** «1 250 000», «1250000,5», 1250000 → a number; '' / null → null; anything else → NaN. */
function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') {
    const t = raw.replace(/[\s  ]/g, '').replace(',', '.')
    return t === '' ? null : Number(t)
  }
  return NaN
}

export function validateRevenueHistory(body: unknown, now: Date): RevenueMonthInput[] {
  const months = body && typeof body === 'object' && !Array.isArray(body) ? (body as { months?: unknown }).months : undefined
  if (!Array.isArray(months) || months.length === 0) throw new RevenueHistoryError('invalid', 'Внесите выручку хотя бы за один месяц', 'months')
  if (months.length > REVENUE_HISTORY_MONTHS) throw new RevenueHistoryError('invalid', `Не больше ${REVENUE_HISTORY_MONTHS} месяцев за раз`, 'months')
  const allowed = new Set(revenueHistoryPeriods(now))
  const seen = new Set<string>()
  const out: RevenueMonthInput[] = []
  for (const [i, m] of months.entries()) {
    const row = m && typeof m === 'object' ? (m as { period?: unknown; revenue?: unknown }) : {}
    const period = typeof row.period === 'string' ? row.period.trim() : ''
    if (!PERIOD_RE.test(period)) throw new RevenueHistoryError('invalid', 'Месяц — в формате ГГГГ-ММ', `months[${i}].period`)
    if (!allowed.has(period)) {
      throw new RevenueHistoryError('invalid', `Выручку можно внести за последние ${REVENUE_HISTORY_MONTHS} завершённых месяца — текущий месяц ещё не закончился`, `months[${i}].period`)
    }
    if (seen.has(period)) throw new RevenueHistoryError('invalid', 'Месяц повторяется', `months[${i}].period`)
    seen.add(period)
    const value = parseAmount(row.revenue)
    if (value !== null && (!finite(value) || value < 0 || value > REVENUE_MAX)) {
      throw new RevenueHistoryError('invalid', 'Выручка за месяц — число в тенге, не меньше нуля', `months[${i}].revenue`)
    }
    out.push({ period, revenue: value })
  }
  return out
}

const dbError = (op: string, error: { code?: string } | null | undefined): Error => {
  const code = error?.code ?? 'unknown'
  if (code === '42P01' || code === 'PGRST205' || code === '23514') {
    // The table (132) or the source (151) is not there yet.
    return new RevenueHistoryError('not_ready', `point-b revenue history: ${op} failed (${code})`)
  }
  return new Error(`point-b revenue history: ${op} failed (${code})`)
}

export async function saveRevenueHistory(
  sb: SupabaseClient,
  input: { companyId: string; enteredBy: string | null; role: 'owner' | 'expert'; months: RevenueMonthInput[] },
): Promise<{ saved: string[]; cleared: string[] }> {
  const saved = input.months.filter((m) => m.revenue !== null)
  const cleared = input.months.filter((m) => m.revenue === null).map((m) => m.period)
  if (saved.length) {
    const rows = saved.map((m) => ({
      company_id: input.companyId, period: m.period, metric: 'revenue', value: m.revenue, source: REVENUE_HISTORY_SOURCE,
      entered_by: input.enteredBy, entered_role: input.role, note: null,
    }))
    const { error } = await sb.from('pb_monthly_facts').upsert(rows, { onConflict: 'company_id,period,metric' })
    if (error) throw dbError('save', error)
  }
  if (cleared.length) {
    const { error } = await sb.from('pb_monthly_facts').delete().eq('company_id', input.companyId).eq('metric', 'revenue').in('period', cleared)
    if (error) throw dbError('clear', error)
  }
  return { saved: saved.map((m) => m.period), cleared }
}

export type RevenueMonthSource = 'owner' | 'reconciliation' | 'data'

export interface RevenueTableRow { period: string; revenue: number | null; source: RevenueMonthSource | null }

export interface RevenueTable {
  months: RevenueTableRow[]
  /** Months in a row ending at the newest month with revenue (what the forecast counts). */
  run: number
  /** How many more months in a row the forecast needs (0 = enough). */
  needed: number
  /** The newest month with revenue is too old for the forecast (more than HISTORY_MAX_LAG_MONTHS ago). */
  stale: boolean
  minMonths: number
}

/** Pure: the table from the stored rows and the data-layer months (the owner's / reconciliation's month wins). */
export function revenueTableFrom(
  now: Date,
  stored: Array<{ period: string; value: number | string; source: string }>,
  data: Array<{ period: string; revenue: number }>,
): RevenueTable {
  const periods = revenueHistoryPeriods(now)
  const own = new Map<string, { value: number; source: RevenueMonthSource }>()
  for (const r of stored) {
    const v = Number(r.value)
    if (!finite(v)) continue
    own.set(r.period, { value: v, source: r.source === REVENUE_HISTORY_SOURCE ? 'owner' : 'reconciliation' })
  }
  const fromData = new Map(data.map((d) => [d.period, d.revenue]))
  const months: RevenueTableRow[] = periods.map((period) => {
    const o = own.get(period)
    if (o) return { period, revenue: o.value, source: o.source }
    const d = fromData.get(period)
    return finite(d) ? { period, revenue: d, source: 'data' as const } : { period, revenue: null, source: null }
  })
  // The run the forecast counts: months with revenue > 0 in a row, ending at the newest such month.
  const withRevenue = months.filter((m) => finite(m.revenue) && (m.revenue as number) > 0)
  let run = 0
  let lagMonths: number | null = null
  if (withRevenue.length) {
    const last = withRevenue[withRevenue.length - 1].period
    const current = now.getUTCFullYear() * 12 + now.getUTCMonth()
    lagMonths = current - ordinal(last)!
    const has = new Set(withRevenue.map((m) => m.period))
    for (let o = ordinal(last)!; has.has(fromOrdinal(o)); o--) run += 1
  }
  return {
    months,
    run,
    needed: Math.max(0, HISTORY_MIN_MONTHS - run),
    stale: lagMonths !== null && lagMonths > HISTORY_MAX_LAG_MONTHS,
    minMonths: HISTORY_MIN_MONTHS,
  }
}

export async function loadRevenueTable(sb: SupabaseClient, companyId: string, now: Date): Promise<RevenueTable> {
  const periods = revenueHistoryPeriods(now)
  const [stored, data] = await Promise.all([
    sb.from('pb_monthly_facts').select('period, value, source').eq('company_id', companyId).eq('metric', 'revenue')
      .in('period', periods).limit(400)
      .then(({ data: rows, error }) => {
        if (error) throw dbError('read', error)
        return (rows ?? []) as Array<{ period: string; value: number | string; source: string }>
      }),
    // The data layer's months only (documents, integrations): the stored months are merged above.
    loadRevenueHistory(sb, companyId, { monthly: false }),
  ])
  return revenueTableFrom(now, stored, data)
}
