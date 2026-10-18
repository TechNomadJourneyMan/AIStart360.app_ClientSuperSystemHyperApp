import { beforeEach, describe, expect, it, vi } from 'vitest'

const emitted = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: (e: Record<string, unknown>) => { emitted.push(e) } }))

const {
  applyStaleCorrection, loadGoalStatuses, respondToCorrection, reviewGoal, snapshotGoals, STALE_CORRECTION_DAYS,
} = await import('@/lib/point-b/plan/goals')
const { PlanError } = await import('@/lib/point-b/plan/store')
const { pbDb } = await import('./_pbdb')

const REVENUE = 'biz.finansy.vyruchka_god'
const COMPANY = 'company-1'
const OWNER = '00000000-0000-4000-8000-000000000001'
const STRANGER = '00000000-0000-4000-8000-000000000002'
const EXPERT = { id: '00000000-0000-4000-8000-0000000000e1', name: 'Анна Эксперт' }
const key = `${REVENUE}|12m`

const target = (over: Record<string, unknown> = {}) => ({
  id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 100, direction: 'higher_is_better',
  source: 'owner', deadline: null, label: null, note: null, baseline_value: 50, baseline_period: '2025', baseline_at: '2026-01-01T00:00:00Z', ...over,
})

function setup(opts: { goal?: boolean; reviews?: Array<Record<string, unknown>> } = {}) {
  return pbDb({
    companies: [{ id: COMPANY, user_id: OWNER, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null }],
    metric_targets: opts.goal === false ? [] : [target()],
    pb_goal_reviews: opts.reviews ?? [],
  })
}

const review = (over: Record<string, unknown>) => ({
  id: 'rv-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', status: 'corrected', proposed_value: 150, proposed_deadline: null,
  previous_value: 100, reason: 'Выше рынка', reviewer_id: EXPERT.id, reviewer_name: EXPERT.name, owner_agreed_at: null,
  applied_without_agreement: false, reminded_at: null, created_at: '2026-10-01T00:00:00.000Z', ...over,
})

beforeEach(() => { emitted.length = 0 })

