/**
 * lib/point-b/model/funnel.ts — the funnel model (spec §9.2). Pure, no IO, no clock.
 *
 *   N_t       = L_t · c_t                          new customers of month t
 *   B_t       = Σ N over the last 12 months        active base (the opening base fades out linearly
 *                                                  over the first 12 months: activeBase0 · (12 − t)/12)
 *   Orders_t  = N_t + B_{t-1} · R_t / 12           new + repeat orders
 *   Revenue_t = Orders_t · p_t · s_t + other       other = the part of revenue the funnel does not explain
 *
 * The 12 seasonal indices are indexed from the FIRST simulated month (index 0 = month 1) and repeat
 * every 12 months; `seasonalityIndex` returns calendar indices (0 = January) — the caller rotates.
 */
import { ModelInputError, type ModelInputs } from './types'

export interface FunnelParams {
  leads: number
  conversion: number
  avgCheck: number
  repeat: number
  activeBase0: number
  /** 12 indices, mean 1. */
  seasonality: number[]
  /** «Other revenue» of the calibration, per month. */
  otherMonthly: number
}

/** By month 1..H. A month beyond the array keeps the base value of the lever. */
export interface FunnelPath { leads: number[]; conversion: number[]; avgCheck: number[]; repeat: number[] }

export interface FunnelSeries { revenue: number[]; orders: number[]; newCustomers: number[]; activeBase: number[] }

export const CALIBRATION_TOLERANCE = 0.15
const MAX_MONTHS = 600

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function validateParams(p: FunnelParams): void {
  if (!finite(p.leads) || p.leads < 0) throw new ModelInputError('Число лидов в месяц не может быть отрицательным')
  if (!finite(p.conversion) || p.conversion < 0 || p.conversion > 1) throw new ModelInputError('Конверсия должна быть от 0 до 100%')
  if (!finite(p.avgCheck) || p.avgCheck <= 0) throw new ModelInputError('Средний чек должен быть больше нуля')
  if (!finite(p.repeat) || p.repeat < 0 || p.repeat > 1) throw new ModelInputError('Доля повторных продаж должна быть от 0 до 100%')
  if (!finite(p.activeBase0) || p.activeBase0 < 0) throw new ModelInputError('Активная база клиентов не может быть отрицательной')
  if (!finite(p.otherMonthly)) throw new ModelInputError('Прочая выручка посчитана неверно')
  if (!Array.isArray(p.seasonality) || p.seasonality.length !== 12 || p.seasonality.some((s) => !finite(s) || s < 0)) {
    throw new ModelInputError('Сезонность задаётся 12 неотрицательными индексами')
  }
}

function pathValue(series: number[] | undefined, t: number, fallback: number, what: string, max = Infinity): number {
  const v = series && t < series.length ? series[t] : fallback
  if (!finite(v) || v < 0 || v > max) throw new ModelInputError(`${what}: недопустимое значение в месяце ${t + 1}`)
  return v
}

export function simulateFunnel(p: FunnelParams, path: FunnelPath, months: number): FunnelSeries {
  validateParams(p)
  if (!Number.isInteger(months) || months < 0 || months > MAX_MONTHS) throw new ModelInputError('Горизонт расчёта должен быть целым числом месяцев от 0 до 600')

  const revenue: number[] = []
  const orders: number[] = []
  const newCustomers: number[] = []
  const activeBase: number[] = []
  let baseBefore = p.activeBase0 // B_{t-1}
  for (let t = 0; t < months; t++) {
    const leads = pathValue(path.leads, t, p.leads, 'Лиды')
    const conversion = pathValue(path.conversion, t, p.conversion, 'Конверсия', 1)
    const check = pathValue(path.avgCheck, t, p.avgCheck, 'Средний чек')
    const repeat = pathValue(path.repeat, t, p.repeat, 'Повторные продажи', 1)

    const fresh = leads * conversion
    newCustomers.push(fresh)
    const o = fresh + (baseBefore * repeat) / 12
    orders.push(o)
    revenue.push(Math.max(0, o * check * p.seasonality[t % 12] + p.otherMonthly))

    // B_t: the new customers of the last 12 months (this one included) plus what is left of the opening base.
    let window = (p.activeBase0 * Math.max(0, 12 - (t + 1))) / 12
    for (let k = Math.max(0, t - 11); k <= t; k++) window += newCustomers[k]
    activeBase.push(window)
    baseBefore = window
  }
  return { revenue, orders, newCustomers, activeBase }
}

