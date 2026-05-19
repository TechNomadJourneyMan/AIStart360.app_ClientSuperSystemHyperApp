import { describe, it, expect } from 'vitest'
import { analyzeTrend } from '@/lib/metrics/trend'
import type { TimeseriesPoint } from '@/types/metrics'

function mkSeries(values: number[]): TimeseriesPoint[] {
  return values.map((value, i) => ({
    timestamp: new Date(2026, 0, i + 1).toISOString(),
    value,
    label: `D${i + 1}`,
  }))
}

describe('analyzeTrend', () => {
  it('returns insufficient_data when series is empty', () => {
    const r = analyzeTrend([])
    expect(r.label).toBe('insufficient_data')
    expect(r.shortLabel).toBe('—')
    expect(r.description).toBe('Недостаточно данных для оценки тренда')
    expect(r.direction).toBe('flat')
  })

  it('returns insufficient_data when fewer than minPoints', () => {
    const r = analyzeTrend(mkSeries([10, 12]))
    expect(r.label).toBe('insufficient_data')
  })

  it('classifies strong_growth (>+15%) with Russian description', () => {
    const r = analyzeTrend(mkSeries([100, 110, 125, 140]))
    expect(r.label).toBe('strong_growth')
    expect(r.shortLabel).toBe('Быстро растёт')
    expect(r.direction).toBe('up')
    expect(r.deltaPct).toBeCloseTo(40, 5)
    // Russian copy: "Быстро растёт: +40% за последние 4 периода"
    expect(r.description).toMatch(
      /^Быстро растёт: \+\d+(\.\d+)?% за последние \d+ период(а|ов)?$/
    )
  })

  it('classifies steady_growth (+5..+15%)', () => {
    const r = analyzeTrend(mkSeries([100, 103, 106, 108]))
    expect(r.label).toBe('steady_growth')
    expect(r.shortLabel).toBe('Растёт')
    expect(r.description).toMatch(/^Растёт: \+8% за последние 4 периода$/)
  })

  it('classifies flat (-5..+5%)', () => {
    const r = analyzeTrend(mkSeries([100, 101, 99, 102]))
    expect(r.label).toBe('flat')
    expect(r.shortLabel).toBe('Стабильно')
    expect(r.direction).toBe('flat')
    expect(r.description).toMatch(/^Стабильно: [+-]?\d+(\.\d+)?% за последние 4 периода$/)
  })

  it('classifies gentle_decline (-5..-15%)', () => {
    const r = analyzeTrend(mkSeries([100, 97, 94, 92]))
    expect(r.label).toBe('gentle_decline')
    expect(r.shortLabel).toBe('Снижается')
    expect(r.direction).toBe('down')
    expect(r.description).toMatch(/^Снижается: -8% за последние 4 периода$/)
  })

  it('classifies sharp_decline (< -15%)', () => {
    const r = analyzeTrend(mkSeries([100, 90, 75, 60]))
    expect(r.label).toBe('sharp_decline')
    expect(r.shortLabel).toBe('Резкое падение')
    expect(r.deltaPct).toBeCloseTo(-40, 5)
    expect(r.description).toMatch(/^Резкое падение: -40% за последние 4 периода$/)
  })

  it('detects volatile series (high CV, no clear trend)', () => {
    // alternating large swings around ~50, low r²
    const r = analyzeTrend(mkSeries([10, 90, 15, 85, 20, 80, 12, 88]))
    expect(r.label).toBe('volatile')
    expect(r.shortLabel).toBe('Колеблется')
    expect(r.description).toMatch(/^Высокая волатильность: колебания ±\d+%$/)
  })

  it('inverse mode: declining metric is good (e.g. CAC dropped 20%)', () => {
    // raw delta = -25% (sharp_decline) → inverse flips to strong_growth
    const r = analyzeTrend(mkSeries([100, 90, 80, 75]), { inverse: true })
    expect(r.inverse).toBe(true)
    expect(r.label).toBe('strong_growth')
    expect(r.description).toMatch(/^Хорошо: снизился на \d+% за последние 4 периода$/)
  })

  it('inverse mode: rising metric is bad (e.g. churn went up)', () => {
    // raw delta = +20% (strong_growth) → inverse flips to sharp_decline
    const r = analyzeTrend(mkSeries([100, 110, 115, 120]), { inverse: true })
    expect(r.inverse).toBe(true)
    expect(r.label).toBe('sharp_decline')
    expect(r.description).toMatch(/^Внимание: вырос на \d+% за последние 4 периода$/)
  })

  it('computes regression slope and direction for an upward series', () => {
    const r = analyzeTrend(mkSeries([10, 20, 30, 40, 50]))
    expect(r.slopePerPeriod).toBeGreaterThan(0)
    expect(r.direction).toBe('up')
    expect(r.label).toBe('strong_growth')
  })

  it('handles steady_growth boundary exactly at +5%', () => {
    const r = analyzeTrend(mkSeries([100, 102, 103, 105]))
    expect(r.label).toBe('steady_growth')
    expect(r.deltaPct).toBeCloseTo(5, 5)
  })

  it('respects custom minPoints option', () => {
    const r = analyzeTrend(mkSeries([10, 12, 14]), { minPoints: 5 })
    expect(r.label).toBe('insufficient_data')
  })

  it('Russian copy passes regex match for all non-insufficient labels', () => {
    const cases: Array<{ series: number[]; pattern: RegExp }> = [
      { series: [100, 130, 160, 200], pattern: /^Быстро растёт: \+\d+% за последние 4 периода$/ },
      { series: [100, 103, 106, 108], pattern: /^Растёт: \+\d+% за последние 4 периода$/ },
      { series: [100, 101, 99, 102], pattern: /^Стабильно: [+-]?\d+(\.\d+)?% за последние 4 периода$/ },
      { series: [100, 97, 94, 92], pattern: /^Снижается: -\d+% за последние 4 периода$/ },
      { series: [100, 80, 60, 50], pattern: /^Резкое падение: -\d+% за последние 4 периода$/ },
    ]
    for (const c of cases) {
      const r = analyzeTrend(mkSeries(c.series))
      expect(r.description).toMatch(c.pattern)
    }
  })
})
