/**
 * Survey chat number guard (spec §8.6): a number reaches a card only when the
 * client wrote it; scale and period come from the client's words.
 */
import { describe, expect, it } from 'vitest'
import { adjacentScale, canonicalLiteral, clientNumbers, groundNumber, replyAllowedNumbers, replyForeignNumbers, textPeriod, tokenize } from '@/lib/survey/chat/guard'
import { SURVEY_QUESTIONS } from '@/lib/survey/questions'

const revenue = SURVEY_QUESTIONS.s1_current_revenue_month
const employees = SURVEY_QUESTIONS.s1_employee_count

describe('numbers in the client words', () => {
  it('digits and Russian numerals', () => {
    expect([...clientNumbers(['где-то пять-шесть миллионов в месяц'])]).toEqual(expect.arrayContaining(['5', '6']))
    expect(clientNumbers(['двадцать пять человек']).has('25')).toBe(true)
    expect(clientNumbers(['сто двадцать']).has('120')).toBe(true)
    expect(clientNumbers(['полтора миллиона']).has('1.5')).toBe(true)
    expect(clientNumbers(['1 500 000 тенге']).has('1500000')).toBe(true)
    expect(clientNumbers(['5,5 млн']).has('5.5')).toBe(true)
    expect(clientNumbers(['около миллиона']).has('1')).toBe(true)
  })

  it('«к» as a preposition is not a thousand', () => {
    expect(clientNumbers(['к нам приходят по рекомендации']).has('1')).toBe(false)
    expect(tokenize('300к').some((t) => t.t === 'scale')).toBe(true)
  })

  it('canonical literal of the model', () => {
    expect(canonicalLiteral('5,5')).toBe('5.5')
    expect(canonicalLiteral('пять')).toBe('5')
    expect(canonicalLiteral('1 500 000')).toBe('1500000')
    expect(canonicalLiteral('много')).toBeNull()
  })

  it('scale right after the number or after a range', () => {
    expect(adjacentScale(['5-6 млн в месяц'], '5')).toBe('млн')
    expect(adjacentScale(['от 5 до 6 млн'], '5')).toBe('млн')
    expect(adjacentScale(['300 тыс'], '300')).toBe('тыс')
    expect(adjacentScale(['12 человек'], '12')).toBeNull()
  })

  it('period words', () => {
    expect(textPeriod(['66 млн в год'])).toBe('year')
    expect(textPeriod(['5 млн в месяц'])).toBe('month')
    expect(textPeriod(['5 млн'])).toBeNull()
  })
})

describe('groundNumber', () => {
  it('accepts a number the client wrote, scale from the text', () => {
    expect(groundNumber({ raw: '5,5', scale: 'млн', period: 'month' }, revenue, ['5,5 млн в месяц'])).toEqual({ ok: true, number: { value: 5_500_000 } })
    // the model forgot the scale: the client's word wins
    expect(groundNumber({ raw: '300', scale: null, period: null }, revenue, ['примерно 300 тыс'])).toEqual({ ok: true, number: { value: 300_000 } })
  })

  it('refuses a number the client never wrote', () => {
    expect(groundNumber({ raw: '7', scale: 'млн', period: null }, revenue, ['5 млн в месяц'])).toEqual({ ok: false, reason: 'not_in_text' })
    expect(groundNumber({ raw: '5000000', scale: null, period: null }, revenue, ['пять миллионов'])).toEqual({ ok: false, reason: 'not_in_text' })
  })

  it('refuses a scale the client never wrote', () => {
    expect(groundNumber({ raw: '5', scale: 'млн', period: null }, revenue, ['5 в месяц'])).toEqual({ ok: false, reason: 'scale_not_in_text' })
    expect(groundNumber({ raw: '5', scale: 'млн', period: null }, revenue, ['5 тыс в месяц'])).toEqual({ ok: false, reason: 'scale_not_in_text' })
  })

  it('year → month only with the client word and a note', () => {
    expect(groundNumber({ raw: '66', scale: 'млн', period: 'year' }, revenue, ['66 млн в год'])).toEqual({ ok: true, number: { value: 5_500_000, note: 'пересчитал: 66 млн в год ÷ 12' } })
    expect(groundNumber({ raw: '66', scale: 'млн', period: 'year' }, revenue, ['66 млн'])).toEqual({ ok: false, reason: 'period_mismatch' })
    // the model said month, the client said year: the client wins
    expect(groundNumber({ raw: '66', scale: 'млн', period: 'month' }, revenue, ['66 млн за год']).ok).toBe(true)
  })

  it('a plain count', () => {
    expect(groundNumber({ raw: 'двенадцать', scale: null, period: null }, employees, ['нас двенадцать'])).toEqual({ ok: true, number: { value: 12 } })
  })
})

describe('replies', () => {
  it('a number from nowhere in a model reply is foreign', () => {
    const allowed = replyAllowedNumbers(revenue, ['где-то 5 млн'])
    expect(replyForeignNumbers('Обычно выручка 37 млн', allowed)).toEqual(['37'])
    expect(replyForeignNumbers('Вы сказали 5 млн', allowed)).toEqual([])
  })
})
