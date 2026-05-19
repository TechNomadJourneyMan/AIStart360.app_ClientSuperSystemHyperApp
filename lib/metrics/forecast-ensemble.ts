/**
 * Ensemble forecast engine.
 *
 * Combines four pure-function forecasters (linear regression, EMA, Holt linear,
 * AR(1)) and weights each by its recent residual error on a held-out tail of
 * the series. A "naive" random-walk forecast is always evaluated internally as
 * a comparison floor but only enters the ensemble if requested explicitly.
 *
 * This module is intentionally separate from `lib/metrics/forecast.ts` (the
 * basic LR+EMA blend) so callers can opt-in.
 */
import type { ForecastPoint, TimeseriesPoint } from '@/types/metrics'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ForecastMethod = 'linreg' | 'ema' | 'holt' | 'ar1' | 'naive'

export interface EnsembleOptions {
  /** Number of future points to produce. Default 4. */
  horizon?: number
  /** Holdout last K points to evaluate each method's recent error. Default 4. */
  evalWindow?: number
  /** Methods to include. Default ['linreg','ema','holt','ar1']. */
  methods?: ForecastMethod[]
  /** Confidence band z-score multiplier. Default 1.96. */
  z?: number
}

export interface MethodScore {
  method: ForecastMethod
  /** 0..1; sums to 1 across all methods (with one exception below). */
  weight: number
  /** Mean absolute percentage error on the holdout. */
  mape: number
  /** Root-mean-square error on the holdout. */
  rmse: number
}

