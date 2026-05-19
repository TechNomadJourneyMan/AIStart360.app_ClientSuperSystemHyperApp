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
// 5. Confidence band = ±1.96·residualStddev where residuals are the
//    regression residuals on the observed window.
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
}

const DEFAULTS: Required<ForecastOptions> = {
  horizon: 4,
  alpha: 0.3,
  blend: 0.6,
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

export function forecast(
  series: TimeseriesPoint[],
  opts?: ForecastOptions,
): ForecastPoint[] {
  const cfg = { ...DEFAULTS, ...(opts ?? {}) }
  if (!series || series.length < 2) return []
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
  const band = 1.96 * residStd

  const points: ForecastPoint[] = []
  for (let h = 1; h <= horizon; h++) {
    // LR projection at index (windowSize - 1 + h) in the regression frame.
    const idx = windowSize - 1 + h
    const lrVal = a + b * idx
    // EMA continuation is "last EMA level + trend slope × h" — i.e. the
    // smoothed level carried forward along the regression slope.
    const emaVal = emaLast + b * h
    const blended = cfg.blend * lrVal + (1 - cfg.blend) * emaVal

    const date = stepDate(lastDate, cadence, deltaMs, h)
    points.push({
      timestamp: date.toISOString(),
      value: round2(blended),
      label: buildLabel(date, cadence),
      isForecast: true,
      confidenceLow: round2(blended - band),
      confidenceHigh: round2(blended + band),
    })
  }
  return points
}
