/**
 * Point B Ф6b, Task 3: the monthly facts of the reconciliation, the recompute of one company (checkpoints, unchanged
 * hash, stale recommendations, the plan-fact invites, a DRAFT revision on a material deviation — never approved — and
 * the expert's notification). In-memory DB with the real column names; notifications mocked — no network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfanityError } from '@/lib/moderation/profanity'
import type { ScenarioResult } from '@/lib/point-b/model/types'
import { pbDb } from './_pbdb'

const REVENUE = 'biz.finansy.vyruchka_god'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const EXPERT = 'eeeeeeee-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const NOW = new Date('2026-10-22T09:00:00Z')

const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  staff: [] as Array<Record<string, unknown>>,
  notify: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.h!.sb }))
vi.mock('@/lib/settings/system-settings', () => ({ getAccessGatesEnabled: async () => false }))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => null }))
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: async (n: Record<string, unknown>) => { s.staff.push(n); return { eventId: 'e', duplicate: false, deliveries: [] } } }))
vi.mock('@/lib/notifications/notify', () => ({
  notifyClient: async (input: Record<string, unknown>) => { s.notify.push(input); return { ok: true, delivered: { inApp: true, email: false, telegram: false } } },
}))
vi.mock('@/lib/notifications/store', () => ({ getRecipient: async () => null, claimSend: async () => ({ result: 'claimed', id: 'c' }), releaseSend: async () => undefined }))
vi.mock('@/lib/point-b/plan/notify', () => ({
  POINT_B_STAFF_PERMISSION: 'clients.review',
  pointBStaffLink: (id: string) => `/admin-giga-panel/users/${id}?tab=point-b`,
}))

const { recomputeCompany, planFactHash } = await import('@/lib/point-b/planfact/recompute')
const { saveMonthlyFacts, validateMonthlyFacts, PlanFactError } = await import('@/lib/point-b/planfact/store')

/** Revenue 5M → 10M a month over 12 months from June 2026, leads 300 → 420, conversion 10% → 13%, check 140 → 154 тыс. */
function scenario(): ScenarioResult {
  return {
    key: 'moderate', label: 'Умеренный', feasible: true, infeasibleReason: null,
    timeToGoalMonths: { low: 14, base: 12, high: 10 }, revenueAtDeadline: { low: 1e8, base: 1.2e8, high: 1.3e8 },
    requiredUplift: [
      { lever: 'leads', label: 'Лиды в месяц', current: 300, target: 420, upliftPct: 40 },
      { lever: 'conversion', label: 'Конверсия лида в клиента', current: 0.1, target: 0.13, upliftPct: 30 },
      { lever: 'avgCheck', label: 'Средний чек', current: 140_000, target: 154_000, upliftPct: 10 },
    ],
    investments: { marketingMonthlyIncrease: null, totalOverRamp: null, staffNeed: null, note: '' },
    constraints: [], risks: [], conditions: [], downside: '', reviewPoints: [], signsToChangePace: [], assumptions: [],
    trajectory: Array.from({ length: 13 }, (_, m) => ({ month: m, low: (60 + 5 * m) * 1e6 * 0.9, base: (60 + 5 * m) * 1e6, high: (60 + 5 * m) * 1e6 * 1.1 })),
  }
}

const goalsSnap = { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [{ metricKey: REVENUE, periodLabel: '12m', label: 'Удвоить выручку', baselineValue: 60_000_000, baselinePeriod: '2026', targetValue: 120_000_000, deadline: null, reviewStatus: 'verified' }] }
const approved = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', plan_id: 'plan-1', version: 1, status: 'approved', base_snapshot_id: null, goals: goalsSnap,
  assumptions: { model: { computedAt: '2026-06-10T00:00:00Z' }, profiles: [{ key: 'moderate', label: 'Умеренный', rampMonths: 12, reserveMonths: 2, productivityGain: 0.05, growthCapAnnual: 0.5, leverMix: { leads: 0.25, conversion: 0.25, avgCheck: 0.25, repeat: 0.25 } }] },
  scenarios: [scenario()], selected_scenario: 'moderate',
  strategy: { items: [], milestones: [{ key: '11111111-0000-4000-8000-000000000001', title: 'Запуск партнёрской программы', date: '2026-10-15', description: null, kpi: '10 партнёров' }] },
  risks: [], expert_notes: null, change_reason: 'Первый план', author_id: EXPERT, author_name: 'Алия Эксперт', author_kind: 'expert',
  submitted_at: '2026-06-12T00:00:00Z', approved_by: 'aaaaaaaa-0000-4000-8000-000000000001', approved_at: '2026-06-15T00:00:00Z', approval_exception: null,
  rejected_by: null, rejected_at: null, rejected_reason: null, created_at: '2026-06-10T00:00:00Z', ...over,
})
const metric = (key: string, value: number) => ({ company_id: COMPANY, metric_key: key, metric_value: value, source: 'survey', period_year: 2026, computed_at: '2026-10-01T00:00:00Z' })
const block = (score: number) => ({ score, status: 'average', top_issues: [], recommendations: [] })