describe('reviewGoal', () => {
  it('no goal for the owner: expert correction sets it directly, status verified', async () => {
    const h = setup({ goal: false })
    const { review: r, appliedDirectly } = await reviewGoal(h.sb, {
      companyId: COMPANY, metricKey: REVENUE, periodLabel: '12m', action: 'correct', value: 250, deadline: '2027-10-01', reason: 'Рынок позволяет', reviewer: EXPERT,
    })
    expect(appliedDirectly).toBe(true)
    expect(r).toMatchObject({ status: 'verified', proposed_value: 250, previous_value: null, reviewer_id: EXPERT.id, reason: 'Рынок позволяет' })
    expect(h.db.metric_targets).toHaveLength(1)
    expect(h.db.metric_targets[0]).toMatchObject({ metric_key: REVENUE, target_value: 250, source: 'expert', period_label: '12m', deadline: '2027-10-01' })
    expect(emitted.map((e) => e.name)).toEqual(['TARGET_CHANGED'])
    // and it reads as verified
    expect((await loadGoalStatuses(h.sb, COMPANY)).get(key)).toBe('verified')
  })

  it('existing goal: correct creates a proposal and leaves metric_targets untouched', async () => {
    const h = setup()
    const { review: r, appliedDirectly } = await reviewGoal(h.sb, {
      companyId: COMPANY, metricKey: REVENUE, periodLabel: '12m', action: 'correct', value: 150, reason: 'Выше рынка', reviewer: EXPERT,
    })
    expect(appliedDirectly).toBe(false)
    expect(r).toMatchObject({ status: 'corrected', proposed_value: 150, previous_value: 100, reason: 'Выше рынка' })
    expect(h.db.metric_targets[0].target_value).toBe(100)
    expect(h.writes.filter((w) => w.table === 'metric_targets')).toHaveLength(0)
    expect(emitted).toHaveLength(0)
    expect((await loadGoalStatuses(h.sb, COMPANY)).get(key)).toBe('corrected')
  })

  it('verify marks the goal verified', async () => {
    const h = setup()
    expect((await loadGoalStatuses(h.sb, COMPANY)).get(key)).toBe('owner_draft')
    const { review: r } = await reviewGoal(h.sb, { companyId: COMPANY, metricKey: REVENUE, periodLabel: '12m', action: 'verify', reviewer: EXPERT })
    expect(r).toMatchObject({ status: 'verified', proposed_value: 100, reviewer_name: 'Анна Эксперт' })
    expect((await loadGoalStatuses(h.sb, COMPANY)).get(key)).toBe('verified')
    expect(h.db.metric_targets[0].target_value).toBe(100)
  })

  it('a verified goal the owner changed afterwards reads as owner_draft again', async () => {
    const h = setup()
    await reviewGoal(h.sb, { companyId: COMPANY, metricKey: REVENUE, periodLabel: '12m', action: 'verify', reviewer: EXPERT })
    h.db.metric_targets[0].target_value = 300
    expect((await loadGoalStatuses(h.sb, COMPANY)).get(key)).toBe('owner_draft')
    expect((await snapshotGoals(h.sb, COMPANY)).items[0].reviewStatus).toBe('owner_draft')
  })

  it('reject without a reason throws; with a reason the goal is disputed', async () => {
    const h = setup()
    const err = await reviewGoal(h.sb, { companyId: COMPANY, metricKey: REVENUE, periodLabel: '12m', action: 'reject', reviewer: EXPERT }).catch((e) => e)
    expect(err).toBeInstanceOf(PlanError)
    expect(err.code).toBe('conditions')
    expect(h.db.pb_goal_reviews).toHaveLength(0)
    const { review: r } = await reviewGoal(h.sb, { companyId: COMPANY, metricKey: REVENUE, periodLabel: '12m', action: 'reject', reason: 'Цель не измерима', reviewer: EXPERT })
    expect(r).toMatchObject({ status: 'disputed', reason: 'Цель не измерима', previous_value: 100 })
  })

  it('a correction needs a value and a reason, and must change something', async () => {
    const h = setup()
    const base = { companyId: COMPANY, metricKey: REVENUE, periodLabel: '12m', action: 'correct' as const, reviewer: EXPERT }
    await expect(reviewGoal(h.sb, { ...base, reason: 'Причина' })).rejects.toMatchObject({ code: 'conditions' })
    await expect(reviewGoal(h.sb, { ...base, value: 150 })).rejects.toMatchObject({ code: 'conditions' })
    await expect(reviewGoal(h.sb, { ...base, value: 100, reason: 'Причина' })).rejects.toMatchObject({ code: 'conditions' })
    await expect(reviewGoal(h.sb, { ...base, value: 150, deadline: '01.10.2027', reason: 'Причина' })).rejects.toMatchObject({ code: 'conditions' })
    expect(h.db.pb_goal_reviews).toHaveLength(0)
  })

  it('verify of a goal that does not exist → not_found; unknown metric cannot be set directly', async () => {
    const h = setup({ goal: false })
    await expect(reviewGoal(h.sb, { companyId: COMPANY, metricKey: REVENUE, periodLabel: '12m', action: 'verify', reviewer: EXPERT })).rejects.toMatchObject({ code: 'not_found' })
    await expect(reviewGoal(h.sb, { companyId: COMPANY, metricKey: 'no.such.metric', periodLabel: '12m', action: 'correct', value: 1, reason: 'Причина', reviewer: EXPERT })).rejects.toMatchObject({ code: 'conditions' })
  })

  it('profanity in the reason is refused and nothing is written', async () => {
    const h = setup()
    await expect(reviewGoal(h.sb, { companyId: COMPANY, metricKey: REVENUE, periodLabel: '12m', action: 'correct', value: 150, reason: 'нахуй такую цель', reviewer: EXPERT }))
      .rejects.toMatchObject({ name: 'ProfanityError', field: 'reason' })
    expect(h.db.pb_goal_reviews).toHaveLength(0)
  })
})