export interface EnsembleForecast {
  points: ForecastPoint[]
  /** Sorted by weight desc. */
  methodScores: MethodScore[]
  /** Russian short summary of the ensemble outcome. */
  notes: string
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_METHODS: ForecastMethod[] = ['linreg', 'ema', 'holt', 'ar1']
const DEFAULT_HORIZON = 4
const DEFAULT_EVAL_WINDOW = 4
const DEFAULT_Z = 1.96
const MAPE_REJECT_THRESHOLD = 0.5

const MS_DAY = 86_400_000
const DEFAULT_STEP_MS = 30 * MS_DAY

const METHOD_LABEL_RU: Record<ForecastMethod, string> = {
  linreg: 'LinReg',
  ema: 'EMA',
  holt: 'Holt',
  ar1: 'AR(1)',
  naive: 'Naive',
}

// ---------------------------------------------------------------------------
// Numerical helpers
// ---------------------------------------------------------------------------

function isFiniteNumber(x: number): boolean {
  return Number.isFinite(x)
}

function safeNum(x: number, fallback = 0): number {
  return isFiniteNumber(x) ? x : fallback
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  let s = 0
  for (const v of values) s += v
  return s / values.length
}

function variance(values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  const m = mean(values)
  let s = 0
  for (const v of values) {
    const d = v - m
    s += d * d
  }
  return s / n
}

function clampPad(arr: number[], horizon: number, fill: number): number[] {
  const out = arr.slice(0, horizon)
  while (out.length < horizon) out.push(fill)
  return out.map((v) => safeNum(v, fill))
}

// ---------------------------------------------------------------------------
// Cadence / timestamp inference
// ---------------------------------------------------------------------------

function detectStepMs(series: TimeseriesPoint[]): number {
  if (series.length < 2) return DEFAULT_STEP_MS
  const a = Date.parse(series[series.length - 2].timestamp)
  const b = Date.parse(series[series.length - 1].timestamp)
  if (!isFiniteNumber(a) || !isFiniteNumber(b) || b <= a) return DEFAULT_STEP_MS
  return b - a
}

function snapCadence(stepMs: number): 'monthly' | 'quarterly' | 'weekly' | 'daily' | 'custom' {
  const days = stepMs / MS_DAY
  if (days >= 80 && days <= 100) return 'quarterly'
  if (days >= 25 && days <= 35) return 'monthly'
  if (days >= 6 && days <= 8) return 'weekly'
  if (days >= 0.9 && days <= 1.1) return 'daily'
  return 'custom'
}

function formatLabel(date: Date, cadence: ReturnType<typeof snapCadence>): string {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const d = date.getUTCDate()
  const monthRu = [
    'янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
  ][m]
  switch (cadence) {
    case 'quarterly': {
      const q = Math.floor(m / 3) + 1
      return `Q${q} ${y}`
    }
    case 'monthly':
      return `${monthRu} ${y}`
    case 'weekly':
    case 'daily':
      return `${String(d).padStart(2, '0')} ${monthRu}`
    default:
      return `${monthRu} ${y}`
  }
}

function buildFutureTimestamps(
  series: TimeseriesPoint[],
  horizon: number
): { timestamp: string; label: string }[] {
  const stepMs = detectStepMs(series)
  const cadence = snapCadence(stepMs)
  const last = series.length > 0 ? Date.parse(series[series.length - 1].timestamp) : Date.now()
  const base = isFiniteNumber(last) ? last : Date.now()
  const out: { timestamp: string; label: string }[] = []
  for (let h = 1; h <= horizon; h++) {
    const t = base + h * stepMs
    const d = new Date(t)
    out.push({ timestamp: d.toISOString(), label: formatLabel(d, cadence) })
  }
  return out
}

// ---------------------------------------------------------------------------
// The four forecasters (+ naive)
//
// Each returns exactly `horizon` numeric values. They never throw and always
// return finite numbers (fall back to last observed value or zero).
// ---------------------------------------------------------------------------

export function linregForecast(series: TimeseriesPoint[], horizon: number): number[] {
  const values = series.map((p) => safeNum(p.value, 0))
  const n = values.length
  if (n === 0) return new Array(horizon).fill(0)
  if (n === 1) return new Array(horizon).fill(values[0])

  const window = Math.min(12, n)
  const start = n - window
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < window; i++) {
    xs.push(i)
    ys.push(values[start + i])
  }

  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let den = 0
  for (let i = 0; i < window; i++) {
    const dx = xs[i] - mx
    num += dx * (ys[i] - my)
    den += dx * dx
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = my - slope * mx

  const out: number[] = []
  for (let h = 1; h <= horizon; h++) {
    const xNext = window - 1 + h
    out.push(safeNum(intercept + slope * xNext, values[n - 1]))
  }
  return out
}

export function emaForecast(
  series: TimeseriesPoint[],
  horizon: number,
  alpha = 0.3
): number[] {
  const values = series.map((p) => safeNum(p.value, 0))
  const n = values.length
  if (n === 0) return new Array(horizon).fill(0)
  let level = values[0]
  for (let i = 1; i < n; i++) level = alpha * values[i] + (1 - alpha) * level
  const flat = safeNum(level, values[n - 1])
  return new Array(horizon).fill(flat)
}

export function holtForecast(
  series: TimeseriesPoint[],
  horizon: number,
  alpha = 0.4,
  beta = 0.2
): number[] {
  const values = series.map((p) => safeNum(p.value, 0))
  const n = values.length
  if (n === 0) return new Array(horizon).fill(0)
  if (n === 1) return new Array(horizon).fill(values[0])

  let level = values[0]
  let trend = values[1] - values[0]
  for (let i = 1; i < n; i++) {
    const prevLevel = level
    level = alpha * values[i] + (1 - alpha) * (prevLevel + trend)
    trend = beta * (level - prevLevel) + (1 - beta) * trend
  }
  const out: number[] = []
  for (let h = 1; h <= horizon; h++) {
    out.push(safeNum(level + h * trend, values[n - 1]))
  }
  return out
}

export function ar1Forecast(series: TimeseriesPoint[], horizon: number): number[] {
  const values = series.map((p) => safeNum(p.value, 0))
  const n = values.length
  if (n === 0) return new Array(horizon).fill(0)
  if (n < 3) return new Array(horizon).fill(values[n - 1])

  // Least-squares on consecutive pairs (y_{t-1}, y_t).
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 1; i < n; i++) {
    xs.push(values[i - 1])
    ys.push(values[i])
  }
  const mx = mean(xs)
  const my = mean(ys)
  let cov = 0
  let varX = 0
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx
    cov += dx * (ys[i] - my)
    varX += dx * dx
  }
  let phi = varX === 0 ? 0 : cov / varX
  // Bound phi away from unit-root explosions but allow strong persistence.
  if (!isFiniteNumber(phi)) phi = 0
  if (phi > 1.05) phi = 1.05
  if (phi < -1.05) phi = -1.05
  const c = my - phi * mx

  const out: number[] = []
  let prev = values[n - 1]
  for (let h = 1; h <= horizon; h++) {
    const next = c + phi * prev
    out.push(safeNum(next, values[n - 1]))
    prev = next
  }
  return out
}

