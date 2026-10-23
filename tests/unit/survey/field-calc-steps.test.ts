/**
 * Field calculations inside the step forms and the dev preview (survey Ф3).
 * renderToStaticMarkup only: no DOM, no network, no database.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams() }))

const { default: Step1 } = await import('@/components/onboarding/steps/Step1CompanyForm')
const { default: Step4 } = await import('@/components/onboarding/steps/Step4OrgStructureForm')
const { default: Step5 } = await import('@/components/onboarding/steps/Step5ClientBaseForm')
const { default: Step7 } = await import('@/components/onboarding/steps/Step7MarketingForm')
const { default: Step8 } = await import('@/components/onboarding/steps/Step8MetricsForm')
const { Step9FinanceForm: Step9 } = await import('@/components/onboarding/steps/Step9FinanceForm')
const { default: Step10 } = await import('@/components/onboarding/steps/Step10PersonalForm')
const { default: SurveyPreviewClient } = await import('@/app/dev/survey-preview/SurveyPreviewClient')
const { previewAnswers } = await import('@/app/dev/survey-preview/fixture')

type Form = ComponentType<{ data: Record<string, unknown>; onChange: (k: string, v: unknown) => void }>
const FORMS: Array<[number, Form, string[]]> = [
  [1, Step1 as Form, ['goal_pace', 'revenue_per_employee']],
  [4, Step4 as Form, ['staff_count', 'owner_hours']],
  [5, Step5 as Form, ['refusals_share', 'funnel']],
  [7, Step7 as Form, ['marketing_money', 'funnel', 'leads_to_goal', 'repeat_rate']],
  [8, Step8 as Form, ['revenue_years', 'check_x_sales']],
  [9, Step9 as Form, ['revenue_years', 'margin_check', 'expense_structure', 'marketing_money', 'receivables']],
  [10, Step10 as Form, ['owner_hours']],
]

const calcsIn = (html: string, state = 'ready') =>
  [...html.matchAll(new RegExp(`data-calc="([a-z_]+)" data-calc-state="${state}"`, 'g'))].map((m) => m[1])

const renderForm = (F: Form, data: Record<string, unknown>) => renderToStaticMarkup(createElement(F, { data, onChange: () => {} }))

describe('step forms show the calculations under their fields', () => {
  it.each(FORMS)('step %i on the «filled» answers', (_n, F, ids) => {
    const html = renderForm(F, previewAnswers('filled'))
    expect(calcsIn(html)).toEqual(ids)
    expect(html).toContain('Приблизительный расчёт по вашим цифрам')
  })

  it.each(FORMS)('step %i with no answers shows none', (_n, F) => {
    expect(renderForm(F, {})).not.toContain('data-calc=')
  })
})

describe('dev preview /dev/survey-preview renders the calculations', () => {
  const step = (variant: 'filled' | 'half' | 'unknown', n: number) =>
    renderToStaticMarkup(createElement(SurveyPreviewClient, { variant, step: n }))

  it('«filled»: every step with numbers has its calculations', () => {
    for (const [n, , ids] of FORMS) expect(calcsIn(step('filled', n)), `step ${n}`).toEqual(ids)
  })

  it('«half»: the first sitting already gets the goal pace and marketing money', () => {
    expect(calcsIn(step('half', 1))).toEqual(['goal_pace', 'revenue_per_employee'])
    expect(calcsIn(step('half', 7))).toContain('marketing_money')
    expect(calcsIn(step('half', 5), 'hidden')).toContain('refusals_share')
  })

  it('«unknown»: «примерно» → ≈ and a range, «не знаю» → hidden with what to fill in', () => {
    const s1 = step('unknown', 1)
    expect(s1).toMatch(/≈ ×1,6 \(диапазон ×1,5 – ×1,8\)/)
    const s9 = step('unknown', 9)
    expect(calcsIn(s9, 'hidden')).toEqual(expect.arrayContaining(['margin_check', 'receivables']))
    expect(s9).toContain('Чтобы увидеть расчёт «Деньги у клиентов», укажите: срок оплаты (дебиторка).')
    expect(s9).toMatch(/диапазон/)
  })
})
