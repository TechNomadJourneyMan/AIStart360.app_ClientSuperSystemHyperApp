/**
 * W5 follow-up: the answer editor stores Markdown in survey_answers.answer.value. Every plain-text reader shows
 * the words without the markup — formatSurveyValue (Google Sheets, PDF, the shared report, «Мои данные», GIGA
 * view, the dashboard summary), the summary of the Telegram «анкета заполнена», the AI context of the expert
 * review; the raw value stays untouched for the editor.
 */
import { describe, expect, it } from 'vitest'
import { buildReviewContext } from '@/lib/expert-review/ai-draft'
import { formatSurveyValue } from '@/lib/survey-labels'
import { answersFromRows, buildSurveySheetHeaders, buildSurveySheetRow, buildSurveySummary } from '@/lib/survey/export'
import { plainAnswer, plainAnswers } from '@/lib/survey/plain'

const MD = '**Цель** — рост _выручки_:\n- новые [клиенты](https://example.com)\n- повторные продажи'
const PLAIN = 'Цель — рост выручки:\n\n• новые клиенты\n• повторные продажи'

const rows = [
  { question_key: 's1_company_name', step: 1, answer: { value: '**Ромашка**' } },
  { question_key: 's2n_goal_12m_what', step: 2, answer: { value: MD } },
  { question_key: 's3n_client_portrait', step: 3, answer: { value: MD } },
  { question_key: 's1_current_revenue_year', step: 1, answer: { value: 60_000_000 } },
]

describe('plainAnswer', () => {
  it('strips strings and string lists, leaves numbers, booleans and table rows as they are', () => {
    expect(plainAnswer(MD)).toBe(PLAIN)
    expect(plainAnswer(['**a**', '_b_'])).toEqual(['a', 'b'])
    expect(plainAnswer(42)).toBe(42)
    expect(plainAnswer(true)).toBe(true)
    const table = [{ name: '**x**' }]
    expect(plainAnswer(table)).toBe(table)
    expect(plainAnswers({ a: '**a**', n: 1 })).toEqual({ a: 'a', n: 1 })
    // plain text and snake_case enum values are not touched
    expect(plainAnswer('Обычный текст, 5-10 человек')).toBe('Обычный текст, 5-10 человек')
    expect(plainAnswer('higher_is_better')).toBe('higher_is_better')
  })
})

describe('formatSurveyValue (PDF, shared report, «Мои данные», GIGA view, Google Sheets cells)', () => {
  it('free text loses the markup, numbers and enums are formatted as before', () => {
    expect(formatSurveyValue('s3n_client_portrait', MD)).toBe(PLAIN)
    expect(formatSurveyValue('s3n_client_portrait', { value: MD })).toBe(PLAIN)
    expect(formatSurveyValue('s1_current_revenue_year', 60_000_000)).toMatch(/^60\s000\s000 ₸$/)
    expect(formatSurveyValue('s2_debt_load', 'moderate')).toBe('Умеренная')
    expect(formatSurveyValue('s3n_client_portrait', 'просто текст')).toBe('просто текст')
  })
})

describe('Google Sheets row and the Telegram completion summary', () => {
  it('the sheet row carries plain text in the answer cells and in the identity columns', () => {
    const headers = buildSurveySheetHeaders()
    const row = buildSurveySheetRow(rows, { userId: 'u-1', email: 'a@b.kz', updatedAt: new Date('2026-10-22T10:00:00Z') })
    expect(row).toHaveLength(headers.length)
    expect(row[3]).toBe('Ромашка') // «Компания»
    expect(row.filter((c) => c === PLAIN)).toHaveLength(2) // s2n_goal_12m_what, s3n_client_portrait
    expect(row.some((c) => /\*\*|\]\(/.test(c))).toBe(false)
  })

  it('the summary of the admin Telegram notice is plain', () => {
    const s = buildSurveySummary(rows)
    expect(s.company).toBe('Ромашка')
    expect(s.goal12m).toBe(PLAIN) // s1_goal_12m_revenue_year is not set → the text goal
    expect(s.revenue).toBe('60000000')
  })

  it('the raw answers stay raw (the editor reads them)', () => {
    expect(answersFromRows(rows).s2n_goal_12m_what).toBe(MD)
  })
})

describe('AI context of the expert review', () => {
  it('quotes the answers without the markup', () => {
    const ctx = buildReviewContext({ surveyRows: rows, diagnostic: null, gri: null, pointB: null, expertPointB: null })
    expect(ctx.text).toContain('Ромашка')
    expect(ctx.text).not.toContain('**')
    expect(ctx.text).not.toContain('](https://')
    expect(ctx.text).toContain('Цель — рост выручки')
  })
})
