// ============================================================
// lib/metrics/forecast.ts
// Lightweight forecast: blends linear regression on the last N
// observations with EMA(α) to capture both trend and recent level.
// Pure function over TimeseriesPoint[]. No DB calls.
//
// Algorithm
// ---------
// 1. Use the last min(12, n) points for the regression window.
// 2. Linear regression value(i) ≈ a + b·i, projected forward.
// 3. EMA(α=0.3) on the same window, then propagated forward as a
//    flat continuation (EMA naturally damps swings).
// 4. Output = blend·LR + (1-blend)·EMA  (blend default 0.6).
// 5. Confidence band = ±1.96·s·√(h + 1/n + (x−x̄)²/Sxx): s is the residual
//    std of the regression, the band widens with the horizon h (R-040).
// 0. (R-040, BI-43) Only BUSINESS PERIODS are forecast: points marked
//    `basis: 'event'` (input edits / source changes, lib/metrics/timeseries-fetch)
//    are dropped, one point per period (the latest), one grain (month /
//    quarter / year); fewer than FORECAST_MIN_POINTS periods → no forecast.
//    A metric that was never negative is not forecast below 0; `upperBound`
//    caps a bounded metric (a percentage ≤ 100).
// 6. Cadence (daily / weekly / monthly / quarterly) is inferred from
//    the gap between the last two observed timestamps; forecast
//    timestamps step by that delta and labels follow the same shape
//    as the input labels.
// ============================================================

import type { TimeseriesPoint, ForecastPoint } from '@/types/metrics'

export interface ForecastOptions {
  /** Number of forward steps to produce (default 4, max 12). */
  horizon?: number
  /** EMA smoothing factor (default 0.3, must be in (0, 1]). */
  alpha?: number
  /** Weight of LR in the LR+EMA blend (default 0.6). */
  blend?: number
  /** Never forecast below 0. Default: true when no observed value is negative. */
  nonNegative?: boolean
  /** Cap of a bounded metric (e.g. 100 for a percentage). Default: none. */
  upperBound?: number | null
}

const DEFAULTS = {
  horizon: 4,
  alpha: 0.3,
  blend: 0.6,
}

/** Fewer business periods than this → no forecast («мало данных»). R-040, BI-43. */
export const FORECAST_MIN_POINTS = 6

/**
 * A series point as lib/metrics/timeseries-fetch builds it: `basis: 'period'` — the value of a business period
 * (`period` = '2025' | '2025-Q1' | '2025-03'); `basis: 'event'` — an input edit / source change at a moment,
 * NOT a business period. A point without `basis` (a caller's own series) counts as a business period.
 */
export interface SeriesPoint extends TimeseriesPoint {
  basis?: 'period' | 'event'
  period?: string
}

export type ForecastStatus = 'ok' | 'insufficient_data' | 'not_business_periods'

export interface ForecastOutcome {
  points: ForecastPoint[]
  status: ForecastStatus
  /** Why there is no forecast (for the UI), null when there is one. */
  reason: string | null
  /** Business periods the forecast is built on. */
  n: number
  /** 0..1 from the fit (1 − residual std / mean level); null without a forecast. */
  confidence: number | null
}

const MS_DAY = 24 * 60 * 60 * 1000
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

type Cadence = 'daily' | 'weekly' | 'monthly' | 'quarterly'

function inferCadence(a: string, b: string): { cadence: Cadence; deltaMs: number } {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  const diff = Math.abs(tb - ta)
  const days = diff / MS_DAY
  if (days <= 2) return { cadence: 'daily', deltaMs: diff || MS_DAY }
  if (days <= 10) return { cadence: 'weekly', deltaMs: diff || 7 * MS_DAY }
  if (days <= 45) return { cadence: 'monthly', deltaMs: diff || 30 * MS_DAY }
  return { cadence: 'quarterly', deltaMs: diff || 91 * MS_DAY }
}

function buildLabel(date: Date, cadence: Cadence): string {
  const m = MONTHS_RU[date.getMonth()]
  const d = date.getDate()
  const y = String(date.getFullYear()).slice(2)
  if (cadence === 'daily' || cadence === 'weekly') return `${d < 10 ? '0' + d : d} ${m}`
  if (cadence === 'monthly') return `${m} '${y}`
  const q = Math.floor(date.getMonth() / 3) + 1
  return `Q${q} '${y}`
}

function stepDate(from: Date, cadence: Cadence, deltaMs: number, n: number): Date {
  if (cadence === 'monthly') {
    const d = new Date(from)
    d.setMonth(d.getMonth() + n)
    return d
  }
  if (cadence === 'quarterly') {
    const d = new Date(from)
    d.setMonth(d.getMonth() + n * 3)
    return d
  }
  return new Date(from.getTime() + deltaMs * n)
}

function linreg(values: number[]): { a: number; b: number; residStd: number } {
  const n = values.length
  if (n < 2) return { a: values[0] ?? 0, b: 0, residStd: 0 }
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += values[i]
    sxx += i * i
    sxy += i * values[i]
  }
  const denom = n * sxx - sx * sx
  const b = denom === 0 ? 0 : (n * sxy - sx * sy) / denom
  const a = (sy - b * sx) / n
  let acc = 0
  for (let i = 0; i < n; i++) {
    const pred = a + b * i
    const r = values[i] - pred
    acc += r * r
  }
  const residStd = n > 2 ? Math.sqrt(acc / (n - 2)) : Math.sqrt(acc / n)
  return { a, b, residStd }
}

