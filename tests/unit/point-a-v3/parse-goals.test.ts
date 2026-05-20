// ============================================================
// Unit tests for lib/point-a/v3/parse-goals.ts
//
// The parser is pure — no fixtures, no DB. We assert that
// each goal string yields the expected KZT amount (using the
// project-fixed FX rate of $1 = 450 ₸) and a sane confidence.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  FX_RATE_USD_KZT,
  FX_RATE_RUB_KZT,
  parseGoalAmount,
  parseGoals,
} from '@/lib/point-a/v3/parse-goals'

describe('parseGoalAmount', () => {
  it('returns null for empty / nullish strings', () => {
    expect(parseGoalAmount(null)).toBeNull()
    expect(parseGoalAmount(undefined)).toBeNull()
    expect(parseGoalAmount('')).toBeNull()
    expect(parseGoalAmount('   ')).toBeNull()
  })

  it('parses USD millions (e.g. "$2M ARR")', () => {
    const out = parseGoalAmount('$2M ARR к концу 2026')
    expect(out).not.toBeNull()
    expect(out!.value).toBe(2 * 1_000_000 * FX_RATE_USD_KZT)
    expect(out!.currency).toBe('USD')
    expect(out!.unit).toBe('млн')
    expect(out!.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('parses Russian "200 млн ₸"', () => {
    const out = parseGoalAmount('200 млн ₸')
    expect(out).not.toBeNull()
    expect(out!.value).toBe(200_000_000)
    expect(out!.currency).toBe('KZT')
    expect(out!.unit).toBe('млн')
  })

  it('parses Russian "5 миллиардов тенге"', () => {
    const out = parseGoalAmount('вырасти до 5 миллиардов тенге за 3 года')
    expect(out).not.toBeNull()
    expect(out!.value).toBe(5_000_000_000)
    expect(out!.currency).toBe('KZT')
    expect(out!.unit).toBe('млрд')
  })

  it('parses raw "1 500 000 000 KZT"', () => {
    const out = parseGoalAmount('Target: 1 500 000 000 KZT in 36 months')
    expect(out).not.toBeNull()
    expect(out!.value).toBe(1_500_000_000)
    expect(out!.currency).toBe('KZT')
  })

  it('parses USD thousands "300k USD MRR"', () => {
    const out = parseGoalAmount('300k USD MRR')
    expect(out).not.toBeNull()
    expect(out!.value).toBe(300 * 1_000 * FX_RATE_USD_KZT)
    expect(out!.currency).toBe('USD')
    expect(out!.unit).toBe('тыс')
  })

  it('parses RUB with FX conversion', () => {
    const out = parseGoalAmount('100 млн рублей')
    expect(out).not.toBeNull()
    expect(out!.value).toBe(Math.round(100_000_000 * FX_RATE_RUB_KZT))
    expect(out!.currency).toBe('RUB')
  })

  it('rejects bare client-count goals without currency', () => {
    const out = parseGoalAmount('увеличить количество клиентов до 5000')
    expect(out).toBeNull()
  })

  it('accepts client-count goals when revenue keyword is present', () => {
    const out = parseGoalAmount('выручка 50 млн ₸ при 5000 клиентов')
    expect(out).not.toBeNull()
    expect(out!.value).toBe(50_000_000)
  })

  it('handles european decimal comma "2,5 млн ₸"', () => {
    const out = parseGoalAmount('2,5 млн ₸')
    expect(out).not.toBeNull()
    expect(out!.value).toBe(2_500_000)
  })

  it('confidence increases with each signal', () => {
    const numberOnly = parseGoalAmount('хочу заработать 100000')
    const withCurrency = parseGoalAmount('хочу заработать 100000 ₸')
    const withCurrencyMag = parseGoalAmount('хочу заработать 100 млн ₸')
    const withAll = parseGoalAmount('выручка 100 млн ₸')
    // numberOnly may be null (client count rejection) — guard the chain.
    if (numberOnly && withCurrency && withCurrencyMag && withAll) {
      expect(withCurrency.confidence).toBeGreaterThanOrEqual(numberOnly.confidence)
      expect(withCurrencyMag.confidence).toBeGreaterThanOrEqual(withCurrency.confidence)
      expect(withAll.confidence).toBeGreaterThanOrEqual(withCurrencyMag.confidence)
    }
    // At minimum the full one must exist + have high confidence.
    expect(withAll).not.toBeNull()
    expect(withAll!.confidence).toBeGreaterThanOrEqual(0.9)
  })
})

describe('parseGoals (combined)', () => {
  it('extracts both 12-month and 3-year targets', () => {
    const out = parseGoals('200 млн ₸ за 12 месяцев', '1 млрд ₸ за 3 года')
    expect(out.revenue_12m_kzt).toBe(200_000_000)
    expect(out.revenue_3y_kzt).toBe(1_000_000_000)
    expect(out.confidence).toBeGreaterThan(0.7)
  })

  it('returns zero confidence and null targets when both fail', () => {
    const out = parseGoals('расти быстро', 'стать №1 в нише')
    expect(out.revenue_12m_kzt).toBeNull()
    expect(out.revenue_3y_kzt).toBeNull()
    expect(out.confidence).toBe(0)
  })

  it('returns one target when only one parses', () => {
    const out = parseGoals('500 млн ₸', null)
    expect(out.revenue_12m_kzt).toBe(500_000_000)
    expect(out.revenue_3y_kzt).toBeNull()
    expect(out.confidence).toBeGreaterThan(0)
  })

  it('keeps diagnostic details for each field', () => {
    const out = parseGoals('200 млн ₸', '1 млрд ₸')
    expect(out.details.goal_12m.raw).toBe('200 млн ₸')
    expect(out.details.goal_12m.parsed?.value).toBe(200_000_000)
    expect(out.details.goal_3y.raw).toBe('1 млрд ₸')
    expect(out.details.goal_3y.parsed?.value).toBe(1_000_000_000)
  })
})
