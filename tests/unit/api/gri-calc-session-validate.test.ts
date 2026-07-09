import { describe, it, expect } from 'vitest'
import { validateCalcSession } from '@/lib/gri-calculator/calc-session-validate'
import { DEFAULT_SCORES } from '@/lib/gri-calculator/gri-data'

const validScores = Object.fromEntries(Object.keys(DEFAULT_SCORES).map((k) => [k, 7]))

describe('validateCalcSession', () => {
  it('accepts a valid body and computes gri_index as the rounded mean', () => {
    const r = validateCalcSession({ name: 'Тест', scores: validScores })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.gri_index).toBe(7)
  })

  it('rejects missing categories', () => {
    const bad = { ...validScores }
    delete (bad as Record<string, number>)[Object.keys(validScores)[0]]
    expect(validateCalcSession({ scores: bad }).ok).toBe(false)
  })

  it('rejects out-of-range and non-numeric values', () => {
    expect(validateCalcSession({ scores: { ...validScores, [Object.keys(validScores)[0]]: 11 } }).ok).toBe(false)
    expect(validateCalcSession({ scores: { ...validScores, [Object.keys(validScores)[0]]: 'x' } }).ok).toBe(false)
  })

  it('trims and caps name at 80 chars, note at 500', () => {
    const r = validateCalcSession({ name: ' a '.padEnd(200, 'b'), scores: validScores, note: 'n'.repeat(600) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name.length).toBeLessThanOrEqual(80)
      expect((r.value.note ?? '').length).toBeLessThanOrEqual(500)
    }
  })
})
