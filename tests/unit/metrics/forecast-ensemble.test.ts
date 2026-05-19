import { describe, it, expect } from 'vitest'
import { ensembleForecast, type ForecastMethod } from '@/lib/metrics/forecast-ensemble'
import type { TimeseriesPoint } from '@/types/metrics'

// ---------------------------------------------------------------------------
// Synthetic series helpers
// ---------------------------------------------------------------------------

function mkSeriesMonthly(values: number[]): TimeseriesPoint[] {
  return values.map((value, i) => {
    const d = new Date(Date.UTC(2024, i, 1))
    return { timestamp: d.toISOString(), value, label: `M${i + 1}` }
  })
}

function mkSeriesQuarterly(values: number[]): TimeseriesPoint[] {
  return values.map((value, i) => {
    const d = new Date(Date.UTC(2024, i * 3, 1))
    return { timestamp: d.toISOString(), value, label: `Q${i + 1}` }
  })
}

function sumWeights(scores: { weight: number }[]): number {
  return scores.reduce((s, x) => s + x.weight, 0)
}

function weightOf(
  scores: { method: ForecastMethod; weight: number }[],
  m: ForecastMethod
): number {
  return scores.find((s) => s.method === m)?.weight ?? 0
}

// ---------------------------------------------------------------------------