function ema(values: number[], alpha: number): number {
  if (values.length === 0) return 0
  let cur = values[0]
  for (let i = 1; i < values.length; i++) {
    cur = alpha * values[i] + (1 - alpha) * cur
  }
  return cur
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function grainOf(period: string | undefined): 'year' | 'quarter' | 'month' | null {
  if (!period) return null
  if (/^\d{4}$/.test(period)) return 'year'
  if (/^\d{4}-Q[1-4]$/i.test(period)) return 'quarter'
  if (/^\d{4}-\d{2}$/.test(period)) return 'month'
  return null
}

/** Business periods only, one point per period (the latest), one grain, sorted by time. */
export function businessPeriods(series: ReadonlyArray<SeriesPoint>): SeriesPoint[] {
  const periodic = series.filter((p) => p.basis !== 'event' && Number.isFinite(p.value) && !Number.isNaN(Date.parse(p.timestamp)))
  // one grain: the one with the most points (ties → the finer one)
  const counts = { month: 0, quarter: 0, year: 0 }
  for (const p of periodic) {
    const g = grainOf(p.period)
    if (g) counts[g]++
  }
  const grain = counts.month + counts.quarter + counts.year === 0 ? null
    : (['month', 'quarter', 'year'] as const).reduce((best, g) => (counts[g] > counts[best] ? g : best), 'month' as 'month' | 'quarter' | 'year')
  const sameGrain = grain === null ? periodic : periodic.filter((p) => grainOf(p.period) === grain)
  const byKey = new Map<string, SeriesPoint>()
  for (const p of sameGrain) byKey.set(p.period ?? p.timestamp, p) // a later duplicate (the latest version) wins
  return [...byKey.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/** The forecast with its status: why there is none, how many periods it rests on, a computed confidence. */
export function forecastSeries(
  series: ReadonlyArray<SeriesPoint>,
  opts?: ForecastOptions,
): ForecastOutcome {
  const none = (status: ForecastStatus, reason: string, n: number): ForecastOutcome => ({ points: [], status, reason, n, confidence: null })
  const input = series ?? []
  if (input.length > 0 && input.every((p) => p.basis === 'event')) {
    return none('not_business_periods', 'Прогноз строится только по бизнес-периодам (месяц, квартал, год). Сейчас есть лишь история правок значения — это не динамика бизнеса.', 0)
  }
  const periods = businessPeriods(input)
  if (periods.length < FORECAST_MIN_POINTS) {
    return none('insufficient_data', `Мало данных для прогноза: нужно не меньше ${FORECAST_MIN_POINTS} периодов, сейчас ${periods.length}.`, periods.length)
  }
  const { points, confidence } = project(periods, opts)
  return { points, status: 'ok', reason: null, n: periods.length, confidence }
}

/** Forecast points only (see forecastSeries for the status and the reason). */
export function forecast(
  series: SeriesPoint[],
  opts?: ForecastOptions,
): ForecastPoint[] {
  return forecastSeries(series, opts).points
}

function project(series: SeriesPoint[], opts?: ForecastOptions): { points: ForecastPoint[]; confidence: number } {
  const cfg = { ...DEFAULTS, ...(opts ?? {}) }
  const horizon = Math.max(1, Math.min(12, cfg.horizon))

  const windowSize = Math.min(12, series.length)
  const window = series.slice(series.length - windowSize)
  const values = window.map((p) => p.value)
  const { a, b, residStd } = linreg(values)
  const emaLast = ema(values, cfg.alpha)

  const last = series[series.length - 1]
  const prev = series[series.length - 2]
  const { cadence, deltaMs } = inferCadence(prev.timestamp, last.timestamp)
  const lastDate = new Date(last.timestamp)
  const n = values.length
  const xMean = (n - 1) / 2
  let sxx = 0
  for (let i = 0; i < n; i++) sxx += (i - xMean) ** 2
  const nonNegative = opts?.nonNegative ?? series.every((p) => p.value >= 0)
  const upper = typeof opts?.upperBound === 'number' && Number.isFinite(opts.upperBound) ? opts.upperBound : null
  const clamp = (v: number): number => {
    let out = v
    if (nonNegative) out = Math.max(0, out)
    if (upper !== null) out = Math.min(upper, out)
    return out
  }
  const meanAbs = values.reduce((acc, v) => acc + Math.abs(v), 0) / n
  const confidence = meanAbs > 0 ? round2(Math.max(0, Math.min(1, 1 - residStd / meanAbs))) : 0

  const points: ForecastPoint[] = []
  for (let h = 1; h <= horizon; h++) {
    // LR projection at index (windowSize - 1 + h) in the regression frame.
    const idx = windowSize - 1 + h
    const lrVal = a + b * idx
    // EMA continuation is "last EMA level + trend slope × h" — i.e. the
    // smoothed level carried forward along the regression slope.
    const emaVal = emaLast + b * h
    const blended = cfg.blend * lrVal + (1 - cfg.blend) * emaVal

    // The band widens with the horizon (√h) and with the distance from the fitted window.
    const band = 1.96 * residStd * Math.sqrt(h + 1 / n + (sxx > 0 ? (idx - xMean) ** 2 / sxx : 0))
    const value = clamp(blended)

    const date = stepDate(lastDate, cadence, deltaMs, h)
    points.push({
      timestamp: date.toISOString(),
      value: round2(value),
      label: buildLabel(date, cadence),
      isForecast: true,
      confidenceLow: round2(Math.min(value, clamp(blended - band))),
      confidenceHigh: round2(Math.max(value, clamp(blended + band))),
    })
  }
  return { points, confidence }
}
