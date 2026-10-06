// One number out of an answer (lib/metrics/numbers.ts) and the period of a
// value (lib/metrics/period.ts) — the two parsers every metric source uses.

import { describe, expect, it } from 'vitest'
import { coerceNumber, parseNumber, parseScale } from '@/lib/metrics/numbers'
import { coerceNumeric } from '@/lib/metrics/source-adapters'
import { parsePeriodLabel, periodFactor, periodFromText, periodRank } from '@/lib/metrics/period'

describe('parseNumber — exactly one number', () => {
  it('formatted amounts, scale words and currencies', () => {
    expect(coerceNumber('84 200 000')).toBe(84_200_000)
    expect(coerceNumber('84 200 000 ₸')).toBe(84_200_000)
    expect(coerceNumber('₸84.2М')).toBe(84_200_000)
    expect(coerceNumber('84,2 млн')).toBe(84_200_000)
    expect(coerceNumber('120 тыс')).toBe(120_000)
    expect(coerceNumber('120K')).toBe(120_000)
    expect(coerceNumber('1 200,5')).toBe(1200.5)
    expect(coerceNumber('1.234.567')).toBe(1_234_567)
    expect(coerceNumber('-500 000')).toBe(-500_000)
    expect(coerceNumber('(500 000)')).toBe(-500_000)
    expect(coerceNumber('около 5 млн')).toBe(5_000_000)
    expect(coerceNumber('30 дней')).toBe(30)
    expect(coerceNumber('12 сотрудников')).toBe(12)
    expect(coerceNumber(42)).toBe(42)
  })

  it('never glues digits of a ratio, a range or free text («8 из 10» was 810)', () => {
    for (const s of ['8 из 10', '8/10', '3:1', '2–3 млн', 'от 5 до 7 млн', '1 000 000 - 2 000 000', '2023: 5 млн', '5 млн, но падает',
      'instagram.com/shop123', 'нет', 'не знаю', 'до 5 млн', 'более 100', 'за 2024 год 84 млн']) {
      expect(coerceNumber(s), s).toBeNull()
      expect(coerceNumeric(s), s).toBeNull()
    }
  })

  it('a percentage is flagged, never an absolute value', () => {
    expect(parseNumber('+15%')).toMatchObject({ value: 15, percent: true })
    expect(parseNumber('34 процента')).toMatchObject({ value: 34, percent: true })
    expect(coerceNumber('+15%')).toBeNull()
  })

  it('reads the period and the currency written next to the number', () => {
    expect(parseNumber('около 5 млн в месяц')).toMatchObject({ value: 5_000_000, period: 'month' })
    expect(parseNumber('500 000 тг/мес')).toMatchObject({ value: 500_000, period: 'month', currency: '₸' })
    expect(parseNumber('6 млн в год')).toMatchObject({ value: 6_000_000, period: 'year' })
    expect(parseNumber('1 500 000 в квартал')).toMatchObject({ period: 'quarter' })
    expect(parseNumber('$12 000')).toMatchObject({ value: 12_000, currency: '$' })
  })

  it('parseScale: a score on a 0..10 scale', () => {
    expect(parseScale('8 из 10', 10)).toBe(8)
    expect(parseScale('8/10', 10)).toBe(8)
    expect(parseScale('8', 10)).toBe(8)
    expect(parseScale('4 из 5', 10)).toBe(8)
    expect(parseScale('8 баллов', 10)).toBe(8)
    expect(parseScale('11', 10)).toBeNull()
    expect(parseScale('хорошо', 10)).toBeNull()
  })
})

describe('period of a value', () => {
  it('labels: year, quarter, month, spans', () => {
    expect(parsePeriodLabel('2025')).toMatchObject({ months: 12, year: 2025 })
    expect(parsePeriodLabel('2025-Q1')).toMatchObject({ months: 3, year: 2025, quarter: 'Q1' })
    expect(parsePeriodLabel('1 кв. 2025')).toMatchObject({ months: 3, quarter: 'Q1' })
    expect(parsePeriodLabel('II квартал 2025')).toMatchObject({ months: 3, quarter: 'Q2' })
    expect(parsePeriodLabel('март 2025')).toMatchObject({ months: 1, year: 2025, endMonth: 3 })
    expect(parsePeriodLabel('январь–март 2025')).toMatchObject({ months: 3, quarter: 'Q1' })
    expect(parsePeriodLabel('за 9 месяцев 2025')).toMatchObject({ months: 9, year: 2025 })
    expect(parsePeriodLabel('итого')).toBeNull()
    expect(parsePeriodLabel('')).toBeNull()
  })

  it('document text: only phrases that state the reporting period', () => {
    expect(periodFromText('Отчёт о прибылях и убытках за 1 квартал 2025 года')).toMatchObject({ months: 3, quarter: 'Q1', year: 2025 })
    expect(periodFromText('Выручка за 2024 год составила')).toMatchObject({ months: 12, year: 2024 })
    expect(periodFromText('Компания основана в 2010 году')).toBeNull()
  })

  it('rescaling factor to the metric period; recency rank', () => {
    expect(periodFactor(3, 'year')).toBe(4)
    expect(periodFactor(1, 'year')).toBe(12)
    expect(periodFactor(12, 'month')).toBeCloseTo(1 / 12)
    expect(periodFactor(9, 'year')).toBeCloseTo(12 / 9)
    expect(periodFactor(3, undefined)).toBe(1) // a ratio / point value is never rescaled
    expect(periodRank(parsePeriodLabel('2025-Q1'))).toBeGreaterThan(periodRank(parsePeriodLabel('2024')))
  })
})