export function naiveForecast(series: TimeseriesPoint[], horizon: number): number[] {
  const n = series.length
  if (n === 0) return new Array(horizon).fill(0)
  return new Array(horizon).fill(safeNum(series[n - 1].value, 0))
}

const FORECASTERS: Record<ForecastMethod, (s: TimeseriesPoint[], h: number) => number[]> = {
  linreg: linregForecast,
  ema: emaForecast,
  holt: holtForecast,
  ar1: ar1Forecast,
  naive: naiveForecast,
}

// ---------------------------------------------------------------------------
// Error metrics
// ---------------------------------------------------------------------------

function computeMape(actual: number[], pred: number[]): number {
  if (actual.length === 0) return 0
  let s = 0
  for (let i = 0; i < actual.length; i++) {
    const denom = Math.max(Math.abs(actual[i]), 1)
    s += Math.abs(actual[i] - pred[i]) / denom
  }
  return safeNum(s / actual.length, 1)
}

function computeRmse(actual: number[], pred: number[]): number {
  if (actual.length === 0) return 0
  let s = 0
  for (let i = 0; i < actual.length; i++) {
    const d = actual[i] - pred[i]
    s += d * d
  }
  return safeNum(Math.sqrt(s / actual.length), 0)
}

// ---------------------------------------------------------------------------
// Fallback path — single LinReg with a loose confidence band
// ---------------------------------------------------------------------------

