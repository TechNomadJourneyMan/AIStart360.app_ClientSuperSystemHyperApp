import { describe, it, expect } from 'vitest'
import { decompose } from '@/lib/metrics/seasonality'
import type { TimeseriesPoint } from '@/types/metrics'

const DAY_MS = 86_400_000

function makeSeries(
  count: number,
  stepDays: number,
  valueFn: (i: number) => number,
  startMs = Date.UTC(2025, 0, 1),
): TimeseriesPoint[] {
  const out: TimeseriesPoint[] = []
  for (let i = 0; i < count; i++) {
    const ts = new Date(startMs + i * stepDays * DAY_MS)
    out.push({
      timestamp: ts.toISOString(),
      value: valueFn(i),
      label: `P${i}`,
    })
  }
  return out
}

describe('decompose - seasonality decomposition', () => {
  it('empty series → notEnoughData=true with zero components', () => {
    const result = decompose([])
    expect(result.meta.notEnoughData).toBe(true)
    expect(result.trend).toEqual([])
    expect(result.seasonal).toEqual([])
    expect(result.residual).toEqual([])
  })

  it('too few points → notEnoughData=true and zero values, same length as input', () => {
    const series = makeSeries(5, 30, (i) => i)
    const result = decompose(series)
    expect(result.meta.notEnoughData).toBe(true)
    expect(result.trend).toHaveLength(5)
    expect(result.seasonal).toHaveLength(5)
    expect(result.residual).toHaveLength(5)
    for (const p of result.trend) expect(p.value).toBe(0)
    for (const p of result.seasonal) expect(p.value).toBe(0)
    for (const p of result.residual) expect(p.value).toBe(0)
  })

  it('pure sine wave (period 12) → seasonalStrength > 0.7, trend ~ constant', () => {
    const period = 12
    const n = 48
    const series = makeSeries(n, 30, (i) => Math.sin((2 * Math.PI * i) / period) * 10)
    const result = decompose(series, { period: 12 })
    expect(result.meta.notEnoughData).toBe(false)
    expect(result.meta.period).toBe(12)
    expect(result.meta.seasonalStrength).toBeGreaterThan(0.7)

    // Trend should be roughly constant (close to 0 for centered sine)
    const trendVals = result.trend.map((p) => p.value)
    const trendMean = trendVals.reduce((a, b) => a + b, 0) / trendVals.length
    const trendMaxDev = Math.max(...trendVals.map((v) => Math.abs(v - trendMean)))
    expect(trendMaxDev).toBeLessThan(2)
  })

  it('pure linear trend, no seasonality → detrendStrength > 0.7, seasonalStrength < 0.2', () => {
    const series = makeSeries(48, 30, (i) => 5 + i * 2)
    const result = decompose(series, { period: 12 })
    expect(result.meta.notEnoughData).toBe(false)
    expect(result.meta.detrendStrength).toBeGreaterThan(0.7)
    expect(result.meta.seasonalStrength).toBeLessThan(0.2)
  })

  it('auto-detects period=12 when cadence ~30 days', () => {
    const series = makeSeries(36, 30, (i) => Math.sin((2 * Math.PI * i) / 12) * 5 + i * 0.5)
    const result = decompose(series)
    expect(result.meta.period).toBe(12)
    expect(result.meta.notEnoughData).toBe(false)
  })

  it('auto-detects period=4 when cadence ~90 days', () => {
    const series = makeSeries(16, 90, (i) => Math.sin((2 * Math.PI * i) / 4) * 5 + i * 0.5)
    const result = decompose(series)
    expect(result.meta.period).toBe(4)
    expect(result.meta.notEnoughData).toBe(false)
  })

  it('components sum back to original within tolerance', () => {
    const series = makeSeries(36, 30, (i) => 100 + i * 2 + Math.sin((2 * Math.PI * i) / 12) * 7 + (i % 5))
    const result = decompose(series, { period: 12 })
    expect(result.meta.notEnoughData).toBe(false)
    for (let i = 0; i < series.length; i++) {
      const recon = result.trend[i].value + result.seasonal[i].value + result.residual[i].value
      expect(Math.abs(recon - series[i].value)).toBeLessThan(0.01)
    }
  })

  it('trend + seasonal + noise → mixed strengths in valid 0..1 range', () => {
    const period = 12
    const series = makeSeries(60, 30, (i) => {
      const trend = i * 1.5
      const season = Math.sin((2 * Math.PI * i) / period) * 8
      const noise = ((i * 9301 + 49297) % 233280) / 233280 - 0.5
      return 50 + trend + season + noise
    })
    const result = decompose(series, { period: 12 })
    expect(result.meta.notEnoughData).toBe(false)
    expect(result.meta.detrendStrength).toBeGreaterThanOrEqual(0)
    expect(result.meta.detrendStrength).toBeLessThanOrEqual(1)
    expect(result.meta.seasonalStrength).toBeGreaterThanOrEqual(0)
    expect(result.meta.seasonalStrength).toBeLessThanOrEqual(1)
    expect(result.meta.detrendStrength).toBeGreaterThan(0.5)
    expect(result.meta.seasonalStrength).toBeGreaterThan(0.3)
  })

  it('seasonal component is centered (mean ~ 0) over an integer number of periods', () => {
    const series = makeSeries(48, 30, (i) => Math.sin((2 * Math.PI * i) / 12) * 4 + i)
    const result = decompose(series, { period: 12 })
    const seasonalVals = result.seasonal.map((p) => p.value)
    const mean = seasonalVals.reduce((a, b) => a + b, 0) / seasonalVals.length
    expect(Math.abs(mean)).toBeLessThan(0.05)
  })

  it('output values are rounded to 4 decimal places', () => {
    const series = makeSeries(36, 30, (i) => Math.sin(i / 3) * 1.2345678 + i * 0.1234567)
    const result = decompose(series, { period: 12 })
    const checkRounded = (n: number) => {
      const scaled = n * 10_000
      expect(Math.abs(scaled - Math.round(scaled))).toBeLessThan(1e-6)
    }
    for (const p of result.trend) checkRounded(p.value)
    for (const p of result.seasonal) checkRounded(p.value)
    for (const p of result.residual) checkRounded(p.value)
  })

  it('preserves timestamps and labels on every component', () => {
    const series = makeSeries(36, 30, (i) => i + Math.sin(i / 2))
    const result = decompose(series, { period: 12 })
    for (let i = 0; i < series.length; i++) {
      expect(result.trend[i].timestamp).toBe(series[i].timestamp)
      expect(result.trend[i].label).toBe(series[i].label)
      expect(result.seasonal[i].timestamp).toBe(series[i].timestamp)
      expect(result.seasonal[i].label).toBe(series[i].label)
      expect(result.residual[i].timestamp).toBe(series[i].timestamp)
      expect(result.residual[i].label).toBe(series[i].label)
    }
  })

  it('respects custom minPoints option', () => {
    const series = makeSeries(10, 30, (i) => i)
    const tooFew = decompose(series, { period: 4, minPoints: 50 })
    expect(tooFew.meta.notEnoughData).toBe(true)
    const enough = decompose(series, { period: 4, minPoints: 8 })
    expect(enough.meta.notEnoughData).toBe(false)
  })
})
