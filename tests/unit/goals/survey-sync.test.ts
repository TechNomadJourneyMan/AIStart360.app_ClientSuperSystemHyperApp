import { describe, it, expect, vi } from 'vitest'
import { goalsFromAnswers, syncGoalsFromSurvey, touchesGoalKeys, writeGoalToSurvey, type GoalActor } from '@/lib/goals/survey-sync'
import { REVENUE_GOAL_METRIC } from '@/lib/goals/store'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { memoryClient, type Row } from '../data-layer/memory-client'

const OWNER: GoalActor = { id: 'u-owner', role: 'owner' }
const EXPERT: GoalActor = { id: 'u-expert', role: 'expert' }

function world(opts: { targets?: Row[]; answers?: Row[]; company?: Row } = {}) {
  return memoryClient({
    companies: [{ id: 'co', user_id: 'u-owner', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, ...opts.company }],
    metric_targets: opts.targets ?? [],
    survey_answers: opts.answers ?? [],
  })
}
const goal = (db: Record<string, Row[]>, period: string) =>
  db.metric_targets.find((r) => r.metric_key === REVENUE_GOAL_METRIC && r.period_label === period)
const answer = (db: Record<string, Row[]>, key: string) => db.survey_answers.find((r) => r.question_key === key)

describe('goalsFromAnswers', () => {
  it('year wins, month × 12 is the fallback', () => {
    expect(goalsFromAnswers({ s1_goal_12m_revenue_year: { value: 780_000_000 }, s1_goal_12m_revenue_month: { value: 1 }, s1_goal_3y_revenue_month: 15_000_000 })).toEqual({
      '12m': { valueYear: 780_000_000, from: 'year' },
      '3y': { valueYear: 180_000_000, from: 'month' },
    })
  })

  it('numeric answers beat the legacy text goal_month_v2', () => {
    const g = goalsFromAnswers({ s1_goal_3y_revenue_year: { value: 3_400_000_000 }, goal_month_v2: { value: '500 тыс ₸ / мес' } })
    expect(g['12m']).toBeNull()
    expect(g['3y']).toEqual({ valueYear: 3_400_000_000, from: 'year' })
  })

  it('the legacy text counts only when no numeric goal exists', () => {
    expect(goalsFromAnswers({ goal_month_v2: { value: '500 тыс ₸ / мес' } })['12m']).toEqual({ valueYear: 6_000_000, from: 'legacy_text' })
    expect(goalsFromAnswers({ goal_month_v2: { value: '20 млн ₸ / мес' } })['12m']).toEqual({ valueYear: 240_000_000, from: 'legacy_text' })
    expect(goalsFromAnswers({ goal_month_v2: { value: 'вырасти' } })).toEqual({ '12m': null, '3y': null })
    expect(goalsFromAnswers({ s1_goal_12m_revenue_year: 0 })).toEqual({ '12m': null, '3y': null })
  })

  it('touchesGoalKeys: only the numeric goal answers', () => {
    expect(touchesGoalKeys(['s1_company_name', 's1_goal_3y_revenue_month'])).toBe(true)
    expect(touchesGoalKeys(['s1_company_name', 'goal_month_v2', 's2n_goal_12m_what'])).toBe(false)
  })
})

