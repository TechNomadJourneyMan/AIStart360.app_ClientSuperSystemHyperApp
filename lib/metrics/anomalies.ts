// ============================================================
// lib/metrics/anomalies.ts
// Rolling z-score anomaly detector. Pure function: takes a
// TimeseriesPoint[] and returns AnomalyPoint[]. Never touches DB.
//
// Algorithm
// ---------
// 1. Slide a window of `window` points (default 8) preceding each
//    candidate point. Compute mean / sample stddev.
// 2. z = (value - mean) / stddev
//      |z| > zCritical (3.0)  -> 'critical'
//      |z| > zWarning  (2.0)  -> 'warning'
//      |z| > zInfo     (1.5)  -> 'info'
// 3. Flat-line collapse check: when the last 3 points are equal AND
//    the prior window had a non-zero stddev > meanAbs * 0.005, flag
//    the last point as a 'warning' (structural break).
// 4. Russian description template uses the signed deltaPct from the
//    rolling mean: e.g. "Резкий рост +24.3% относительно среднего —
//    выходит за пределы статистического коридора (z=3.4)."
// ============================================================

import type { TimeseriesPoint, AnomalyPoint, AnomalySeverity } from '@/types/metrics'

export interface AnomalyDetectOptions {
  /** Size of the trailing window used for mean/stddev (default 8). */
  window?: number
  /** |z| threshold for 'critical' severity (default 3.0). */
  zCritical?: number
  /** |z| threshold for 'warning' severity (default 2.0). */
  zWarning?: number
  /** |z| threshold for 'info' severity (default 1.5). */
  zInfo?: number
  /** Minimum points required before any detection runs (default 4). */
  minPoints?: number
}

const DEFAULTS: Required<AnomalyDetectOptions> = {
  window: 8,
  zCritical: 3,
  zWarning: 2,
  zInfo: 1.5,
  minPoints: 4,
}

function meanStddev(values: number[]): { mean: number; stddev: number } {
  const n = values.length
  if (n === 0) return { mean: 0, stddev: 0 }
  let sum = 0
  for (const v of values) sum += v
  const mean = sum / n
  if (n < 2) return { mean, stddev: 0 }
  let acc = 0
  for (const v of values) {
    const d = v - mean
    acc += d * d
  }
  // Sample standard deviation (n-1).
  const stddev = Math.sqrt(acc / (n - 1))
  return { mean, stddev }
}

function describe(severity: AnomalySeverity, deltaPct: number, z: number): string {
  const sign = deltaPct >= 0 ? '+' : ''
  const pct = `${sign}${deltaPct.toFixed(1)}%`
  const zStr = `z=${z.toFixed(2)}`
  if (severity === 'critical') {
    return deltaPct >= 0
      ? `Резкий скачок ${pct} относительно среднего — выходит за пределы статистического коридора (${zStr}).`
      : `Резкое падение ${pct} относительно среднего — выходит за пределы статистического коридора (${zStr}).`
  }
  if (severity === 'warning') {
    return deltaPct >= 0
      ? `Заметный рост ${pct} относительно среднего — отклонение выше нормального коридора (${zStr}).`
      : `Заметное снижение ${pct} относительно среднего — отклонение выше нормального коридора (${zStr}).`
  }
  return `Небольшое отклонение ${pct} от среднего значения (${zStr}).`
}

function flatLineDescription(): string {
  return 'Серия зафиксировалась на одном уровне — возможен сбой источника данных или приостановка операций.'
}

export function detectAnomalies(
  series: TimeseriesPoint[],
  opts?: AnomalyDetectOptions,
): AnomalyPoint[] {
  const cfg = { ...DEFAULTS, ...(opts ?? {}) }
  const out: AnomalyPoint[] = []
  if (!series || series.length < cfg.minPoints) return out

  for (let i = 1; i < series.length; i++) {
    const start = Math.max(0, i - cfg.window)
    const windowSlice = series.slice(start, i)
    if (windowSlice.length < 2) continue

    const { mean, stddev } = meanStddev(windowSlice.map((p) => p.value))
    if (!Number.isFinite(stddev)) continue

    const value = series[i].value
    const deltaPct = mean === 0 ? 0 : ((value - mean) / Math.abs(mean)) * 100

    let z: number
    let severity: AnomalySeverity | null = null
    if (stddev === 0) {
      // Window is perfectly flat. A change of any magnitude is a
      // structural break — classify by relative delta instead.
      if (value === mean) continue
      const absPct = Math.abs(deltaPct)
      // Synthesize a z-score proxy purely for the description.
      z = deltaPct >= 0 ? 999 : -999
      if (absPct >= 25) severity = 'critical'
      else if (absPct >= 10) severity = 'warning'
      else if (absPct >= 5) severity = 'info'
      else continue
    } else {
      z = (value - mean) / stddev
      const absZ = Math.abs(z)
      if (absZ > cfg.zCritical) severity = 'critical'
      else if (absZ > cfg.zWarning) severity = 'warning'
      else if (absZ > cfg.zInfo) severity = 'info'
      if (!severity) continue
    }
    if (!severity) continue

    out.push({
      timestamp: series[i].timestamp,
      label: series[i].label,
      value,
      severity,
      description: describe(severity, deltaPct, z),
    })
  }

  // ─── Flat-line collapse detector ──────────────────────────
  // Last three points identical, but the prior window had material
  // variability → flag the last point as a 'warning' if not already
  // flagged.
  const n = series.length
  if (n >= cfg.minPoints + 2) {
    const lastIdx = n - 1
    const a = series[lastIdx].value
    const b = series[lastIdx - 1].value
    const c = series[lastIdx - 2].value
    if (a === b && b === c) {
      const priorStart = Math.max(0, lastIdx - 2 - cfg.window)
      const prior = series.slice(priorStart, lastIdx - 2).map((p) => p.value)
      if (prior.length >= 3) {
        const { mean, stddev } = meanStddev(prior)
        const meanAbs = Math.abs(mean)
        if (stddev > meanAbs * 0.005 && stddev > 0) {
          const already = out.find((p) => p.timestamp === series[lastIdx].timestamp)
          if (!already) {
            out.push({
              timestamp: series[lastIdx].timestamp,
              label: series[lastIdx].label,
              value: a,
              severity: 'warning',
              description: flatLineDescription(),
            })
          } else if (already.severity === 'info') {
            // Upgrade an info-level rolling-z flag — the structural
            // flat-line break is a stronger signal.
            already.severity = 'warning'
            already.description = flatLineDescription()
          }
        }
      }
    }
  }

  return out
}
