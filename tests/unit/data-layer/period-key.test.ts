import { describe, it, expect } from 'vitest'
import { periodKey, periodOrdinal, periodFromParts, parsePeriodKey, periodLabel } from '@/lib/data-layer/period-key'

describe('periodKey', () => {
  it('formats years, quarters, months, YTD and unknown', () => {
    expect(periodKey({ year: 2024, quarter: null, month: null })).toBe('2024')
    expect(periodKey({ year: 2024, quarter: 2, month: null })).toBe('2024-Q2')
    expect(periodKey({ year: 2024, quarter: 1, month: 3 })).toBe('2024-03')
    expect(periodKey({ year: 2026, quarter: null, month: null, ytd: true })).toBe('2026-YTD')
    expect(periodKey(null)).toBe('unknown')
  })

  it('round-trips through parsePeriodKey', () => {
    for (const k of ['2024', '2024-Q2', '2024-03', '2026-YTD']) expect(periodKey(parsePeriodKey(k))).toBe(k)
    expect(parsePeriodKey('unknown')).toBeNull()
    expect(parsePeriodKey('2024-13')).toBeNull()
  })
})

describe('periodOrdinal', () => {
  it('orders by the end of the period', () => {
    const y = periodOrdinal({ year: 2024, quarter: null, month: null })!
    const q3 = periodOrdinal({ year: 2024, quarter: 3, month: null })!
    const m3 = periodOrdinal({ year: 2024, quarter: 1, month: 3 })!
    expect(y).toBeGreaterThan(q3)
    expect(q3).toBeGreaterThan(m3)
    expect(periodOrdinal({ year: 2025, quarter: 1, month: 1 })!).toBeGreaterThan(y)
    expect(periodOrdinal(null)).toBeNull()
  })
})

describe('periodFromParts', () => {
  it('reads stored columns', () => {
    expect(periodFromParts(2025, 'Q1', null)).toEqual({ year: 2025, quarter: 1, month: null })
    expect(periodFromParts(2025, null, 8)).toEqual({ year: 2025, quarter: 3, month: 8 })
    expect(periodFromParts(2025)).toEqual({ year: 2025, quarter: null, month: null })
    expect(periodFromParts(null, 'Q1')).toBeNull()
  })
})

describe('periodLabel', () => {
  it('renders Russian labels', () => {
    expect(periodLabel('2024-Q2')).toBe('II кв. 2024')
    expect(periodLabel('2024-03')).toBe('03.2024')
    expect(periodLabel('unknown')).toBe('период неизвестен')
  })
})