describe('syncGoalsFromSurvey (survey → goal)', () => {
  it('a saved goal answer replaces a different goal; companies.target_revenue_* follows; actor attribution', async () => {
    const m = world({ targets: [{ id: 't1', company_id: 'co', metric_key: REVENUE_GOAL_METRIC, period_label: '12m', target_value: 6_000_000, source: 'owner', updated_by: null }] })
    const res = await syncGoalsFromSurvey(m.client, {
      userId: 'u-owner', companyId: 'co', actor: OWNER,
      answers: { s1_goal_12m_revenue_year: { value: 780_000_000 }, s1_goal_12m_revenue_month: { value: 65_000_000 } },
    })
    expect(res).toEqual({ set: ['12m'], cleared: [] })
    expect(goal(m.db, '12m')).toMatchObject({ target_value: 780_000_000, source: 'owner', set_by: 'u-owner', updated_by: 'u-owner' })
    expect(m.db.companies[0].target_revenue_12m_kzt).toBe(780_000_000)
    expect(m.db.metric_targets).toHaveLength(1)
  })

  it('a staff save writes an expert goal; the company is found by the owner', async () => {
    const m = world()
    await syncGoalsFromSurvey(m.client, { userId: 'u-owner', actor: EXPERT, answers: { s1_goal_3y_revenue_year: 3_400_000_000, s1_goal_3y_revenue_month: 283_333_333 } })
    expect(goal(m.db, '3y')).toMatchObject({ target_value: 3_400_000_000, source: 'expert', updated_by: 'u-expert', company_id: 'co' })
    expect(m.db.companies[0].target_revenue_3y_kzt).toBe(3_400_000_000)
  })

  it('only the month written → month × 12, and the year answer is aligned (step from SURVEY_KEY_STEP)', async () => {
    const m = world({ answers: [{ user_id: 'u-owner', question_key: 's1_goal_12m_revenue_year', step: 1, answer: { value: 1 } }] })
    await syncGoalsFromSurvey(m.client, { userId: 'u-owner', companyId: 'co', actor: OWNER, answers: { s1_goal_12m_revenue_month: { value: 5_000_000 } } })
    expect(goal(m.db, '12m')).toMatchObject({ target_value: 60_000_000 })
    expect(answer(m.db, 's1_goal_12m_revenue_year')).toMatchObject({ answer: { value: 60_000_000 }, step: SURVEY_KEY_STEP.s1_goal_12m_revenue_year })
  })

  it('idempotent: the same answers again change nothing', async () => {
    const m = world()
    const input = { userId: 'u-owner', companyId: 'co', actor: OWNER, answers: { s1_goal_12m_revenue_year: 780_000_000, s1_goal_12m_revenue_month: 65_000_000 } }
    await syncGoalsFromSurvey(m.client, input)
    const before = JSON.stringify(m.db.metric_targets)
    expect(await syncGoalsFromSurvey(m.client, input)).toEqual({ set: [], cleared: [] })
    expect(JSON.stringify(m.db.metric_targets)).toBe(before)
  })

  it('other keys / untouched horizons are ignored', async () => {
    const m = world({ targets: [{ id: 't1', company_id: 'co', metric_key: REVENUE_GOAL_METRIC, period_label: '3y', target_value: 1 }] })
    expect(await syncGoalsFromSurvey(m.client, { userId: 'u-owner', companyId: 'co', actor: OWNER, answers: { s1_company_name: 'X' } })).toEqual({ skipped: 'no_goal_keys' })
    await syncGoalsFromSurvey(m.client, { userId: 'u-owner', companyId: 'co', actor: OWNER, answers: { s1_goal_12m_revenue_year: 10, s1_goal_3y_revenue_year: 99 }, touchedKeys: ['s1_goal_12m_revenue_year'] })
    expect(goal(m.db, '3y')).toMatchObject({ target_value: 1 })
  })

  it('an emptied answer removes the goal only when clearing is allowed (not on autosave)', async () => {
    const seed = () => world({
      company: { target_revenue_12m_kzt: 780_000_000 },
      targets: [{ id: 't1', company_id: 'co', metric_key: REVENUE_GOAL_METRIC, period_label: '12m', target_value: 780_000_000 }],
      answers: [{ user_id: 'u-owner', question_key: 's1_goal_12m_revenue_year', step: 1, answer: { value: 0 } }],
    })
    const answers = { s1_goal_12m_revenue_month: 0, s1_goal_12m_revenue_year: 0 }
    const auto = seed()
    await syncGoalsFromSurvey(auto.client, { userId: 'u-owner', companyId: 'co', actor: OWNER, answers })
    expect(goal(auto.db, '12m')).toBeTruthy()
    const explicit = seed()
    expect(await syncGoalsFromSurvey(explicit.client, { userId: 'u-owner', companyId: 'co', actor: OWNER, answers, allowClear: true })).toEqual({ set: [], cleared: ['12m'] })
    expect(goal(explicit.db, '12m')).toBeUndefined()
    expect(explicit.db.companies[0].target_revenue_12m_kzt).toBeNull()
  })

  it('never throws into the caller', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = { from: () => { throw new Error('db down') } } as never
    await expect(syncGoalsFromSurvey(broken, { userId: 'u', actor: OWNER, answers: { s1_goal_12m_revenue_year: 1 } })).resolves.toEqual({ skipped: 'error' })
    await expect(writeGoalToSurvey(broken, { companyId: 'co', periodLabel: '12m', valueYear: 1, actor: OWNER })).resolves.toEqual({ skipped: 'error' })
    err.mockRestore()
  })
})

