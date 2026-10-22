import { describe, expect, it } from 'vitest'
import { blindSpots } from '@/lib/survey/blind-spots'
import {
  answerNumber, approxAnswer, formatMarkedAnswer, fromAnswerEnvelope, isApproxAnswer, isMarkedAnswer,
  isUnknownAnswer, parseApproxRange, parseLooseNumber, toAnswerEnvelope, unknownAnswer, unwrapAnswer,
} from '@/lib/survey/answer-value'
import { parseSurveySaveBody } from '@/lib/survey/schema'

describe('marks: «не знаю» and «примерно»', () => {
  it('builds the documented shapes', () => {
    expect(unknownAnswer()).toEqual({ value: null, unknown: true })
    expect(approxAnswer(5_000_000, 6_000_000)).toEqual({ value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] })
    expect(approxAnswer(6, 5)).toEqual({ value: 6, approx: true, range: [5, 6] }) // swapped bounds; round(5.5) = 6
    expect(approxAnswer(7, 7)).toEqual({ value: 7, approx: true, range: [7, 7] })
  })

  it('recognises marks and nothing else', () => {
    expect(isUnknownAnswer({ value: null, unknown: true })).toBe(true)
    expect(isUnknownAnswer({ value: 5, unknown: true })).toBe(false)
    expect(isUnknownAnswer({ unknown: true })).toBe(false)
    expect(isApproxAnswer({ value: 5, approx: true, range: [4, 6] })).toBe(true)
    expect(isApproxAnswer({ value: 5, approx: true })).toBe(false)
    expect(isApproxAnswer({ value: 5, approx: true, range: [6, 4] })).toBe(false)
    expect(isMarkedAnswer({ value: 5 })).toBe(false)
    expect(isMarkedAnswer(5)).toBe(false)
    expect(isMarkedAnswer(null)).toBe(false)
    expect(isMarkedAnswer([{ value: null, unknown: true }])).toBe(false)
  })

  it('round-trips through the stored envelope', () => {
    expect(toAnswerEnvelope(5)).toEqual({ value: 5 })
    expect(toAnswerEnvelope(null)).toEqual({ value: null })
    expect(toAnswerEnvelope(unknownAnswer())).toEqual({ value: null, unknown: true })
    const ap = approxAnswer(1, 3)
    expect(toAnswerEnvelope(ap)).toEqual(ap)
    expect(fromAnswerEnvelope({ value: 'x' })).toBe('x')
    expect(fromAnswerEnvelope({ value: null, unknown: true })).toEqual(unknownAnswer())
    expect(fromAnswerEnvelope(ap)).toEqual(ap)
    expect(fromAnswerEnvelope('legacy raw')).toBe('legacy raw')
    expect(fromAnswerEnvelope(null)).toBeUndefined()
  })

  it('unwraps to the value readers compute with: unknown → null (never 0), approx → midpoint', () => {
    expect(unwrapAnswer({ value: null, unknown: true })).toBeNull()
    expect(unwrapAnswer(approxAnswer(4, 6))).toBe(5)
    expect(unwrapAnswer({ value: 7 })).toBe(7)
    expect(unwrapAnswer(7)).toBe(7)
    expect(unwrapAnswer(unknownAnswer())).toBeNull()
    expect(answerNumber(unknownAnswer())).toBeNull()
    expect(answerNumber(approxAnswer(4, 6))).toBe(5)
    expect(answerNumber('1 500 000')).toBe(1_500_000)
    expect(answerNumber('')).toBeNull()
    expect(answerNumber(null)).toBeNull()
    expect(answerNumber(0)).toBe(0)
  })
})

describe('parseLooseNumber', () => {
  it('reads spaces, NBSP, comma decimals and Russian multipliers', () => {
    expect(parseLooseNumber('1 500 000')).toBe(1_500_000)
    expect(parseLooseNumber('1 500 000 ₸')).toBe(1_500_000)
    expect(parseLooseNumber('12,5')).toBe(12.5)
    expect(parseLooseNumber('5 млн')).toBe(5_000_000)
    expect(parseLooseNumber('5,5 млн')).toBe(5_500_000)
    expect(parseLooseNumber('300 тыс')).toBe(300_000)
    expect(parseLooseNumber('300к')).toBe(300_000)
    expect(parseLooseNumber('1,2 млрд')).toBe(1_200_000_000)
    expect(parseLooseNumber('-15')).toBe(-15)
  })

  it('returns null for blanks and words', () => {
    expect(parseLooseNumber('')).toBeNull()
    expect(parseLooseNumber('   ')).toBeNull()
    expect(parseLooseNumber('не знаю')).toBeNull()
    expect(parseLooseNumber('-')).toBeNull()
  })
})

