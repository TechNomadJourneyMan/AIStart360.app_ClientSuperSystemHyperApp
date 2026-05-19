import { describe, it, expect } from 'vitest'
import { forecast } from '@/lib/metrics/forecast'
import type { TimeseriesPoint } from '@/types/metrics'

function monthly(values: number[]): TimeseriesPoint[] {
  return values.map((value, i) => ({
    timestamp: new Date(2026, i, 1).toISOString(),
    value,
    label: `M${i + 1}`,
  }))
}

function quarterly(values: number[]): TimeseriesPoint[] {
  return values.map((value, i) => ({
    timestamp: new Date(2026, i * 3, 1).toISOString(),
    value,
    label: `Q${i + 1}`,
  }))
}

describe('forecast', () => {
  it('returns [] for an empty series', () => {
    expect(forecast([])).toEqual([])
  })

  it('returns [] for a single-point series', () => {
    expect(forecast(monthly([100]))).toEqual([])
  })

  it('extends a strictly increasing linear trend upward', () => {
    const series = monthly([100, 110, 120, 130, 140, 150])
    const out = forecast(series)
    expect(out.length).toBe(4)
    // All future values should sit above the last observed (150) and
    // above each other (monotonic increase, since both LR and EMA agree).
    expect(out[0].value).toBeGreaterThan(150)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].value).toBeGreaterThan(out[i - 1].value)
    }
  })

  it('produces a flat forecast for a flat series', () => {
    const series = monthly([100, 100, 100, 100, 100, 100, 100, 100])
    const out = forecast(series)
    expect(out.length).toBeGreaterThan(0)
    for (const p of out) {
      expect(Math.abs(p.value - 100)).toBeLessThan(1e-6)
      expect(p.confidenceLow).toBeCloseTo(100, 6)
      expect(p.confidenceHigh).toBeCloseTo(100, 6)
    }
  })

  it('respects the horizon option', () => {
    const series = monthly([10, 20, 30, 40, 50])
    expect(forecast(series, { horizon: 2 })).toHaveLength(2)
    expect(forecast(series, { horizon: 6 })).toHaveLength(6)
  })

  it('infers monthly cadence and labels future months', () => {
    const series = monthly([10, 20, 30, 40, 50])
    const out = forecast(series, { horizon: 3 })
    // Monthly labels look like "<mon> '<YY>" — three characters of
    // Cyrillic month + apostrophe + 2-digit year.
    expect(out[0].label).toMatch(/^[а-яё]{3} '\d{2}$/i)
  })

  it('infers quarterly cadence and labels future quarters', () => {
    const series = quarterly([10, 20, 30, 40, 50])
    const out = forecast(series, { horizon: 2 })
    // Quarterly labels look like "Q1 '26".
    expect(out[0].label).toMatch(/^Q[1-4] '\d{2}$/)
  })

  it('marks every output point with isForecast=true and a band', () => {
    const series = monthly([10, 12, 15, 18, 22, 27])
    const out = forecast(series)
    for (const p of out) {
      expect(p.isForecast).toBe(true)
      expect(p.confidenceLow).toBeLessThanOrEqual(p.value)
      expect(p.confidenceHigh).toBeGreaterThanOrEqual(p.value)
    }
  })
})