describe('writeGoalToSurvey (goal → survey)', () => {
  it('writes year and month = year / 12 into the owner\'s answers with step 1, not the caller\'s step', async () => {
    const m = world({ answers: [{ user_id: 'u-owner', question_key: 's1_goal_12m_revenue_year', step: 7, answer: { value: 6_000_000, source: 'AI' } }] })
    const res = await writeGoalToSurvey(m.client, { companyId: 'co', periodLabel: '12m', valueYear: 900_000_000, actor: EXPERT })
    expect(res).toEqual({ written: ['s1_goal_12m_revenue_year', 's1_goal_12m_revenue_month'], removed: [] })
    expect(answer(m.db, 's1_goal_12m_revenue_year')).toMatchObject({ user_id: 'u-owner', company_id: 'co', step: 1, answer: { value: 900_000_000 } })
    expect(answer(m.db, 's1_goal_12m_revenue_month')).toMatchObject({ step: 1, answer: { value: 75_000_000 } })
    expect(m.db.survey_answers).toHaveLength(2)
  })

  it('idempotent: answers that already hold the value are left alone (their provenance kept)', async () => {
    const m = world({ answers: [
      { user_id: 'u-owner', question_key: 's1_goal_3y_revenue_year', step: 1, answer: { value: 3_400_000_000, source: 'Стратегия' }, answered_at: 'x' },
      { user_id: 'u-owner', question_key: 's1_goal_3y_revenue_month', step: 1, answer: { value: 283_333_333, source: 'Стратегия' }, answered_at: 'x' },
    ] })
    expect(await writeGoalToSurvey(m.client, { userId: 'u-owner', companyId: 'co', periodLabel: '3y', valueYear: 3_400_000_000, actor: OWNER })).toEqual({ written: [], removed: [] })
    expect(answer(m.db, 's1_goal_3y_revenue_year')).toMatchObject({ answered_at: 'x', answer: { source: 'Стратегия' } })
  })

  it('a removed goal removes both answers', async () => {
    const m = world({ answers: [
      { user_id: 'u-owner', question_key: 's1_goal_3y_revenue_year', step: 1, answer: { value: 1 } },
      { user_id: 'u-owner', question_key: 's1_company_name', step: 1, answer: { value: 'X' } },
    ] })
    expect(await writeGoalToSurvey(m.client, { companyId: 'co', periodLabel: '3y', valueYear: null, actor: OWNER })).toEqual({ written: [], removed: ['s1_goal_3y_revenue_year'] })
    expect(m.db.survey_answers.map((r) => r.question_key)).toEqual(['s1_company_name'])
  })

  it('other horizons do nothing; a separate writer gets the writes', async () => {
    const m = world()
    expect(await writeGoalToSurvey(m.client, { companyId: 'co', periodLabel: '2027', valueYear: 1, actor: OWNER })).toEqual({ skipped: 'not_revenue_period' })
    const w = memoryClient({ survey_answers: [] })
    await writeGoalToSurvey(m.client, { companyId: 'co', periodLabel: '12m', valueYear: 120, actor: OWNER, writer: w.client })
    expect(m.db.survey_answers).toHaveLength(0)
    expect(w.db.survey_answers.map((r) => [r.question_key, (r.answer as { value: number }).value])).toEqual([['s1_goal_12m_revenue_year', 120], ['s1_goal_12m_revenue_month', 10]])
  })

  it('round trip: a goal written to the survey and synced back is a no-op', async () => {
    const m = world({ targets: [{ id: 't1', company_id: 'co', metric_key: REVENUE_GOAL_METRIC, period_label: '12m', target_value: 900_000_000 }] })
    await writeGoalToSurvey(m.client, { companyId: 'co', periodLabel: '12m', valueYear: 900_000_000, actor: OWNER })
    const answers = Object.fromEntries(m.db.survey_answers.map((r) => [r.question_key, r.answer]))
    expect(await syncGoalsFromSurvey(m.client, { userId: 'u-owner', companyId: 'co', actor: OWNER, answers })).toEqual({ set: [], cleared: [] })
  })
})
