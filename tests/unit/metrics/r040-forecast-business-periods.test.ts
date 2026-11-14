/**
 * R-040 (BI-43): the forecast in the metric window was built on the history of INPUT EDITS, from 2 points,
 * with a zero band: «100, then corrected to 120» → 134.4 / 154.4 / 174.4 / 194.4 with the band [134.4; 134.4];
 * the series 100 → 40 gave −165 at step 4 (negative revenue).
 * Now: business periods only (one point per period, the latest version), at least 6 points (else «мало данных»),
 * a band that widens with the horizon, no negative forecast for a non-negative metric.
 */
import { describe, expect, it } from 'vitest'
import { FORECAST_MIN_POINTS, forecast, forecastSeries } from '@/lib/metrics/forecast'
import { historyToPoints } from '@/lib/metrics/timeseries-fetch'
import type { TimeseriesPoint } from '@/types/metrics'

const monthly = (values: number[]): TimeseriesPoint[] =>
  values.map((value, i) => ({ timestamp: new Date(Date.UTC(2026, i + 1, 0)).toISOString(), value, label: `M${i + 1}` }))

const histRow = (value: number, recorded_at: string, period: { y?: number; m?: number } = {}) => ({
  value, source: 'survey', period_year: period.y ?? null, period_quarter: null, period_month: period.m ?? null, recorded_at,
})

describe('R-040 — the metric forecast runs on business periods only', () => {
  it('R-040: «100, then corrected to 120» (two edits, no period) → no forecast (was 134.4…194.4 with a zero band)', () => {
    const pts = historyToPoints([histRow(100, '2026-11-01T10:00:00Z'), histRow(120, '2026-11-01T10:05:00Z')], null)
    expect(pts).toHaveLength(2) // the chart still shows the edits
    expect(forecast(pts)).toEqual([])
    const r = forecastSeries(pts)
    expect(r.status).toBe('not_business_periods')
    expect(r.reason).toMatch(/бизнес-период/)
  })

  it('R-040: even many edits are not a series: 8 edits without a period → no forecast', () => {
    const rows = Array.from({ length: 8 }, (_, k) => histRow(100 + k * 10, `2026-0${1 + (k % 9)}-15T10:00:00Z`))
    expect(forecast(historyToPoints(rows, null))).toEqual([])
  })

  it('R-040: 100 → 40 (2 periods) → «мало данных» (was −165 at step 4)', () => {
    const r = forecastSeries(monthly([100, 40]))
    expect(r.points).toEqual([])
    expect(r.status).toBe('insufficient_data')
    expect(r.reason).toMatch(/не меньше 6/)
  })

  it('R-040: 5 periods are not enough, 6 are', () => {
    expect(FORECAST_MIN_POINTS).toBe(6)
    expect(forecast(monthly([10, 20, 30, 40, 50]))).toEqual([])
    expect(forecast(monthly([10, 20, 30, 40, 50, 60]))).toHaveLength(4)
  })

  it('R-040: one point per period — the latest version of a corrected month wins', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, k) => histRow(100, '2026-07-01T00:00:00Z', { y: 2026, m: k + 1 })),
      histRow(160, '2026-08-01T00:00:00Z', { y: 2026, m: 6 }), // June corrected later: 100 → 160
    ]
    const pts = historyToPoints(rows, null)
    expect(pts.map((p) => p.value)).toEqual([100, 100, 100, 100, 100, 160])
    const r = forecastSeries(pts)
    expect(r.status).toBe('ok')
    expect(r.n).toBe(6)
  })

  it('R-040: a non-negative metric is never forecast below 0 (falling 100 → 0 in six periods)', () => {
    const out = forecast(monthly([100, 80, 60, 40, 20, 5]), { horizon: 6 })
    expect(out).toHaveLength(6)
    for (const p of out) {
      expect(p.value).toBeGreaterThanOrEqual(0)
      expect(p.confidenceLow).toBeGreaterThanOrEqual(0)
      expect(p.confidenceHigh).toBeGreaterThanOrEqual(p.value)
    }
  })

  it('R-040: a metric with an upper bound (a percentage) is capped', () => {
    const out = forecast(monthly([50, 60, 70, 80, 90, 98]), { horizon: 4, upperBound: 100 })
    for (const p of out) {
      expect(p.value).toBeLessThanOrEqual(100)
      expect(p.confidenceHigh).toBeLessThanOrEqual(100)
    }
  })

  it('R-040: the band is not zero for a noisy series and widens with the horizon', () => {
    const out = forecast(monthly([100, 112, 104, 118, 109, 121, 113, 126]), { horizon: 6 })
    const width = out.map((p) => p.confidenceHigh - p.confidenceLow)
    expect(width[0]).toBeGreaterThan(0)
    for (let i = 1; i < width.length; i++) expect(width[i]).toBeGreaterThan(width[i - 1])
  })

  it('R-040: the confidence is computed from the fit, not a constant', () => {
    const smooth = forecastSeries(monthly([100, 101, 102, 103, 104, 105, 106]))
    const noisy = forecastSeries(monthly([100, 140, 70, 160, 60, 150, 90]))
    expect(smooth.confidence).not.toBeNull()
    expect(noisy.confidence).not.toBeNull()
    expect(smooth.confidence!).toBeGreaterThan(noisy.confidence!)
  })
})