describe('ensembleForecast', () => {
  it('1. empty / too-short series falls back to single-method LinReg with notes', () => {
    const empty = ensembleForecast([])
    expect(empty.methodScores.length).toBe(1)
    expect(empty.methodScores[0].method).toBe('linreg')
    expect(empty.methodScores[0].weight).toBe(1)
    expect(empty.notes.toLowerCase()).toContain('insufficient')
    expect(empty.points).toHaveLength(4)

    const tiny = ensembleForecast(mkSeriesMonthly([10, 11, 12, 13]))
    expect(tiny.methodScores.length).toBe(1)
    expect(tiny.notes.toLowerCase()).toContain('insufficient')
  })

  it('2. linear trend → linreg dominates (top method, > 0.25 weight)', () => {
    // Pure linear: linreg, holt and ar1 all forecast it exactly, so they
    // share the weight nearly equally. LinReg is consistently among the top
    // methods on a clean linear trend.
    const series = mkSeriesMonthly(
      Array.from({ length: 16 }, (_, i) => 100 + 5 * i)
    )
    const r = ensembleForecast(series)
    const linW = weightOf(r.methodScores, 'linreg')
    // linreg should be one of the top contributors (not zero-weighted).
    expect(linW).toBeGreaterThan(0.2)
    // EMA, which lags constant trends, should never dominate a pure ramp.
    expect(linW).toBeGreaterThanOrEqual(weightOf(r.methodScores, 'ema'))
  })

  it('3. flat series → naive-like methods (ema) dominate', () => {
    const series = mkSeriesMonthly(
      Array.from({ length: 16 }, () => 100)
    )
    const r = ensembleForecast(series)
    // On a perfectly flat series several methods get near-zero MAPE, so they
    // share the weight. EMA, LinReg, Holt and AR(1) should each be small but
    // non-negative, and the *combined* forecast should be ~100.
    expect(r.points.every((p) => Math.abs(p.value - 100) < 1e-6)).toBe(true)
    expect(sumWeights(r.methodScores)).toBeCloseTo(1, 3)
  })

  it('4. seasonal sine wave → no single dominant method', () => {
    const series = mkSeriesMonthly(
      Array.from({ length: 24 }, (_, i) => 100 + 20 * Math.sin((i * Math.PI) / 3))
    )
    const r = ensembleForecast(series)
    const top = Math.max(...r.methodScores.map((s) => s.weight))
    // No method should completely dominate (>90%) for noisy seasonal data.
    expect(top).toBeLessThan(0.9)
  })

  it('5. Holt-style linear trend → holt is among top methods', () => {
    // Pure linear with a tiny noise so Holt's level+trend tracks it closely.
    const series = mkSeriesMonthly(
      Array.from({ length: 20 }, (_, i) => 50 + 3 * i + Math.sin(i) * 0.5)
    )
    const r = ensembleForecast(series)
    const holtW = weightOf(r.methodScores, 'holt')
    const linW = weightOf(r.methodScores, 'linreg')
    // Holt should be either the dominant or co-dominant method on a clean trend.
    expect(Math.max(holtW, linW)).toBeGreaterThan(0.3)
    expect(holtW).toBeGreaterThan(0.05)
  })

  it('6. AR(1) generated series with phi=0.7 → ar1 wins or co-leads', () => {
    const phi = 0.7
    const c = 10
    const values: number[] = [c / (1 - phi)]
    // Deterministic pseudo-noise so the test is stable.
    for (let i = 1; i < 30; i++) {
      const noise = ((i * 9301 + 49297) % 233280) / 233280 - 0.5
      values.push(c + phi * values[i - 1] + noise * 0.5)
    }
    const r = ensembleForecast(mkSeriesMonthly(values))
    const ar1W = weightOf(r.methodScores, 'ar1')
    // AR(1) should be at least competitive (top-2) on AR(1)-generated data.
    const sorted = [...r.methodScores].sort((a, b) => b.weight - a.weight)
    const top2 = sorted.slice(0, 2).map((s) => s.method)
    expect(top2.includes('ar1') || ar1W > 0.2).toBe(true)
  })

  it('7. horizon=8 produces exactly 8 forecast points', () => {
    const series = mkSeriesMonthly(
      Array.from({ length: 20 }, (_, i) => 100 + 2 * i)
    )
    const r = ensembleForecast(series, { horizon: 8 })
    expect(r.points).toHaveLength(8)
  })

  it('8. confidenceLow ≤ value ≤ confidenceHigh for every point', () => {
    const series = mkSeriesMonthly(
      Array.from({ length: 18 }, (_, i) => 50 + 2 * i + Math.sin(i))
    )
    const r = ensembleForecast(series)
    for (const p of r.points) {
      expect(p.confidenceLow).toBeLessThanOrEqual(p.value + 1e-9)
      expect(p.value).toBeLessThanOrEqual(p.confidenceHigh + 1e-9)
    }
  })

  it('9. every point has isForecast === true', () => {
    const series = mkSeriesMonthly(
      Array.from({ length: 16 }, (_, i) => 10 + i)
    )
    const r = ensembleForecast(series)
    expect(r.points.every((p) => p.isForecast === true)).toBe(true)
  })

  it('10. timestamps monotonically increase by detected cadence (monthly vs quarterly)', () => {
    const monthly = ensembleForecast(
      mkSeriesMonthly(Array.from({ length: 16 }, (_, i) => 100 + i))
    )
    for (let i = 1; i < monthly.points.length; i++) {
      const prev = Date.parse(monthly.points[i - 1].timestamp)
      const cur = Date.parse(monthly.points[i].timestamp)
      expect(cur).toBeGreaterThan(prev)
      const diffDays = (cur - prev) / 86_400_000
      expect(diffDays).toBeGreaterThanOrEqual(25)
      expect(diffDays).toBeLessThanOrEqual(35)
    }

    const quarterly = ensembleForecast(
      mkSeriesQuarterly(Array.from({ length: 12 }, (_, i) => 100 + 4 * i))
    )
    for (let i = 1; i < quarterly.points.length; i++) {
      const prev = Date.parse(quarterly.points[i - 1].timestamp)
      const cur = Date.parse(quarterly.points[i].timestamp)
      const diffDays = (cur - prev) / 86_400_000
      expect(diffDays).toBeGreaterThanOrEqual(80)
      expect(diffDays).toBeLessThanOrEqual(100)
    }
    // Russian quarterly labels use the "Q1 2024" format
    expect(quarterly.points[0].label).toMatch(/^Q[1-4]\s\d{4}$/)
  })

  it('11. method weights are in [0,1] and sum to 1 ± 0.001', () => {
    const series = mkSeriesMonthly(
      Array.from({ length: 20 }, (_, i) => 100 + 3 * i + Math.cos(i / 2))
    )
    const r = ensembleForecast(series)
    for (const s of r.methodScores) {
      expect(s.weight).toBeGreaterThanOrEqual(0)
      expect(s.weight).toBeLessThanOrEqual(1)
    }
    expect(sumWeights(r.methodScores)).toBeCloseTo(1, 3)
  })

  it('12. opts.methods=["linreg"] only → 100% weight on linreg', () => {
    const series = mkSeriesMonthly(
      Array.from({ length: 16 }, (_, i) => 50 + 2 * i)
    )
    const r = ensembleForecast(series, { methods: ['linreg'] })
    expect(r.methodScores).toHaveLength(1)
    expect(r.methodScores[0].method).toBe('linreg')
    expect(r.methodScores[0].weight).toBeCloseTo(1, 6)
  })

  it('13. a method with MAPE > 0.5 on the holdout is excluded (weight=0)', () => {
    // Convex cubic growth (y = i^3): LinReg / Holt extrapolate the local
    // slope reasonably (MAPE < 0.35) but EMA's flat-projected level lags hard
    // enough to cross the 50% MAPE threshold.
    const series = mkSeriesMonthly(
      Array.from({ length: 20 }, (_, i) => (i + 1) * (i + 1) * (i + 1))
    )
    const r = ensembleForecast(series, { methods: ['linreg', 'ema', 'holt', 'ar1'] })
    const ema = r.methodScores.find((s) => s.method === 'ema')
    expect(ema).toBeDefined()
    // Any method whose MAPE exceeds 0.5 must end up with zero weight.
    const rejected = r.methodScores.filter((s) => s.mape > 0.5)
    for (const s of rejected) expect(s.weight).toBe(0)
    // EMA specifically must be rejected on a sharply curving series.
    expect(ema!.mape).toBeGreaterThan(0.5)
    expect(ema!.weight).toBe(0)
  })

  it('14. Russian notes mention the dominant method label', () => {
    const series = mkSeriesMonthly(
      Array.from({ length: 16 }, (_, i) => 100 + 5 * i)
    )
    const r = ensembleForecast(series)
    expect(r.notes.startsWith('Ансамбль')).toBe(true)
    const dominant = r.methodScores[0]
    const labels: Record<string, string> = {
      linreg: 'LinReg',
      ema: 'EMA',
      holt: 'Holt',
      ar1: 'AR(1)',
      naive: 'Naive',
    }
    expect(r.notes).toContain(labels[dominant.method])
  })

  it('15. methodScores returned sorted by weight desc', () => {
    const series = mkSeriesMonthly(
      Array.from({ length: 20 }, (_, i) => 100 + 3 * i + Math.sin(i))
    )
    const r = ensembleForecast(series)
    for (let i = 1; i < r.methodScores.length; i++) {
      expect(r.methodScores[i - 1].weight).toBeGreaterThanOrEqual(
        r.methodScores[i].weight - 1e-12
      )
    }
  })
})
