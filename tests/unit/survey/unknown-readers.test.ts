/**
 * «Не знаю / не считаем» ({ value: null, unknown: true }) and «примерно»
 * ({ value: mid, approx: true, range }) through every kind of reader:
 * unknown is «нет данных» (never 0), approx is the midpoint, and the readers
 * that show answers to a person say «Не знаю» / «≈ …».
 */
import { describe, expect, it } from 'vitest'
import { approxAnswer, unknownAnswer, unwrapAnswer } from '@/lib/survey/answer-value'
import { hasAnswerValue, stepFillFromAnswers } from '@/lib/survey/progress'
import { completedStepsFromRows, surveyProgressFromRows } from '@/lib/survey/steps'
import { present } from '@/lib/point-a-engine'
import { answeredSteps } from '@/lib/point-a/v4/check-inputs'
import { resolveSurveySource } from '@/lib/metrics/source-adapters'
import type { ResolverContext } from '@/lib/metrics/types'
import type { MetricSource } from '@/lib/metrics/format'
import { finmodelFromSurvey } from '@/lib/point-b/finmodel/sources'
import { goalsFromAnswers } from '@/lib/goals/survey-sync'
import { computeRealityCheck } from '@/lib/gri/reality-check'
import { formatSurveyValue } from '@/lib/survey-labels'
import { buildSurveySheetHeaders, buildSurveySheetRow } from '@/lib/survey/export'
import { buildUserProfileSummary } from '@/lib/user-dashboard/summary'

const UNKNOWN = unknownAnswer()

describe('progress: «не знаю» is an answer', () => {
  it('counts in the wizard fill and in the server progress', () => {
    expect(hasAnswerValue(UNKNOWN)).toBe(true)
    expect(hasAnswerValue(approxAnswer(1, 3))).toBe(true)
    expect(stepFillFromAnswers({ s9n_net_margin: UNKNOWN })[8].started).toBe(true)
    const rows = [{ question_key: 's9n_net_margin', step: 9, answer: { value: null, unknown: true } }]
    expect(completedStepsFromRows(rows)).toEqual([9])
    expect(surveyProgressFromRows(rows).completed).toBe(1)
  })

  it('a plain null (cleared field) is still not an answer', () => {
    expect(completedStepsFromRows([{ question_key: 's9n_net_margin', step: 9, answer: { value: null } }])).toEqual([])
  })
})

describe('Point A: «не знаю» is not data', () => {
  it('present() refuses the mark and the unwrapped null', () => {
    expect(present(UNKNOWN)).toBe(false)
    expect(present(unwrapAnswer({ value: null, unknown: true }))).toBe(false)
    expect(present(unwrapAnswer(approxAnswer(4, 6)))).toBe(true)
  })

  it('v4: a step answered only «не знаю» does not close its toggles', () => {
    expect(answeredSteps({ s4_dept_count: null }).size).toBe(0)
    expect(answeredSteps({ s4_dept_count: UNKNOWN }).size).toBe(0)
  })
})

describe('metrics resolver', () => {
  const ctx = (answers: Record<string, unknown>) => ({ surveyAnswers: answers, now: new Date('2026-10-22T00:00:00Z') }) as unknown as ResolverContext
  const source = { type: 'survey', key: 's9n_net_margin', step: 9 } as unknown as MetricSource

  it('«не знаю» is a miss, never 0', () => {
    const r = resolveSurveySource(source, ctx({ s9n_net_margin: { value: null, unknown: true } }))
    expect(r.status).toBe('miss')
  })

  it('«примерно» resolves to the midpoint', () => {
    const r = resolveSurveySource(source, ctx({ s9n_net_margin: approxAnswer(10, 20) }))
    expect(r.status).toBe('hit')
    expect(r.numeric).toBe(15)
  })
})

describe('Point B finmodel', () => {
  it('unknown debts are absent; approximate debts are the midpoint', () => {
    expect(finmodelFromSurvey({ s9n_debts_amount: unwrapAnswer({ value: null, unknown: true }) }).debt_total).toBeUndefined()
    expect(finmodelFromSurvey({ s9n_debts_amount: unwrapAnswer(approxAnswer(1_000_000, 2_000_000)) }).debt_total?.value).toBe(1_500_000)
  })
})

describe('goals sync', () => {
  it('«не знаю» is no goal; «примерно» is the midpoint × 12', () => {
    expect(goalsFromAnswers({ s1_goal_12m_revenue_month: { value: null, unknown: true } })['12m']).toBeNull()
    expect(goalsFromAnswers({ s1_goal_12m_revenue_month: approxAnswer(5_000_000, 6_000_000) })['12m']).toEqual({ valueYear: 66_000_000, from: 'month' })
  })
})

describe('GRI reality check', () => {
  it('an unknown net profit is not a loss', () => {
    const items = computeRealityCheck({
      sectionAvgs: { 'cash-stability': 9 },
      ctx: {
        answers: { s9n_net_profit: unwrapAnswer({ value: null, unknown: true }), s1_company_name: 'X' },
        pointA: { has_diagnostic: false, health_index: null, blocks: [] },
        pointB: { current_revenue_year: null, goal_12m_revenue_year: null, gap: { required_mom_growth: null }, realism: { level: 'unknown', score: 0 } },
        metrics: { revenue: null },
      },
    })
    expect(items.find((i) => i.blockId === 'cash-stability')).toBeUndefined()
  })
})

describe('what people see', () => {
  it('formatSurveyValue says «Не знаю» and shows the range', () => {
    expect(formatSurveyValue('s9n_net_margin', UNKNOWN)).toBe('Не знаю')
    expect(formatSurveyValue('s9n_net_margin', { value: null, unknown: true })).toBe('Не знаю')
    expect(formatSurveyValue('s1_current_revenue_month', approxAnswer(5_000_000, 6_000_000))).toBe('≈ 5 500 000 ₸ (5 000 000 – 6 000 000 ₸)')
    expect(formatSurveyValue('s9n_net_margin', approxAnswer(10, 20))).toBe('≈ 15 % (10 – 20 %)')
  })

  it('Google Sheets row: «Не знаю» in the cell, not an empty one', () => {
    const headers = buildSurveySheetHeaders()
    const cells = buildSurveySheetRow([
      { question_key: 's9n_net_margin', step: 9, answer: { value: null, unknown: true } },
      { question_key: 's1_current_revenue_month', step: 1, answer: { value: 5_500_000, approx: true, range: [5_000_000, 6_000_000] } },
    ], { userId: 'u1', updatedAt: new Date('2026-10-22T00:00:00Z') })
    const marginIdx = headers.findIndex((h) => h.startsWith('Шаг 9 ·') && h.includes('маржа'))
    expect(cells[marginIdx]).toBe('Не знаю')
    expect(cells.some((c) => c.startsWith('≈ 5 500 000 ₸'))).toBe(true)
  })

  it('profile summary: the section shows «Не знаю», the hero never shows it as revenue', () => {
    const s = buildUserProfileSummary({ s1_current_revenue_year: UNKNOWN, s9n_revenue_2024: 52_000_000, s9n_net_margin: UNKNOWN })
    expect(s.hero.revenue).not.toBe('Не знаю')
    expect(s.hero.revenue).toContain('52')
    const finance = s.sections.find((x) => x.id === 'finance')
    expect(finance?.answers.find((a) => a.key === 's9n_net_margin')?.value).toBe('Не знаю')
  })
})
