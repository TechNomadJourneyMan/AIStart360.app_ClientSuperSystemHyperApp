import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { STEPS } from '@/components/onboarding/constants/step-config'
import { SURVEY_LABELS, SURVEY_STEP_LABELS } from '@/lib/survey-labels'
import { SURVEY_TERMS } from '@/lib/survey/terms'
import { TermHint } from '@/components/onboarding/shared/TermHint'
import Step3 from '@/components/onboarding/steps/Step3PositioningForm'
import Step7 from '@/components/onboarding/steps/Step7MarketingForm'
import Step10 from '@/components/onboarding/steps/Step10PersonalForm'

const STEPS_DIR = path.resolve(__dirname, '../../../components/onboarding/steps')
const formsSource = readdirSync(STEPS_DIR).filter((f) => f.endsWith('.tsx')).map((f) => readFileSync(path.join(STEPS_DIR, f), 'utf8')).join('\n')
const render = (C: unknown) => renderToStaticMarkup(createElement(C as never, { data: {}, onChange: () => {} }))

describe('plain wording', () => {
  it('step 6 is «Путь клиента», not «CJM», everywhere the step is named', () => {
    expect(STEPS[5].title).toBe('Путь клиента')
    expect(SURVEY_STEP_LABELS[6]).toBe('Путь клиента')
  })

  it('no «Кто виноват»; the key stays', () => {
    expect(formsSource).not.toMatch(/Кто виноват/)
    expect(SURVEY_LABELS.s10_who_to_blame).not.toMatch(/виноват/i)
    expect(render(Step10)).toContain('id="s10_who_to_blame"')
  })

  it('the question comes first in plain words, the term in brackets with an explanation', () => {
    const s3 = render(Step3)
    expect(s3).toContain('Чем вы лучше конкурентов?')
    expect(s3).toContain(`title="${SURVEY_TERMS['УТП']}"`)
    const s7 = render(Step7)
    expect(s7).toContain('Как клиенты оценивают вас по 10-балльной шкале?')
    expect(s7).toContain('>NPS</abbr>')
    expect(s7).toContain('Сколько клиентов записались и не пришли')
    expect(formsSource).not.toMatch(/Recency, Frequency, Monetary/)
  })

  it('the explanation is behind an accessible toggle', () => {
    const html = renderToStaticMarkup(createElement(TermHint, { term: 'NPS' }))
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Что такое NPS"')
    expect(html).toContain('role="note"')
    expect(html).toContain(SURVEY_TERMS.NPS)
  })
})
