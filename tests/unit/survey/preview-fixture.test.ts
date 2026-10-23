/**
 * The dev preview /dev/survey-preview keeps rendering every step and every
 * variant (incl. «unknown»: «Не знаю» / «примерно»), and the review screen
 * lists the blind spots. renderToStaticMarkup only: no DOM, no network.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TOTAL_STEPS } from '@/components/onboarding/constants/step-config'
import { isUnknownAnswer, isApproxAnswer } from '@/lib/survey/answer-value'
import { blindSpots } from '@/lib/survey/blind-spots'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams() }))

const { default: SurveyPreviewClient } = await import('@/app/dev/survey-preview/SurveyPreviewClient')
const { previewAnswers, SURVEY_PREVIEW_VARIANTS } = await import('@/app/dev/survey-preview/fixture')

describe('survey preview', () => {
  it('has the «unknown» variant with marks', () => {
    expect(SURVEY_PREVIEW_VARIANTS).toContain('unknown')
    const a = previewAnswers('unknown')
    expect(Object.values(a).some(isUnknownAnswer)).toBe(true)
    expect(Object.values(a).some(isApproxAnswer)).toBe(true)
    expect(blindSpots(a).length).toBeGreaterThan(3)
  })

  it('renders every step of every variant, and the review screen', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const variant of SURVEY_PREVIEW_VARIANTS) {
      for (let step = 1; step <= TOTAL_STEPS + 1; step++) {
        const html = renderToStaticMarkup(createElement(SurveyPreviewClient, { variant, step }))
        expect(html, `${variant} / ${step}`).toContain('Минимум для Точки А')
      }
    }
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('«unknown»: the inputs say «Не знаю», the review lists the blind spots', () => {
    const s9 = renderToStaticMarkup(createElement(SurveyPreviewClient, { variant: 'unknown', step: 9 }))
    expect(s9).toContain('placeholder="Не знаю"')
    expect(s9).toContain('aria-pressed="true"')
    const review = renderToStaticMarkup(createElement(SurveyPreviewClient, { variant: 'unknown', step: TOTAL_STEPS + 1 }))
    expect(review).toContain('Слепые зоны')
    expect(review).toContain('Минимум для Точки А:')
  })
})

describe('survey preview — Ф1 views', () => {
  it('?view=answers renders every variant for the client and the staff', async () => {
    const { AnswersPreview } = await import('@/app/dev/survey-preview/PreviewViews')
    for (const variant of SURVEY_PREVIEW_VARIANTS) {
      const client = renderToStaticMarkup(createElement(AnswersPreview, { variant, staff: false }))
      expect(client, variant).toContain('Мои ответы')
      expect(client).toContain('Кто заполнял')
      const staff = renderToStaticMarkup(createElement(AnswersPreview, { variant, staff: true }))
      expect(staff, variant).toContain('Анкета клиента (вид эксперта)')
    }
    const authors = renderToStaticMarkup(createElement(AnswersPreview, { variant: 'authors', staff: true }))
    expect(authors).toMatch(/Заполнил пользователь Айгуль Сапарова|Изменил эксперт/)
  })

  it('?view=chooser shows the three cards', async () => {
    const { ChooserPreview } = await import('@/app/dev/survey-preview/PreviewViews')
    const html = renderToStaticMarkup(createElement(ChooserPreview))
    expect(html).toContain('Расширенная полная анкета')
    expect(html).toContain('Рекомендуем')
    expect(html).toContain('Скоро')
  })
})