function fallbackForecast(
  series: TimeseriesPoint[],
  opts: Required<Pick<EnsembleOptions, 'horizon' | 'z'>>,
  reason: string
): EnsembleForecast {
  const { horizon, z } = opts
  const stamps = buildFutureTimestamps(series, horizon)
  const preds = clampPad(linregForecast(series, horizon), horizon, 0)

  // Loose band derived from in-sample variance, or zero if we have nothing.
  const values = series.map((p) => safeNum(p.value, 0))
  const sigma = values.length >= 2 ? Math.sqrt(variance(values)) : 0
  const band = z * sigma

  const points: ForecastPoint[] = preds.map((v, i) => ({
    timestamp: stamps[i].timestamp,
    label: stamps[i].label,
    value: v,
    isForecast: true,
    confidenceLow: v - band,
    confidenceHigh: v + band,
  }))

  const methodScores: MethodScore[] = [
    { method: 'linreg', weight: 1, mape: 0, rmse: 0 },
  ]

  return {
    points,
    methodScores,
    notes: `Ансамбль: недостаточно данных (insufficient data), fallback на LinReg. Причина: ${reason}.`,
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function ensembleForecast(
  series: TimeseriesPoint[],
  opts?: EnsembleOptions
): EnsembleForecast {
  const horizon = Math.max(1, Math.floor(opts?.horizon ?? DEFAULT_HORIZON))
  const evalWindow = Math.max(1, Math.floor(opts?.evalWindow ?? DEFAULT_EVAL_WINDOW))
  const z = opts?.z ?? DEFAULT_Z
  const requested = (opts?.methods && opts.methods.length > 0
    ? opts.methods
    : DEFAULT_METHODS
  ).filter((m, i, a) => a.indexOf(m) === i)

  const n = series.length
  const minRequired = Math.max(evalWindow + 4, 8)

  if (n < minRequired) {
    return fallbackForecast(
      series,
      { horizon, z },
      `series.length=${n} < ${minRequired}`
    )
  }

  // ------------------------------------------------------------------ Holdout
  const train = series.slice(0, n - evalWindow)
  const holdout = series.slice(n - evalWindow).map((p) => safeNum(p.value, 0))

  // Per-method forecast over the holdout window
  const holdoutForecasts = new Map<ForecastMethod, number[]>()
  const scores: MethodScore[] = []
  for (const m of requested) {
    const fc = clampPad(FORECASTERS[m](train, evalWindow), evalWindow, 0)
    holdoutForecasts.set(m, fc)
    const mape = computeMape(holdout, fc)
    const rmse = computeRmse(holdout, fc)
    scores.push({ method: m, mape, rmse, weight: 0 })
  }

  // ------------------------------------------------------------------- Weights
  // Reject methods with >50% MAPE, otherwise weight = 1 / (mape + 0.01) and normalize.
  const eligible = scores.filter((s) => s.mape <= MAPE_REJECT_THRESHOLD)
  if (eligible.length === 0) {
    // Everything is terrible — fall back to single-method LinReg
    return fallbackForecast(
      series,
      { horizon, z },
      `all methods exceeded MAPE ${MAPE_REJECT_THRESHOLD}`
    )
  }
  const rawWeights = new Map<ForecastMethod, number>()
  let sumRaw = 0
  for (const s of eligible) {
    const w = 1 / (s.mape + 0.01)
    rawWeights.set(s.method, w)
    sumRaw += w
  }
  for (const s of scores) {
    const raw = rawWeights.get(s.method)
    s.weight = raw && sumRaw > 0 ? raw / sumRaw : 0
  }

  // ----------------------------------------------------- Final forecast & band
  // Re-fit on full series and combine.
  const finalForecasts = new Map<ForecastMethod, number[]>()
  for (const m of requested) {
    finalForecasts.set(m, clampPad(FORECASTERS[m](series, horizon), horizon, 0))
  }

  const combined: number[] = new Array(horizon).fill(0)
  for (const s of scores) {
    if (s.weight === 0) continue
    const fc = finalForecasts.get(s.method)!
    for (let h = 0; h < horizon; h++) combined[h] += s.weight * fc[h]
  }

  // Residual stddev: compute the same weighted blend over the holdout window
  // and measure its error against the actual holdout values.
  const blendedHoldout: number[] = new Array(evalWindow).fill(0)
  for (const s of scores) {
    if (s.weight === 0) continue
    const fc = holdoutForecasts.get(s.method)!
    for (let i = 0; i < evalWindow; i++) blendedHoldout[i] += s.weight * fc[i]
  }
  const residuals: number[] = []
  for (let i = 0; i < evalWindow; i++) residuals.push(holdout[i] - blendedHoldout[i])
  const residSigma = Math.sqrt(variance(residuals))
  const band = z * residSigma

  const stamps = buildFutureTimestamps(series, horizon)
  const points: ForecastPoint[] = combined.map((v, i) => {
    const safeV = safeNum(v, series[n - 1].value)
    return {
      timestamp: stamps[i].timestamp,
      label: stamps[i].label,
      value: safeV,
      isForecast: true,
      confidenceLow: safeV - band,
      confidenceHigh: safeV + band,
    }
  })

  // -------------------------------------------------------------------- Notes
  scores.sort((a, b) => b.weight - a.weight)
  const used = scores.filter((s) => s.weight > 0)
  const parts = used.map(
    (s) => `${METHOD_LABEL_RU[s.method]} ${s.weight.toFixed(2)}`
  )
  const dominant = used[0]
  const dominantLabel = dominant ? METHOD_LABEL_RU[dominant.method] : '—'
  const notes = used.length > 0
    ? `Ансамбль: ${dominantLabel} доминирует (вес ${dominant.weight.toFixed(2)}). ${parts.join(', ')}.`
    : `Ансамбль: ${dominantLabel} доминирует.`

  return { points, methodScores: scores, notes }
}
