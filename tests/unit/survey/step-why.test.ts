import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FIELD_NOTES, STEPS } from '@/components/onboarding/constants/step-config'
import StepHeader from '@/components/onboarding/StepHeader'
import { FieldNote } from '@/components/onboarding/shared/FieldNote'
import { Step9FinanceForm } from '@/components/onboarding/steps/Step9FinanceForm'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { stepFillFromAnswers } from '@/lib/survey/progress'

describe('«Зачем спрашиваем → что получите»', () => {
  it('every step says why it asks and what the owner gets', () => {
    for (const s of STEPS) {
      expect(s.why.ask.length, `step ${s.n}`).toBeGreaterThan(10)
      expect(s.why.get.length, `step ${s.n}`).toBeGreaterThan(10)
    }
  })

  it('the step header shows the hint, the why line and the time', () => {
    const html = renderToStaticMarkup(createElement(StepHeader, { step: 9, config: STEPS[8], fill: stepFillFromAnswers({})[8] }))
    expect(html).toContain('Зачем спрашиваем:')
    expect(html).toContain('что получите:')
    expect(html).toContain(STEPS[8].why.get)
    expect(html).toContain(`~${STEPS[8].minutes} мин`)
  })

  it('delicate-question notes point at real questions and say it can be skipped / approximated', () => {
    for (const [key, text] of Object.entries(FIELD_NOTES)) {
      expect(SURVEY_KEY_STEP[key], key).toBeDefined()
      expect(text).toMatch(/Можно (пропустить|примерно)/)
    }
    expect(renderToStaticMarkup(createElement(FieldNote, { fieldKey: 's9n_transparency_pct' }))).toContain('Можно пропустить')
    expect(renderToStaticMarkup(createElement(FieldNote, { fieldKey: 's1_company_name' }))).toBe('')
  })

  it('step 9 renders the notes under its delicate questions', () => {
    const html = renderToStaticMarkup(createElement(Step9FinanceForm, { data: {}, onChange: () => {} }))
    expect(html).toContain(FIELD_NOTES.s9n_transparency_pct)
    expect(html).toContain(FIELD_NOTES.s9n_tax_audits)
  })
})
