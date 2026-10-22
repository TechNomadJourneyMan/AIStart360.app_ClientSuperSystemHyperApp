/**
 * Honest progress (survey audit 2026-10-22, MVP item 5): «Минимум для Точки А:
 * X из N» from the Point A v4 engine's own check inputs + «Глубина: X %» by
 * real answered fields; the server summary (cabinet, GIGA) uses the same rules.
 */
import { describe, expect, it } from 'vitest'
import { unknownAnswer } from '@/lib/survey/answer-value'
import {
  AUTO_KEYS, hasAnswerValue, overallFill, pointAMinimum, POINT_A_MINIMUM_CHECKS, stepFillFromAnswers, stepTimeHint, stepTimeLeft, surveyDepth,
} from '@/lib/survey/progress'
import { CHECK_INPUTS } from '@/lib/point-a/v4/check-inputs'
import { SURVEY_KEY_STEP, stepForQuestionKey, surveyProgressFromRows } from '@/lib/survey/steps'
import { STEPS } from '@/components/onboarding/constants/step-config'

const INFLUENCE_TEMPLATE = ['Клиенты', 'Партнёры', 'Подрядчики'].map((category) => ({ category, name_or_link: '', status: '' }))
const METRICS_TEMPLATE = ['Количество продаж', 'Сумма продаж'].map((metric_name) => ({ metric_name, y2023: null, y2024: 0, y2025: null }))

describe('what counts as answered', () => {
  it('a prefilled table template is not an answer; a real row is', () => {
    expect(hasAnswerValue(INFLUENCE_TEMPLATE)).toBe(false)
    expect(hasAnswerValue(METRICS_TEMPLATE)).toBe(false)
    expect(hasAnswerValue([...INFLUENCE_TEMPLATE, { category: 'Инвесторы', name_or_link: 'Фонд X', status: '' }])).toBe(true)
    expect(hasAnswerValue([{ metric_name: 'Сумма продаж', y2025: 52_000_000 }])).toBe(true)
    expect(hasAnswerValue(['Алматы'])).toBe(true) // a multi-select
  })

  it('«не знаю» is an answer, an auto field is not a question', () => {
    expect(hasAnswerValue(unknownAnswer())).toBe(true)
    expect(AUTO_KEYS).toEqual(expect.arrayContaining(['s1_current_revenue_year', 's1_goal_12m_revenue_year', 's1_goal_3y_revenue_year']))
    expect(stepFillFromAnswers({})[0].total).toBe(Object.values(SURVEY_KEY_STEP).filter((s) => s === 1).length - 3)
  })
})

describe('depth', () => {
  it('one touched toggle or the influence-map template does not make a step «done»', () => {
    const d = surveyDepth({ s4_has_org_chart: true, s11_influence_map: INFLUENCE_TEMPLATE })
    expect(d.answered).toBe(1)
    expect(d.total).toBe(Object.keys(SURVEY_KEY_STEP).length - 3)
    expect(d.percent).toBe(1)
    expect(overallFill(stepFillFromAnswers({ s4_has_org_chart: true })).percent).toBe(1)
  })

  it('time left shrinks with the answered share of the step', () => {
    const fill = stepFillFromAnswers({})
    expect(stepTimeLeft(fill[0], 4)).toBe(4)
    const half = { ...fill[0], filled: Math.floor(fill[0].total / 2) }
    expect(stepTimeLeft(half, 4)).toBe(2)
    expect(stepTimeLeft({ ...fill[0], filled: fill[0].total }, 4)).toBe(0)
    expect(stepTimeHint(fill[0], 4)).toBe('~4 мин')
    expect(stepTimeHint(half, 4)).toBe('осталось ~2 мин')
    expect(stepTimeHint({ ...fill[0], filled: fill[0].total }, 4)).toBe('всё заполнено')
  })
})

describe('«Минимум для Точки А»', () => {
  it('is derived from the v4 engine check inputs that the wizard can answer', () => {
    // Every check with at least one current-wizard key, nothing else.
    const expected = Object.entries(CHECK_INPUTS).flatMap(([block, checks]) =>
      Object.entries(checks ?? {}).filter(([, c]) => c.keys.some((k) => stepForQuestionKey(k) !== null)).map(([id]) => `${block}.${id}`))
    expect(POINT_A_MINIMUM_CHECKS.map((c) => `${c.block}.${c.check}`)).toEqual(expected)
    expect(POINT_A_MINIMUM_CHECKS.length).toBe(15)
    expect(pointAMinimum({}).answered).toBe(0)
    expect(pointAMinimum({}).total).toBe(15)
  })

  it('follows isAnswered: zero goals do not count, a saved step closes its toggles', () => {
    expect(pointAMinimum({ s1_goal_12m_revenue_month: 0 }).answered).toBe(0)
    expect(pointAMinimum({ s1_goal_12m_revenue_month: 9_000_000 }).answered).toBe(1)
    // Step 4 saved with any answer → org chart, meetings and KPI toggles count as a deliberate «нет».
    const m = pointAMinimum({ s4_dept_count: 3 })
    expect(m.answered).toBe(3)
    expect(m.missing.map((x) => x.check)).not.toContain('org_chart')
  })

  it('lists what is missing with a label and the step to open', () => {
    const m = pointAMinimum({})
    const goal = m.missing.find((x) => x.check === 'goal_12m')
    expect(goal).toMatchObject({ label: 'Цель на 12 месяцев', step: 2 })
  })
})

describe('server summary uses the same rules', () => {
  it('surveyProgressFromRows: percent = depth, minimum, template rows do not start a step', () => {
    const rows = [
      { question_key: 's4_has_org_chart', step: 4, answer: { value: true } },
      { question_key: 's11_influence_map', step: 11, answer: { value: INFLUENCE_TEMPLATE } },
      { question_key: 's9n_net_margin', step: 9, answer: { value: null, unknown: true } },
      { question_key: 's1_current_revenue_year', step: 1, answer: { value: 66_000_000 } }, // auto field
    ]
    const p = surveyProgressFromRows(rows)
    expect(p.completed_steps).toEqual([4, 9]) // the auto «год» field is not a question
    expect(p.answered).toBe(2)
    expect(p.total_fields).toBe(Object.keys(SURVEY_KEY_STEP).length - 3)
    expect(p.percent).toBe(1)
    expect(p.minimum).toEqual({ answered: 3, total: 15 })
    // The wizard computes the same numbers from the flat answers.
    const flat = { s4_has_org_chart: true, s11_influence_map: INFLUENCE_TEMPLATE, s9n_net_margin: unknownAnswer() }
    expect(surveyDepth(flat).percent).toBe(p.percent)
    expect(pointAMinimum(flat).answered).toBe(p.minimum.answered)
  })
})

describe('step time estimates', () => {
  it('every step has minutes', () => {
    for (const s of STEPS) expect(s.minutes, `step ${s.n}`).toBeGreaterThan(0)
  })
})