describe('respondToCorrection', () => {
  it('accepting applies the proposed value and records owner_agreed_at', async () => {
    const h = setup({ reviews: [review({ proposed_deadline: '2027-06-30' })] })
    const done = await respondToCorrection(h.sb, { reviewId: 'rv-1', userId: OWNER, accept: true })
    expect(done.status).toBe('agreed')
    expect(done.owner_agreed_at).toBeTruthy()
    expect(h.db.metric_targets[0]).toMatchObject({ target_value: 150, deadline: '2027-06-30', source: 'expert', baseline_value: 50 })
    expect(emitted.map((e) => e.name)).toEqual(['TARGET_CHANGED'])
    expect((await loadGoalStatuses(h.sb, COMPANY)).get(key)).toBe('agreed')
  })

  it('disputing keeps metric_targets and sets disputed', async () => {
    const h = setup({ reviews: [review({})] })
    const done = await respondToCorrection(h.sb, { reviewId: 'rv-1', userId: OWNER, accept: false })
    expect(done).toMatchObject({ status: 'disputed', owner_agreed_at: null })
    expect(h.db.metric_targets[0].target_value).toBe(100)
    expect(emitted).toHaveLength(0)
  })

  it('only the company owner can respond; another user → PlanError not_found', async () => {
    const h = setup({ reviews: [review({})] })
    const err = await respondToCorrection(h.sb, { reviewId: 'rv-1', userId: STRANGER, accept: true }).catch((e) => e)
    expect(err).toBeInstanceOf(PlanError)
    expect(err.code).toBe('not_found')
    await expect(respondToCorrection(h.sb, { reviewId: 'no-such-review', userId: OWNER, accept: true })).rejects.toMatchObject({ code: 'not_found' })
    expect(h.db.pb_goal_reviews[0].status).toBe('corrected')
    expect(h.db.metric_targets[0].target_value).toBe(100)
  })

  it('answers once; a superseded correction cannot be answered', async () => {
    const h = setup({ reviews: [review({})] })
    await respondToCorrection(h.sb, { reviewId: 'rv-1', userId: OWNER, accept: false })
    await expect(respondToCorrection(h.sb, { reviewId: 'rv-1', userId: OWNER, accept: true })).rejects.toMatchObject({ code: 'bad_state' })

    const h2 = setup({ reviews: [review({}), review({ id: 'rv-2', status: 'verified', proposed_value: 100, created_at: '2026-10-02T00:00:00.000Z' })] })
    await expect(respondToCorrection(h2.sb, { reviewId: 'rv-1', userId: OWNER, accept: true })).rejects.toMatchObject({ code: 'bad_state' })
    expect(h2.db.metric_targets[0].target_value).toBe(100)
  })

  it('two concurrent answers: exactly one wins', async () => {
    const h = setup({ reviews: [review({})] })
    const results = await Promise.allSettled([
      respondToCorrection(h.sb, { reviewId: 'rv-1', userId: OWNER, accept: true }),
      respondToCorrection(h.sb, { reviewId: 'rv-1', userId: OWNER, accept: false }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const status = h.db.pb_goal_reviews[0].status
    expect(h.db.metric_targets[0].target_value).toBe(status === 'agreed' ? 150 : 100)
  })

  it('a failed apply puts the proposal back', async () => {
    const h = setup({ reviews: [review({ metric_key: 'no.such.metric' })] })
    h.db.metric_targets[0].metric_key = 'no.such.metric'
    await expect(respondToCorrection(h.sb, { reviewId: 'rv-1', userId: OWNER, accept: true })).rejects.toThrow()
    expect(h.db.pb_goal_reviews[0]).toMatchObject({ status: 'corrected', owner_agreed_at: null })
  })
})

describe('applyStaleCorrection', () => {
  it('refuses a correction younger than 14 days and applies an older one with applied_without_agreement true', async () => {
    expect(STALE_CORRECTION_DAYS).toBe(14)
    const h = setup({ reviews: [review({ created_at: '2026-10-10T00:00:00.000Z' })] })
    const young = await applyStaleCorrection(h.sb, 'rv-1', EXPERT, { now: new Date('2026-10-18T00:00:00Z') }).catch((e) => e)
    expect(young).toBeInstanceOf(PlanError)
    expect(young.code).toBe('conditions')
    expect(h.db.metric_targets[0].target_value).toBe(100)
    expect(h.db.pb_goal_reviews[0].status).toBe('corrected')

    const done = await applyStaleCorrection(h.sb, 'rv-1', EXPERT, { now: new Date('2026-10-25T00:00:01Z') })
    expect(done).toMatchObject({ status: 'verified', applied_without_agreement: true })
    expect(h.db.metric_targets[0].target_value).toBe(150)
    // visible in the snapshot of the version
    const item = (await snapshotGoals(h.sb, COMPANY)).items[0]
    expect(item).toMatchObject({ reviewStatus: 'verified', appliedWithoutAgreement: true, targetValue: 150 })
  })

  it('only an open correction can be applied', async () => {
    const h = setup({ reviews: [review({ status: 'agreed' })] })
    await expect(applyStaleCorrection(h.sb, 'rv-1', EXPERT, { now: new Date('2027-01-01T00:00:00Z') })).rejects.toMatchObject({ code: 'bad_state' })
    await expect(applyStaleCorrection(h.sb, 'missing', EXPERT)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('snapshotGoals / statuses', () => {
  it('snapshotGoals defaults the primary goal to revenue 12m and carries review statuses', async () => {
    const h = setup({ reviews: [review({ status: 'verified', proposed_value: 100 })] })
    const snap = await snapshotGoals(h.sb, COMPANY)
    expect(snap.primary).toEqual({ metricKey: REVENUE, periodLabel: '12m' })
    expect(snap.items).toEqual([{
      metricKey: REVENUE, periodLabel: '12m', label: expect.stringContaining('через 12 месяцев'), baselineValue: 50, baselinePeriod: '2025',
      targetValue: 100, deadline: null, reviewStatus: 'verified',
    }])
  })

  it('the default primary is null when the company has no revenue goal; an explicit one is kept', async () => {
    const h = setup({ goal: false })
    expect(await snapshotGoals(h.sb, COMPANY)).toEqual({ primary: null, items: [] })
    const h2 = setup()
    expect((await snapshotGoals(h2.sb, COMPANY, null)).primary).toBeNull()
    expect((await snapshotGoals(h2.sb, COMPANY, { metricKey: REVENUE, periodLabel: '3y' })).primary).toEqual({ metricKey: REVENUE, periodLabel: '3y' })
  })

  it('a goal without review rows is owner_draft', async () => {
    const h = setup()
    expect((await snapshotGoals(h.sb, COMPANY)).items[0].reviewStatus).toBe('owner_draft')
  })

  it('the latest review row wins when several exist', async () => {
    const h = setup({ reviews: [
      review({ id: 'a', status: 'verified', proposed_value: 100, created_at: '2026-10-01T00:00:00.000Z' }),
      review({ id: 'b', status: 'disputed', proposed_value: null, created_at: '2026-10-03T00:00:00.000Z' }),
      review({ id: 'c', status: 'corrected', created_at: '2026-10-02T00:00:00.000Z' }),
    ] })
    expect((await loadGoalStatuses(h.sb, COMPANY)).get(key)).toBe('disputed')
    expect((await snapshotGoals(h.sb, COMPANY)).items[0].reviewStatus).toBe('disputed')
  })

  it('the revenue column of the company counts as the owner’s goal', async () => {
    const h = pbDb({ companies: [{ id: COMPANY, user_id: OWNER, target_revenue_12m_kzt: 5_000_000, target_revenue_3y_kzt: null }] })
    const snap = await snapshotGoals(h.sb, COMPANY)
    expect(snap.primary).toEqual({ metricKey: REVENUE, periodLabel: '12m' })
    expect(snap.items[0]).toMatchObject({ targetValue: 5_000_000, reviewStatus: 'owner_draft' })
    // a correction of it is a proposal, not a direct write
    const { appliedDirectly } = await reviewGoal(h.sb, { companyId: COMPANY, metricKey: REVENUE, periodLabel: '12m', action: 'correct', value: 6_000_000, reason: 'Реалистичнее', reviewer: EXPERT })
    expect(appliedDirectly).toBe(false)
    expect(h.db.metric_targets).toHaveLength(0)
  })
})
