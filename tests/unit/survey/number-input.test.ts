import { describe, expect, it } from 'vitest'
import { approxAnswer, unknownAnswer } from '@/lib/survey/answer-value'
import {
  approxDraftFromValue, autoYearUpdate, commitApproxDraft, formatNumberDraft, numberDraftFromValue, parseNumberDraft,
} from '@/lib/survey/number-input'

describe('formatNumberDraft — thousands separators while typing', () => {
  it('groups digits and keeps the caret after the same digit', () => {
    expect(formatNumberDraft('1500000', 7, { integer: true })).toEqual({ text: '1 500 000', caret: 9 })
    // caret after «15» in «1500000» → after «1 5» in «1 500 000»
    expect(formatNumberDraft('1500000', 2, { integer: true })).toEqual({ text: '1 500 000', caret: 3 })
    // typing a digit into an already grouped text
    expect(formatNumberDraft('1 5000', 6, { integer: true })).toEqual({ text: '15 000', caret: 6 })
  })

  it('integer fields drop separators (no 1.5 from «1.500»)', () => {
    expect(formatNumberDraft('1.500.000', 9, { integer: true }).text).toBe('1 500 000')
    expect(formatNumberDraft('1,500', 5, { integer: true }).text).toBe('1 500')
  })

  it('decimal fields keep one decimal comma; several separators are thousands', () => {
    expect(formatNumberDraft('12.5', 4, {}).text).toBe('12,5')
    expect(formatNumberDraft('12,', 3, {}).text).toBe('12,')
    expect(formatNumberDraft('1234,567', 8, {}).text).toBe('1 234,56')
    expect(formatNumberDraft('1,500,000', 9, {}).text).toBe('1 500 000')
  })

  it('strips letters, keeps a leading minus only when allowed', () => {
    expect(formatNumberDraft('12a3', 4, { integer: true }).text).toBe('123')
    expect(formatNumberDraft('-50', 3, { integer: true }).text).toBe('50')
    expect(formatNumberDraft('-50', 3, { integer: true, allowNegative: true }).text).toBe('-50')
    expect(formatNumberDraft('', 0, {})).toEqual({ text: '', caret: 0 })
  })
})

describe('parseNumberDraft — empty stays empty', () => {
  it('reads the formatted text', () => {
    expect(parseNumberDraft('1 500 000')).toBe(1_500_000)
    expect(parseNumberDraft('12,5')).toBe(12.5)
    expect(parseNumberDraft('12,')).toBe(12)
    expect(parseNumberDraft('-7')).toBe(-7)
  })

  it('never turns a cleared field into 0', () => {
    expect(parseNumberDraft('')).toBeNull()
    expect(parseNumberDraft('   ')).toBeNull()
    expect(parseNumberDraft('-')).toBeNull()
    expect(parseNumberDraft(',')).toBeNull()
    expect(parseNumberDraft('0')).toBe(0) // an explicit zero is an answer
  })
})

describe('numberDraftFromValue — what the input shows for a stored value', () => {
  it('numbers are grouped, blanks are empty', () => {
    expect(numberDraftFromValue(5_500_000)).toBe('5 500 000')
    expect(numberDraftFromValue(12.5)).toBe('12,5')
    expect(numberDraftFromValue(0)).toBe('0')
    expect(numberDraftFromValue(null)).toBe('')
    expect(numberDraftFromValue(undefined)).toBe('')
  })

  it('a legacy text answer is shown as typed («около 60 %», «150 000»)', () => {
    expect(numberDraftFromValue('около 60 %')).toBe('около 60 %')
  })

  it('marks: «не знаю» is an empty field, «примерно» shows the midpoint', () => {
    expect(numberDraftFromValue(unknownAnswer())).toBe('')
    expect(numberDraftFromValue(approxAnswer(5_000_000, 6_000_000))).toBe('5 500 000')
  })
})

describe('«примерно» drafts', () => {
  it('shows a stored range as text and parses it back', () => {
    expect(approxDraftFromValue(approxAnswer(5_000_000, 6_000_000))).toBe('5 000 000 – 6 000 000')
    expect(approxDraftFromValue(approxAnswer(7, 7))).toBe('7')
    expect(approxDraftFromValue(1_000_000)).toBe('1 000 000')
    expect(approxDraftFromValue(null)).toBe('')
    expect(commitApproxDraft('5–6 млн')).toEqual(approxAnswer(5_000_000, 6_000_000))
    expect(commitApproxDraft('около 300 тыс')).toEqual(approxAnswer(300_000, 300_000))
    expect(commitApproxDraft('')).toBeNull()
    expect(commitApproxDraft('много')).toBeNull()
  })
})

describe('autoYearUpdate — «год = месяц × 12» without silent zeros', () => {
  it('month → month × 12; a consistent year is kept', () => {
    expect(autoYearUpdate(500_000, null, true)).toBe(6_000_000)
    expect(autoYearUpdate(500_000, 6_000_000, true)).toBeUndefined()
    expect(autoYearUpdate(283_333_333, 3_400_000_000, false)).toBeUndefined() // a goal set elsewhere
    expect(autoYearUpdate(approxAnswer(5_000_000, 6_000_000), null, true)).toBe(66_000_000)
  })

  it('a cleared or «не знаю» month clears the year (never 0)', () => {
    expect(autoYearUpdate(null, 6_000_000, true)).toBeNull()
    expect(autoYearUpdate(unknownAnswer(), 6_000_000, true)).toBeNull()
    expect(autoYearUpdate(null, null, true)).toBeUndefined()
  })

  it('no month on first render leaves a year that came from elsewhere', () => {
    expect(autoYearUpdate(undefined, 66_000_000, false)).toBeUndefined()
    expect(autoYearUpdate(0, 66_000_000, false)).toBeUndefined()
  })
})
