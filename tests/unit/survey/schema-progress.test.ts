import { describe, expect, it } from 'vitest'
import { parseSurveySaveBody, SURVEY_MAX_ANSWERS } from '@/lib/survey/schema'
import { hasAnswerValue, overallFill, stepFillFromAnswers } from '@/lib/survey/progress'

describe('parseSurveySaveBody', () => {
  it('accepts a normal step save', () => {
    const r = parseSurveySaveBody({ step: 3, answers: { s3n_target_client: { value: 'SMB' } }, final: false })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.step).toBe(3)
      expect(r.data.autosave).toBe(false)
      expect(r.data.answers.s3n_target_client).toEqual({ value: 'SMB' })
    }
  })

  it('rejects a bad step', () => {
    expect(parseSurveySaveBody({ step: 0, answers: {} }).ok).toBe(false)
    expect(parseSurveySaveBody({ step: 13, answers: {} }).ok).toBe(false)
    expect(parseSurveySaveBody({ step: '2', answers: {} }).ok).toBe(false)
  })

  it('rejects answers that are not { value } envelopes', () => {
    expect(parseSurveySaveBody({ step: 1, answers: { s1_company_name: 'Acme' } }).ok).toBe(false)
    expect(parseSurveySaveBody({ step: 1, answers: [] }).ok).toBe(false)
  })

  it('rejects malformed keys and oversized payloads', () => {
    expect(parseSurveySaveBody({ step: 1, answers: { 'bad key!': { value: 1 } } }).ok).toBe(false)
    const many: Record<string, { value: number }> = {}
    for (let i = 0; i <= SURVEY_MAX_ANSWERS; i++) many[`s1_k${i}`] = { value: i }
    expect(parseSurveySaveBody({ step: 1, answers: many }).ok).toBe(false)
    expect(parseSurveySaveBody({ step: 1, answers: { s1_x: { value: 'a'.repeat(70_000) } } }).ok).toBe(false)
  })

  it('an autosave can never be the final submit', () => {
    const r = parseSurveySaveBody({ step: 12, answers: {}, autosave: true, final: true })
    expect(r.ok).toBe(false)
  })
})

describe('survey fill', () => {
  it('treats blanks as unanswered', () => {
    expect(hasAnswerValue('')).toBe(false)
    expect(hasAnswerValue('  ')).toBe(false)
    expect(hasAnswerValue([])).toBe(false)
    expect(hasAnswerValue({})).toBe(false)
    expect(hasAnswerValue(null)).toBe(false)
    expect(hasAnswerValue(0)).toBe(true)
    expect(hasAnswerValue('x')).toBe(true)
  })

  it('counts filled fields per owning step', () => {
    const fill = stepFillFromAnswers({ s1_company_name: 'Acme', s1_industry: '', s9n_revenue_2024: 100 })
    expect(fill).toHaveLength(12)
    expect(fill[0].filled).toBe(1)
    expect(fill[0].total).toBeGreaterThan(1)
    expect(fill[0].started).toBe(true)
    expect(fill[8].filled).toBe(1)
    expect(fill[1].started).toBe(false)
  })

  it('overall percent = started steps / 12 and reaches 100', () => {
    expect(overallFill(stepFillFromAnswers({})).percent).toBe(0)
    const one = overallFill(stepFillFromAnswers({ s1_company_name: 'Acme' }))
    expect(one.startedSteps).toBe(1)
    expect(one.percent).toBe(8)
    const all = stepFillFromAnswers({}).map((s) => ({ ...s, filled: 1, started: true }))
    expect(overallFill(all).percent).toBe(100)
    expect(overallFill(all).missingSteps).toEqual([])
  })
})