function seed(opts: { plan?: boolean; versions?: Array<Record<string, unknown>> } = {}) {
  s.h = pbDb({
    companies: [{ id: COMPANY, user_id: CLIENT, name: 'Ромашка', industry: 'Интернет-магазин', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
    profiles: [{ id: CLIENT, role: 'client', full_name: 'Клиент Один', email: 'one@example.com', tier: 'pro', feature_flags: {}, expert_title: null }],
    user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }],
    metric_targets: [{
      id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 120_000_000, direction: 'higher_is_better',
      source: 'owner', deadline: null, label: 'Удвоить выручку', note: null, baseline_value: 60_000_000, baseline_period: '2026', baseline_at: '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z',
    }],
    pb_goal_reviews: [{ id: 'gr-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', status: 'verified', proposed_value: 120_000_000, created_at: '2026-06-10T00:00:00Z' }],
    metrics: [metric(REVENUE, 60_000_000), metric('biz.marketing.lidov_v_mes', 300), metric('biz.marketing.konversiya_lid_klient', 10), metric('biz.prodazhi.sredniy_chek', 140_000)],
    diagnostics: [{ id: 'diag-1', user_id: CLIENT, company_id: COMPANY, is_current: true, calculated_at: '2026-10-01T00:00:00Z', overall_score: 55, health_index: 50, stage: 'growth', finance_score: block(60), sales_score: block(50), operations_score: block(55), marketing_score: block(45), strategy_score: block(40) }],
    point_a_snapshots: [],
    point_b_versions: [],
    pb_plans: opts.plan === false ? [] : [{ id: 'plan-1', company_id: COMPANY, user_id: CLIENT, current_version_id: 'v-1', published_version_id: 'v-1', settings: {}, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' }],
    pb_plan_versions: opts.plan === false ? [] : (opts.versions ?? [approved()]),
  })
}

const facts = (values: Record<string, number>, period = '2026-09') => saveMonthlyFacts(s.h!.sb, {
  companyId: COMPANY, period, values, note: null, enteredBy: CLIENT, role: 'owner',
})
const db = () => s.h!.db

beforeEach(() => {
  seed()
  s.staff.length = 0
  s.notify.length = 0
})

describe('«Факт за месяц»: validation and storage', () => {
  const kpis = ['revenue', 'leads', 'conversion', 'avg_check'] as const

  it('keeps only the KPIs of the plan, numbers in range, a month that is over or running', () => {
    expect(validateMonthlyFacts({ period: '2026-09', values: { revenue: '6 100 000', conversion: '9,5', leads: 280 }, note: ' ок ' }, { kpis, now: NOW }))
      .toEqual({ period: '2026-09', values: { revenue: 6_100_000, conversion: 9.5, leads: 280 }, note: 'ок' })
    const bad = (input: Parameters<typeof validateMonthlyFacts>[0], field: string) => {
      try { validateMonthlyFacts(input, { kpis, now: NOW }); throw new Error('accepted') } catch (e) {
        expect(e).toBeInstanceOf(PlanFactError)
        expect((e as InstanceType<typeof PlanFactError>).field).toBe(field)
      }
    }
    bad({ period: '2026-11', values: { revenue: 1 } }, 'period') // the future
    bad({ period: '2024-09', values: { revenue: 1 } }, 'period') // older than 24 months
    bad({ period: '09.2026', values: { revenue: 1 } }, 'period')
    bad({ period: '2026-09', values: { cash: 1 } }, 'cash') // not in this plan
    bad({ period: '2026-09', values: { conversion: 130 } }, 'conversion')
    bad({ period: '2026-09', values: { leads: 10.5 } }, 'leads')
    bad({ period: '2026-09', values: { revenue: 'много' } }, 'revenue')
    bad({ period: '2026-09', values: {} }, 'values')
    bad({ period: '2026-09', values: { revenue: 1 }, note: 'x'.repeat(501) }, 'note')
    expect(() => validateMonthlyFacts({ period: '2026-09', values: { revenue: 1 }, note: 'это хуйня' }, { kpis, now: NOW })).toThrow(ProfanityError)
  })

  it('saves facts with the source «ежемесячная сверка»; a second save updates; null clears', async () => {
    await facts({ revenue: 6_000_000, conversion: 9 })
    expect(db().pb_monthly_facts.map((r) => [r.metric, r.value, r.source, r.entered_role, r.entered_by, r.period])).toEqual([
      ['revenue', 6_000_000, 'monthly_reconciliation', 'owner', CLIENT, '2026-09'],
      ['conversion', 9, 'monthly_reconciliation', 'owner', CLIENT, '2026-09'],
    ])
    await saveMonthlyFacts(s.h!.sb, { companyId: COMPANY, period: '2026-09', values: { revenue: 6_200_000, conversion: null }, note: 'уточнил', enteredBy: EXPERT, role: 'expert' })
    expect(db().pb_monthly_facts.map((r) => [r.metric, r.value, r.entered_role, r.note])).toEqual([['revenue', 6_200_000, 'expert', 'уточнил']])
  })
})

describe('recomputeCompany', () => {
  it('writes the checkpoints of the last finished and the current month with plan · fact · forecast and the verdict', async () => {
    await facts({ revenue: 6_100_000, leads: 330, conversion: 10.5, avg_check: 143_000 })
    const r = await recomputeCompany(s.h!.sb, { companyId: COMPANY, userId: CLIENT, now: NOW, mode: 'checkpoint' })
    expect(r).toMatchObject({ status: 'done', period: '2026-09', overall: 'on_track', computedAt: NOW.toISOString() })
    const rows = db().pb_checkpoints
    expect(rows.map((c) => [c.period, c.overall, c.version_id, c.plan_id, c.company_id])).toEqual([
      ['2026-09', 'on_track', 'v-1', 'plan-1', COMPANY],
      ['2026-10', 'no_data', 'v-1', 'plan-1', COMPANY],
    ])
    expect(rows[0].planned).toMatchObject({ values: { revenue: 6_250_000, leads: 330, conversion: 10.75, avg_check: 143_500 } })
    expect(rows[0].actual).toMatchObject({ values: { revenue: 6_100_000, conversion: 10.5 }, sources: { revenue: 'reconciliation' } })
    expect(rows[0].forecast).toMatchObject({ goalAnnual: 120_000_000 })
    expect(typeof rows[0].inputs_hash).toBe('string')
    // checkpoint mode: no invites, no draft, no notification
    expect(db().pb_invites).toEqual([])
    expect(db().pb_plan_versions).toHaveLength(1)
    expect(s.staff).toEqual([])
  })

  it('an unchanged inputs hash is skipped; a new fact changes the hash', async () => {
    await facts({ revenue: 6_100_000 })
    expect((await recomputeCompany(s.h!.sb, { companyId: COMPANY, userId: CLIENT, now: NOW })).status).toBe('done')
    const writes = s.h!.writes.length
    const again = await recomputeCompany(s.h!.sb, { companyId: COMPANY, userId: CLIENT, now: NOW })
    expect(again).toMatchObject({ status: 'unchanged', period: '2026-09' })
    expect(s.h!.writes.length).toBe(writes) // nothing written
    // force recomputes anyway
    expect((await recomputeCompany(s.h!.sb, { companyId: COMPANY, userId: CLIENT, now: NOW, force: true, mode: 'checkpoint' })).status).toBe('done')
    await facts({ revenue: 6_300_000 })
    expect((await recomputeCompany(s.h!.sb, { companyId: COMPANY, userId: CLIENT, now: NOW, mode: 'checkpoint' })).status).toBe('done')
  })

  it('a material deviation: a DRAFT revision (never approved), the expert notified once, the deviation invite', async () => {
    await facts({ revenue: 4_000_000, leads: 250, conversion: 8 })
    const r = await recomputeCompany(s.h!.sb, { companyId: COMPANY, userId: CLIENT, now: NOW })
    expect(r.status).toBe('done')
    expect(r.overall).toBe('behind')
    expect(r.draft).toMatchObject({ created: true, version: 2 })
    const versions = db().pb_plan_versions
    expect(versions.map((v) => [v.version, v.status, v.author_kind, v.author_id])).toEqual([[1, 'approved', 'expert', EXPERT], [2, 'draft', 'system', null]])
    expect(String(versions[1].change_reason)).toMatch(/^Предложение пересмотра по план-факту \(2026-09\): Выручка 4 млн ₸ при плане 6,3 млн ₸; конверсия 8% при плане 10,8%\.$/)
    // the plan the client sees did not change
    expect(db().pb_plans[0]).toMatchObject({ published_version_id: 'v-1' })
    expect(versions[1].scenarios).toEqual(versions[0].scenarios) // a copy of the approved content
    expect(s.staff).toHaveLength(1)
    expect(s.staff[0]).toMatchObject({ type: 'point_b.plan_fact.deviation', audienceUserIds: [EXPERT], dedupeKey: `point_b.plan_fact.deviation:${COMPANY}:2026-09` })
    const rules = db().pb_invites.map((i) => i.rule_key)
    expect(rules).toContain('plan_deviation')
    expect(rules).toContain('checkpoint_due') // the milestone of 15.10 is within 14 days
    const dev = db().pb_invites.find((i) => i.rule_key === 'plan_deviation')!
    expect(dev).toMatchObject({ user_id: CLIENT, href: '/client/point-b?tab=history', dedupe_key: 'plan_deviation:2026-09:behind' })

    // the next run with other data: the open draft is reused, no second draft
    await facts({ revenue: 4_100_000 })
    const r2 = await recomputeCompany(s.h!.sb, { companyId: COMPANY, userId: CLIENT, now: NOW })
    expect(r2.draft).toMatchObject({ created: false, version: 2 })
    expect(db().pb_plan_versions).toHaveLength(2)
    expect(db().pb_plan_versions.every((v) => v.status !== 'approved' || v.id === 'v-1')).toBe(true)
  })

  it('one proposal per month: a system proposal of this month already handled is not repeated', async () => {
    seed({ versions: [approved({ id: 'v-2', version: 2 }), approved({ id: 'v-old', version: 1, status: 'superseded', author_kind: 'system', author_id: null, change_reason: 'Предложение пересмотра по план-факту (2026-09): …' })] })
    db().pb_plans[0].published_version_id = 'v-2'
    await facts({ revenue: 4_000_000, conversion: 8 })
    const r = await recomputeCompany(s.h!.sb, { companyId: COMPANY, userId: CLIENT, now: NOW })
    expect(r.overall).toBe('behind')
    expect(r.draft).toEqual({ created: false, versionId: null, version: null })
    expect(db().pb_plan_versions).toHaveLength(2)
  })

  it('recommendations whose data changed become stale (Ф6a mechanism); rejected ones stay', async () => {
    const base = { company_id: COMPANY, version_id: 'v-1', kind: 'lever', essence: '', reason: '', confidence: 'medium', source_refs: [], generated_by: 'rule' }
    await s.h!.sb.from('pb_recommendations').insert([
      { ...base, title: 'Старая проверенная', status: 'expert_verified', inputs_hash: 'old', reviewed_at: '2026-09-01T00:00:00Z' },
      { ...base, title: 'Отклонённая', status: 'expert_rejected', inputs_hash: 'old' },
    ])
    const r = await recomputeCompany(s.h!.sb, { companyId: COMPANY, userId: CLIENT, now: NOW })
    expect(r.staleRecs).toBe(1)
    expect(db().pb_recommendations.map((x) => [x.title, x.status])).toEqual([['Старая проверенная', 'stale'], ['Отклонённая', 'expert_rejected']])
  })

  it('without an approved plan nothing is written', async () => {
    seed({ plan: false })
    expect(await recomputeCompany(s.h!.sb, { companyId: COMPANY, userId: CLIENT, now: NOW })).toEqual({ companyId: COMPANY, status: 'no_plan' })
    seed({ versions: [approved({ status: 'draft', approved_at: null, approved_by: null })] })
    db().pb_plans[0].published_version_id = null
    expect((await recomputeCompany(s.h!.sb, { companyId: COMPANY, userId: CLIENT, now: NOW })).status).toBe('no_plan')
    expect(db().pb_checkpoints).toEqual([])
  })

  it('a failure is an outcome, never a throw', async () => {
    const broken = { from: () => { throw new Error('db down') } } as never
    expect(await recomputeCompany(broken, { companyId: COMPANY, userId: CLIENT, now: NOW })).toMatchObject({ status: 'failed', error: 'db down' })
  })

  it('the hash ignores the clock and follows the data', () => {
    const inputs = { now: 'a', template: 'default', history: [] } as never
    const h1 = planFactHash({ versionId: 'v', inputs, monthly: [], periods: ['2026-09'] })
    expect(planFactHash({ versionId: 'v', inputs: { ...(inputs as object), now: 'b' } as never, monthly: [], periods: ['2026-09'] })).toBe(h1)
    expect(planFactHash({ versionId: 'v', inputs, monthly: [{ period: '2026-09', metric: 'revenue', value: 1 } as never], periods: ['2026-09'] })).not.toBe(h1)
    expect(planFactHash({ versionId: 'v2', inputs, monthly: [], periods: ['2026-09'] })).not.toBe(h1)
  })
})

describe('the facts of a month and the plan-fact invite rules (pure)', async () => {
  const { mergeActuals, goalFacts, withReconciledHistory } = await import('@/lib/point-b/planfact/actuals')
  const { planFactCandidates } = await import('@/lib/point-b/planfact/insights')

  it('a manual Point A value wins, then the reconciliation, then the best other fact; a rescaled yearly revenue is a month again', () => {
    const fact = (metric_key: string, value: number, source_kind: string, flags: string[] = [], confidence = 0.8) => ({ metric_key, period_key: '2026-09', value, source_kind, flags, confidence })
    const monthly = [{ company_id: COMPANY, period: '2026-09', metric: 'leads', value: '310', source: 'monthly_reconciliation', entered_by: null, entered_role: 'owner', note: null }] as never
    const out = mergeActuals(['2026-09', '2026-10'], monthly, [
      fact(REVENUE, 72_000_000, 'document', ['rescaled']),
      fact(REVENUE, 5_500_000, 'integration'),
      fact('biz.marketing.lidov_v_mes', 290, 'survey'),
      fact('biz.marketing.konversiya_lid_klient', 11, 'manual'),
      fact('biz.prodazhi.sredniy_chek', 1, 'survey', ['invalid']),
    ])
    expect(out['2026-09']).toEqual({
      values: { revenue: 6_000_000, leads: 310, conversion: 11 },
      sources: { revenue: 'facts', leads: 'reconciliation', conversion: 'facts' },
    })
    expect(out['2026-10']).toEqual({ values: {}, sources: {} })
    expect(goalFacts(out)).toEqual({ [REVENUE]: { value: 72_000_000, period: '2026-09' }, 'biz.marketing.lidov_v_mes': { value: 310, period: '2026-09' }, 'biz.marketing.konversiya_lid_klient': { value: 11, period: '2026-09' } })
    expect(withReconciledHistory([{ period: '2026-08', revenue: 5e6 }], [{ period: '2026-09', metric: 'revenue', value: '6000000' }, { period: '2026-09', metric: 'leads', value: '5' }] as never))
      .toEqual([{ period: '2026-08', revenue: 5e6 }, { period: '2026-09', revenue: 6e6 }])
  })

  it('deviation: behind → priority 2, risk → 3, nothing on track; milestones within 14 days only', () => {
    const cp = (overall: string) => ({ period: '2026-09', overall, reason: 'Конверсия 8% при плане 10,8%.' }) as never
    const ms = (key: string, date: string) => ({ key, title: `Точка ${key}`, date, description: null, kpi: null })
    expect(planFactCandidates({ checkpoint: cp('behind'), milestones: [], now: NOW })).toEqual([expect.objectContaining({
      ruleKey: 'plan_deviation', dedupeKey: 'plan_deviation:2026-09:behind', priority: 2, title: 'Факт за сентябрь 2026 отстаёт от плана', href: '/client/point-b?tab=history',
    })])
    expect(planFactCandidates({ checkpoint: cp('risk'), milestones: [], now: NOW })[0]).toMatchObject({ priority: 3, dedupeKey: 'plan_deviation:2026-09:risk' })
    expect(planFactCandidates({ checkpoint: cp('on_track'), milestones: [], now: NOW })).toEqual([])
    expect(planFactCandidates({ checkpoint: cp('no_data'), milestones: [], now: NOW })).toEqual([])
    const due = planFactCandidates({ checkpoint: null, milestones: [ms('a', '2026-10-22'), ms('b', '2026-10-08'), ms('c', '2026-10-07'), ms('d', '2026-10-23')], now: NOW })
    expect(due.map((c) => c.dedupeKey)).toEqual(['checkpoint_due:a', 'checkpoint_due:b'])
  })
})
