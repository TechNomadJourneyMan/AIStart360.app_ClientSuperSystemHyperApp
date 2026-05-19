import type { TimeseriesPoint } from '@/types/metrics'

export interface DecompositionOptions {
  /** 4 = quarterly cycle, 12 = monthly cycle. Default: auto-detect from cadence */
  period?: 4 | 12
  /** default 2 * period */
  minPoints?: number
}

export interface Decomposition {
  /** same length as input, smoothed */
  trend: TimeseriesPoint[]
  /** same length as input, oscillating */
  seasonal: TimeseriesPoint[]
  /** same length as input, noise */
  residual: TimeseriesPoint[]
  meta: {
    period: number
    /** 0..1 — how much trend captures */
    detrendStrength: number
    /** 0..1 — how much seasonal captures */
    seasonalStrength: number
    notEnoughData: boolean
  }
}

const MS_PER_DAY = 86_400_000

function round4(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10_000) / 10_000
}

function variance(arr: number[]): number {
  if (arr.length === 0) return 0
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  let acc = 0
  for (const v of arr) {
    const d = v - mean
    acc += d * d
  }
  return acc / arr.length
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function autoDetectPeriod(series: TimeseriesPoint[]): 4 | 12 {
  if (series.length < 2) return 4
  const deltas: number[] = []
  for (let i = 1; i < series.length; i++) {
    const a = Date.parse(series[i - 1].timestamp)
    const b = Date.parse(series[i].timestamp)
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      deltas.push((b - a) / MS_PER_DAY)
    }
  }
  if (deltas.length === 0) return 4
  const sorted = [...deltas].sort((x, y) => x - y)
  const median = sorted[Math.floor(sorted.length / 2)]
  // ~30 days → monthly cadence → annual cycle of 12
  // ~90 days → quarterly cadence → annual cycle of 4
  if (median >= 15 && median <= 45) return 12
  if (median >= 60 && median <= 120) return 4
  // Default to 4 if uncertain
  return 4
}

/**
 * Centered moving average with window = period.
 *
 * For even periods we use the classic "2 x period" centered MA which produces
 * a symmetric, phase-aligned trend that fully removes a stationary seasonal
 * cycle of length `period`. For odd periods we use a simple symmetric MA.
 *
 * Edges (where a full centered window doesn't fit) fall back to a one-sided
 * average over whatever points are available.
 */
function movingAverage(values: number[], period: number): number[] {
  const n = values.length
  const out: number[] = new Array(n).fill(NaN)
  const half = Math.floor(period / 2)
  const evenPeriod = period % 2 === 0

  let firstValid = -1
  let lastValid = -1

  for (let i = 0; i < n; i++) {
    if (evenPeriod && i - half >= 0 && i + half <= n - 1) {
      // 2 x period centered MA: endpoints weighted 0.5
      let sum = 0.5 * values[i - half] + 0.5 * values[i + half]
      for (let k = i - half + 1; k <= i + half - 1; k++) sum += values[k]
      out[i] = sum / period
      if (firstValid < 0) firstValid = i
      lastValid = i
    } else if (!evenPeriod && i - half >= 0 && i + half <= n - 1) {
      let sum = 0
      for (let k = i - half; k <= i + half; k++) sum += values[k]
      out[i] = sum / period
      if (firstValid < 0) firstValid = i
      lastValid = i
    }
  }

  if (firstValid < 0) {
    // Series shorter than the centered window: fall back to global mean
    const mean = values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)
    return new Array(n).fill(mean)
  }

  // Linear extrapolation at the edges using the two nearest valid centered values.
  // This avoids edge-bias from one-sided averages that pollute the seasonal step.
  if (firstValid > 0) {
    const ref = firstValid
    const next = Math.min(lastValid, firstValid + 1)
    const slope = next > ref ? out[next] - out[ref] : 0
    for (let i = 0; i < firstValid; i++) {
      out[i] = out[ref] + slope * (i - ref)
    }
  }
  if (lastValid < n - 1) {
    const ref = lastValid
    const prev = Math.max(firstValid, lastValid - 1)
    const slope = ref > prev ? out[ref] - out[prev] : 0
    for (let i = lastValid + 1; i < n; i++) {
      out[i] = out[ref] + slope * (i - ref)
    }
  }

  return out
}

export function decompose(
  series: TimeseriesPoint[],
  opts?: DecompositionOptions,
): Decomposition {
  const period = opts?.period ?? autoDetectPeriod(series)
  const minPoints = opts?.minPoints ?? 2 * period

  const n = series.length

  if (n < minPoints) {
    const zero = (p: TimeseriesPoint): TimeseriesPoint => ({
      timestamp: p.timestamp,
      label: p.label,
      value: 0,
    })
    return {
      trend: series.map(zero),
      seasonal: series.map(zero),
      residual: series.map(zero),
      meta: {
        period,
        detrendStrength: 0,
        seasonalStrength: 0,
        notEnoughData: true,
      },
    }
  }

  const values = series.map((p) => (Number.isFinite(p.value) ? p.value : 0))

  // 1) Trend via centered moving average
  const trendVals = movingAverage(values, period)

  // 2) Detrended series
  const detrended = values.map((v, i) => v - trendVals[i])

  // 3) Seasonal: average detrended values at each phase position (i mod period)
  const phaseSums = new Array(period).fill(0)
  const phaseCounts = new Array(period).fill(0)
  for (let i = 0; i < n; i++) {
    const phase = i % period
    phaseSums[phase] += detrended[i]
    phaseCounts[phase] += 1
  }
  const phaseAvg = phaseSums.map((s, p) => (phaseCounts[p] > 0 ? s / phaseCounts[p] : 0))
  // Center to mean 0
  const phaseMean = phaseAvg.reduce((a, b) => a + b, 0) / period
  const phaseCentered = phaseAvg.map((v) => v - phaseMean)

  const seasonalVals = new Array(n).fill(0).map((_, i) => phaseCentered[i % period])

  // 4) Residual
  const residualVals = values.map((v, i) => v - trendVals[i] - seasonalVals[i])

  // 5) Strengths
  const varOriginal = variance(values)
  const varResidual = variance(residualVals)
  const detrendedPlusRes = seasonalVals.map((s, i) => s + residualVals[i])
  const varDetrendedPlusRes = variance(detrendedPlusRes)

  const detrendStrength = clamp01(
    varOriginal > 0 ? 1 - varDetrendedPlusRes / varOriginal : 0,
  )
  const seasonalStrength = clamp01(
    varDetrendedPlusRes > 0 ? 1 - varResidual / varDetrendedPlusRes : 0,
  )

  const toPoint = (p: TimeseriesPoint, v: number): TimeseriesPoint => ({
    timestamp: p.timestamp,
    label: p.label,
    value: round4(v),
  })

  return {
    trend: series.map((p, i) => toPoint(p, trendVals[i])),
    seasonal: series.map((p, i) => toPoint(p, seasonalVals[i])),
    residual: series.map((p, i) => toPoint(p, residualVals[i])),
    meta: {
      period,
      detrendStrength: round4(detrendStrength),
      seasonalStrength: round4(seasonalStrength),
      notEnoughData: false,
    },
  }
}