/**
 * The 12 months of today's levers compared with the fact. `otherMonthly` absorbs the part of the
 * revenue the funnel does not explain (up to 15% of the fact, either way); beyond that the funnel
 * does not match the fact (`ok: false`, otherMonthly 0) and the caller must not use it.
 */
export function calibrate(base: { revenueYear: number; params: Omit<FunnelParams, 'otherMonthly'> }): { otherMonthly: number; residualShare: number; ok: boolean } {
  if (!finite(base.revenueYear) || base.revenueYear <= 0) throw new ModelInputError('Выручка за год должна быть больше нуля')
  const p: FunnelParams = { ...base.params, otherMonthly: 0 }
  const flat: FunnelPath = { leads: [], conversion: [], avgCheck: [], repeat: [] }
  const model12 = simulateFunnel(p, flat, 12).revenue.reduce((a, b) => a + b, 0)
  const residual = base.revenueYear - model12
  const residualShare = residual / base.revenueYear
  const ok = Math.abs(residualShare) <= CALIBRATION_TOLERANCE + 1e-9
  return { otherMonthly: ok ? residual / 12 : 0, residualShare, ok }
}

const ONES = (): number[] => Array(12).fill(1)

/** Months of a «YYYY-MM» period since year 0, null when it is not one. */
function monthOrdinal(period: string): { ord: number; month: number } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
  return m ? { ord: Number(m[1]) * 12 + Number(m[2]) - 1, month: Number(m[2]) - 1 } : null
}

/** Below this many months of history the seasonality is not estimated (spec §7.4). */
export const SEASONALITY_MIN_MONTHS = 24
const INDEX_MIN = 0.3
const INDEX_MAX = 3

/**
 * Seasonal index by CALENDAR month (0 = January) from the monthly revenue. In logarithms the series is
 * a linear trend plus a seasonal term; the two are fitted alternately (the trend on the series without
 * the season, the season on the series without the trend) until they settle, so a growing business
 * is not mistaken for a seasonal one and a seasonal one does not fake a trend. The result is
 * normalised to a mean of 1. Fewer than 24 months → twelve 1.0 and `defaulted`.
 */
export function seasonalityIndex(history: ModelInputs['history']): { index: number[]; defaulted: boolean } {
  const pts = history
    .map((h) => ({ ...monthOrdinal(h.period), revenue: h.revenue }))
    .filter((h): h is { ord: number; month: number; revenue: number } => h.ord !== undefined && finite(h.revenue) && h.revenue > 0)
  if (pts.length < SEASONALITY_MIN_MONTHS) return { index: ONES(), defaulted: true }

  const n = pts.length
  const y = pts.map((p) => Math.log(p.revenue))
  const mx = pts.reduce((s, p) => s + p.ord, 0) / n
  const sxx = pts.reduce((s, p) => s + (p.ord - mx) ** 2, 0)
  const season = Array(12).fill(0) as number[]
  let slope = 0
  let intercept = 0
  for (let iter = 0; iter < 50; iter++) {
    // trend on the series without the season
    const adj = pts.map((p, k) => y[k] - season[p.month])
    const my = adj.reduce((a, b) => a + b, 0) / n
    slope = sxx > 0 ? pts.reduce((s, p, k) => s + (p.ord - mx) * (adj[k] - my), 0) / sxx : 0
    intercept = my - slope * mx
    // season on the series without the trend, centred
    const sums = Array(12).fill(0) as number[]
    const counts = Array(12).fill(0) as number[]
    pts.forEach((p, k) => {
      sums[p.month] += y[k] - (intercept + slope * p.ord)
      counts[p.month] += 1
    })
    const raw = sums.map((sum, m) => (counts[m] > 0 ? sum / counts[m] : 0))
    const mean = raw.reduce((a, b) => a + b, 0) / 12
    let moved = 0
    raw.forEach((v, m) => {
      moved = Math.max(moved, Math.abs(v - mean - season[m]))
      season[m] = v - mean
    })
    if (moved < 1e-12) break
  }
  const raw = season.map((v) => Math.min(INDEX_MAX, Math.max(INDEX_MIN, Math.exp(v))))
  const mean = raw.reduce((a, b) => a + b, 0) / 12
  return { index: raw.map((v) => v / mean), defaulted: false }
}

/** Calendar indices (0 = January) → indices from the month after `now` (index 0 = the first simulated month). */
export function rotateSeasonality(index: number[], nowIso: string): number[] {
  const d = new Date(nowIso)
  const next = Number.isFinite(d.getTime()) ? (d.getUTCMonth() + 1) % 12 : 0
  return Array.from({ length: 12 }, (_, i) => index[(next + i) % 12])
}
