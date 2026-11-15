/**
 * R3-PA (B3): the hypothesis answer of the light tier (Qwen) is brought to the
 * schema before it is judged — a score as a string / a fraction and a long
 * rationale failed the schema (and the retry went a tier up for a formatting
 * slip). The schema stays the judge.
 */
import { describe, expect, it } from 'vitest'
import { HypothesisSchema, normalizeHypothesisCandidate } from '@/lib/point-a/v4/hypotheses'

describe('normalizeHypothesisCandidate', () => {
  it('«45.6» / 45.6 / «  45 » → 46 / 46 / 45; out of range clamped', () => {
    expect(normalizeHypothesisCandidate({ score: '45.6', rationale: 'достаточно длинное обоснование' })).toMatchObject({ score: 46 })
    expect(normalizeHypothesisCandidate({ score: 45.6, rationale: 'x' })).toMatchObject({ score: 46 })
    expect(normalizeHypothesisCandidate({ score: ' 45 ', rationale: 'x' })).toMatchObject({ score: 45 })
    expect(normalizeHypothesisCandidate({ score: 140, rationale: 'x' })).toMatchObject({ score: 100 })
    expect(normalizeHypothesisCandidate({ score: -3, rationale: 'x' })).toMatchObject({ score: 0 })
  })

  it('a rationale over 600 characters is cut at a sentence (or word) boundary and passes the schema', () => {
    const long = `${'Выручка растёт, но маржа не известна. '.repeat(30)}Конец`
    const n = normalizeHypothesisCandidate({ score: 50, rationale: long }) as { rationale: string }
    expect(n.rationale.length).toBeLessThanOrEqual(600)
    expect(n.rationale.endsWith('.')).toBe(true)
    expect(HypothesisSchema.safeParse(n).success).toBe(true)
    const words = normalizeHypothesisCandidate({ score: 50, rationale: 'слово '.repeat(200) }) as { rationale: string }
    expect(words.rationale.length).toBeLessThanOrEqual(600)
    expect(HypothesisSchema.safeParse(words).success).toBe(true)
  })

  it('what cannot be fixed is left for the schema to refuse', () => {
    expect(HypothesisSchema.safeParse(normalizeHypothesisCandidate({ score: 'много', rationale: 'достаточно длинное' })).success).toBe(false)
    expect(normalizeHypothesisCandidate(null)).toBeNull()
    expect(normalizeHypothesisCandidate(['x'])).toEqual(['x'])
  })
})
