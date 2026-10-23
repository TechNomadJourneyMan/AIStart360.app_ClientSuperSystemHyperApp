/**
 * Express screens rendered to static markup (spec §7.1, §14.3–14.4).
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExpressScreen } from '@/components/onboarding/express/ExpressScreen'
import { QuestionField } from '@/components/onboarding/shared/QuestionField'
import { expressPages } from '@/lib/survey/express'
import { SURVEY_QUESTIONS } from '@/lib/survey/questions'
import { unknownAnswer } from '@/lib/survey/answer-value'
import { previewAnswers } from '@/app/dev/survey-preview/fixture'

const noop = () => undefined
const pages = expressPages()
const render = (screen: number, answers: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
  const page = pages.find((p) => p.screen === screen)!
  return renderToStaticMarkup(createElement(ExpressScreen, {
    page, answers, onChange: noop, onNext: noop, onSkip: noop, onFinish: noop, last: page.index === pages.length - 1, ...extra,
  }))
}

describe('ExpressScreen', () => {
  it('«Экран 3 из 15», the heading names the single field, «Зачем»', () => {
    const html = render(3)
    expect(html).toContain('Экран 3 из 15')
    const id = html.match(/<h2 id="([^"]+)"/)![1]
    expect(html).toContain('Сколько человек в команде, включая вас?')
    expect(html).toContain('Зачем: </span>Нужно для выручки на человека')
    // NumberField label is announced (sr-only) — the visible question is the heading.
    expect(html).toContain('class="sr-only">Сколько человек в команде')
    expect(html).toContain(`aria-labelledby="${id}"`)
  })

  it('yes / no without a default: two buttons, none pressed', () => {
    const html = render(10)
    const group = html.slice(html.indexOf('data-question="s5_has_competitor_analysis"'))
    expect(group).toMatch(/aria-pressed="false"[^>]*>Да</)
    expect(group).toMatch(/aria-pressed="false"[^>]*>Нет</)
    expect(group).not.toMatch(/aria-pressed="true"/)
  })

  it('«Не знаю» on numbers and on the breakeven text; «примерно» on money', () => {
    expect(render(12)).toContain('Не знаю')
    const money = render(4)
    expect(money).toContain('Примерно')
    const finance = render(15, { s9n_breakeven_point: unknownAnswer() })
    expect(finance).toMatch(/aria-pressed="true"[^>]*>Не знаю \/ не считаем/)
  })

  it('calculations after screen 5 and «маржа и деньги» after 15; none on screen 6', () => {
    const answers = previewAnswers('filled')
    expect(render(5, answers)).toContain('data-calc="goal_pace"')
    expect(render(15, answers)).toContain('С каждых 100 ₸ выручки остаётся')
    expect(render(6, answers)).not.toContain('data-calc=')
  })

  it('«Готово — показать снимок» from screen 5; main button on the last screen; «Пропустить» elsewhere', () => {
    expect(render(4)).not.toContain('Готово — показать снимок')
    expect(render(5)).toContain('Готово — показать снимок')
    expect(render(5)).toContain('Пропустить')
    const last = render(15)
    expect(last.match(/Готово — показать снимок/g)).toHaveLength(1)
    expect(last).not.toContain('Пропустить')
  })

  it('a phone page of a split screen: «вопрос 2 из 5», one question', () => {
    const phone = expressPages({ oneQuestionPerHardScreen: true }).filter((p) => p.screen === 13)[1]
    const html = renderToStaticMarkup(createElement(ExpressScreen, { page: phone, answers: {}, onChange: noop, onNext: noop, onSkip: noop, onFinish: noop, last: false }))
    expect(html).toContain('вопрос 2 из 5')
    expect(html.match(/data-question=/g)).toHaveLength(1)
  })

  it('the twin offer appears in a block-like screen when the twin is answered', () => {
    const page = { index: 0, screen: 14, title: 'x', questions: [SURVEY_QUESTIONS.s4m_hours_on_ops] }
    const html = renderToStaticMarkup(createElement(ExpressScreen, { page, answers: { s10_hours_on_ops: 6 }, onChange: noop, onNext: noop, onSkip: noop, onFinish: noop, last: false }))
    expect(html).toContain('Вы уже ответили на похожий вопрос')
    expect(html).toContain('6 ч/день')
  })
})

describe('QuestionField', () => {
  it('a table links to the full questionnaire; «где взять» when present', () => {
    const html = renderToStaticMarkup(createElement(QuestionField, { question: SURVEY_QUESTIONS.s8n_metrics_table, value: null, onChange: noop }))
    expect(html).toContain('href="/client/onboarding?step=8#s8n_metrics_table"')
    expect(html).toContain('Заполнить в полной анкете')
    const withHint = Object.values(SURVEY_QUESTIONS).find((q) => q.whereToFind)
    if (withHint) expect(renderToStaticMarkup(createElement(QuestionField, { question: withHint, value: null, onChange: noop }))).toContain('Где взять цифру?')
  })
  it('multi-choice chips with aria-pressed and a named group', () => {
    const html = renderToStaticMarkup(createElement(QuestionField, { question: SURVEY_QUESTIONS.s6_growth_blockers, value: ['Команда / Кадры'], onChange: noop }))
    expect(html).toMatch(/aria-pressed="true"[^>]*>Команда \/ Кадры/)
    expect(html).toMatch(/role="group" aria-labelledby=/)
  })
})