describe('parseApproxRange', () => {
  it('reads the ways people write a range', () => {
    expect(parseApproxRange('5–6 млн')).toEqual({ min: 5_000_000, max: 6_000_000, mid: 5_500_000 })
    expect(parseApproxRange('5-6 млн')).toEqual({ min: 5_000_000, max: 6_000_000, mid: 5_500_000 })
    expect(parseApproxRange('от 5 до 6 млн')).toEqual({ min: 5_000_000, max: 6_000_000, mid: 5_500_000 })
    expect(parseApproxRange('500 тыс – 1 млн')).toEqual({ min: 500_000, max: 1_000_000, mid: 750_000 })
    expect(parseApproxRange('5 000 000 — 6 000 000')).toEqual({ min: 5_000_000, max: 6_000_000, mid: 5_500_000 })
    expect(parseApproxRange('6–5 млн')).toEqual({ min: 5_000_000, max: 6_000_000, mid: 5_500_000 })
  })

  it('a single amount is a point range', () => {
    expect(parseApproxRange('около 5 млн')).toEqual({ min: 5_000_000, max: 5_000_000, mid: 5_000_000 })
    expect(parseApproxRange('~300 тыс')).toEqual({ min: 300_000, max: 300_000, mid: 300_000 })
  })

  it('rejects garbage and negative ranges', () => {
    expect(parseApproxRange('')).toBeNull()
    expect(parseApproxRange('много')).toBeNull()
    expect(parseApproxRange('-5 – 6')).toBeNull()
  })
})

describe('formatMarkedAnswer', () => {
  it('shows «Не знаю» and the approximate value with its range', () => {
    expect(formatMarkedAnswer(unknownAnswer())).toBe('Не знаю')
    expect(formatMarkedAnswer(approxAnswer(5_000_000, 6_000_000), '₸')).toBe('≈ 5 500 000 ₸ (5 000 000 – 6 000 000 ₸)')
    expect(formatMarkedAnswer(approxAnswer(7, 7), '₸')).toBe('≈ 7 ₸')
    expect(formatMarkedAnswer({ value: 5 })).toBeNull()
  })
})

describe('blindSpots', () => {
  it('lists the questions answered «не знаю», in wizard order', () => {
    const spots = blindSpots({
      s9n_net_margin: unknownAnswer(),
      s1_employee_count: 5,
      s7_nps_score: unknownAnswer(),
      s5n_funnel_lead_to_sale: approxAnswer(5, 10),
      x_not_in_wizard: unknownAnswer(),
    })
    expect(spots.map((s) => s.key)).toEqual(['s7_nps_score', 's9n_net_margin'])
    expect(spots[0]).toMatchObject({ step: 7 })
    expect(spots[0].label.length).toBeGreaterThan(0)
  })

  it('is empty when nothing is unknown', () => {
    expect(blindSpots({})).toEqual([])
  })
})

describe('save body accepts the marks', () => {
  it('accepts «не знаю» and a consistent «примерно»', () => {
    const r = parseSurveySaveBody({
      step: 9,
      answers: {
        s9n_net_margin: { value: null, unknown: true },
        s9n_revenue_2024: { value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] },
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.answers.s9n_net_margin).toEqual({ value: null, unknown: true })
  })

  it('rejects inconsistent marks', () => {
    const bad = (answer: unknown) => parseSurveySaveBody({ step: 9, answers: { s9n_net_margin: answer } }).ok
    expect(bad({ value: 5, unknown: true })).toBe(false) // «не знаю» with a value
    expect(bad({ value: null, unknown: false })).toBe(false)
    expect(bad({ value: 5, approx: true })).toBe(false) // no range
    expect(bad({ value: 9, approx: true, range: [1, 3] })).toBe(false) // value outside the range
    expect(bad({ value: 2, approx: true, range: [3, 1] })).toBe(false) // min > max
    expect(bad({ value: 2, approx: true, range: [1, 3], extra: 1 })).toBe(false)
  })
})
