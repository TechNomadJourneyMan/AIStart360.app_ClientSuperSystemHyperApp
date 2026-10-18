/**
 * Routes of the model (Point B plan Ф2, Task 7): the expert recalculates scenarios in a draft
 * (POST / PATCH …/versions/:id/scenarios) and the client reads the page state (GET /api/v1/point-b/state).
 * In-memory DB, real store / goals / model / routes. The clock is fixed at 2026-10-18.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { pbDb } from './_pbdb'

const REVENUE = 'biz.finansy.vyruchka_god'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const OTHER_CLIENT = 'cccccccc-0000-4000-8000-000000000002'
const EXPERT = 'eeeeeeee-0000-4000-8000-000000000001'
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const OTHER_COMPANY = 'company-2'
const NOW = new Date('2026-10-18T09:00:00Z')

const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  actor: { id: 'x', role: 'admin' as StaffRole, scope: 'all' as 'all' | 'assigned' },
  user: null as { id: string } | null,
  gate402: false,
  gateCalls: [] as Array<{ userId: string; feature: string; opts: unknown }>,
  audits: [] as Array<{ action: string; entityId?: string | null; metadata?: Record<string, unknown>; oldValue?: unknown; newValue?: unknown }>,
  breakPlanTables: false,
}))

/** The same DB; with `breakPlanTables` the plan tables answer «relation does not exist» (migration 125 not applied). */
const dbProxy = () => ({
  from: (t: string) => {
    if (s.breakPlanTables && (t === 'pb_plans' || t === 'pb_plan_versions')) {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq']) q[m] = () => q
      q.maybeSingle = async () => ({ data: null, error: { code: '42P01' } })
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '42P01' } }).then(res)
      return q
    }
    return s.h!.sb.from(t)
  },
})

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => dbProxy() }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) }, from: (t: string) => s.h!.sb.from(t) }),
}))
vi.mock('@/lib/access/gate', () => ({
  gateFeature: async (_sb: unknown, userId: string, feature: string, opts: unknown) => {
    s.gateCalls.push({ userId, feature, opts })
    return s.gate402 ? NextResponse.json({ ok: false, error: 'upgrade_required', feature }, { status: 402 }) : null
  },
}))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_actor: unknown, entry: { action: string; entityId?: string | null; metadata?: Record<string, unknown>; oldValue?: unknown; newValue?: unknown }) => { s.audits.push(entry); return true },
}))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const inner = makeRequireGiga(() => ({ id: s.actor.id, kind: 'session', role: s.actor.role }))
  return {
    requireGiga: async (req: unknown, p: Parameters<typeof inner>[1]) => {
      const g = await inner(req, p)
      return g.actor ? { actor: { ...g.actor, clientScope: s.actor.scope } } : g
    },
    forbidTarget: async () => null,
    staffMfaGate: async () => 'ok',
  }
})

const scenariosRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan/versions/[versionId]/scenarios/route')
const stateRoute = await import('@/app/api/v1/point-b/state/route')
const { loadModelForCompany } = await import('@/lib/point-b/model/load')

const body = (method: string, b?: unknown) =>
  new NextRequest('http://t/api', { method, body: b === undefined ? undefined : JSON.stringify(b), headers: { 'content-type': 'application/json', origin: 'http://t' } })
const vp = (id: string, versionId: string) => ({ params: { id, versionId } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() })
const db = () => s.h!.db
const as = (role: StaffRole, id = role === 'admin' ? ADMIN : EXPERT, scope: 'all' | 'assigned' = 'all') => { s.actor = { id, role, scope } }

const metric = (key: string, value: number) => ({ company_id: COMPANY, metric_key: key, metric_value: value, source: 'survey', period_year: 2026, computed_at: '2026-10-01T00:00:00Z' })
const block = (score: number) => ({ score, status: 'average', top_issues: [], recommendations: [] })

function seed(opts: { funnel?: boolean; goal?: boolean } = {}) {
  const funnel = opts.funnel !== false
  return pbDb({
    companies: [
      { id: COMPANY, user_id: CLIENT, name: 'Ромашка', industry: 'Интернет-магазин', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, created_at: '2026-01-01T00:00:00Z' },
      { id: OTHER_COMPANY, user_id: OTHER_CLIENT, name: 'Лютик', industry: null, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, created_at: '2026-01-01T00:00:00Z' },
    ],
    profiles: [
      { id: CLIENT, role: 'client', full_name: 'Клиент Один' },
      { id: OTHER_CLIENT, role: 'client', full_name: 'Клиент Два' },
      { id: EXPERT, role: 'expert', full_name: 'Алия Эксперт' },
      { id: ADMIN, role: 'admin', full_name: 'Админ Главный' },
    ],
    user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }, { user_id: OTHER_CLIENT, assignee_id: 'someone-else' }],
    metric_targets: opts.goal === false ? [] : [{
      id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 120_000_000, direction: 'higher_is_better',
      source: 'owner', deadline: null, label: null, note: null, baseline_value: 60_000_000, baseline_period: '2026', baseline_at: NOW.toISOString(), created_at: NOW.toISOString(),
    }],
    metrics: [
      metric(REVENUE, 60_000_000),
      ...(funnel ? [metric('biz.marketing.lidov_v_mes', 300), metric('biz.marketing.konversiya_lid_klient', 12), metric('biz.prodazhi.sredniy_chek', 140_000)] : []),
    ],
    diagnostics: [{
      id: 'diag-1', user_id: CLIENT, company_id: COMPANY, is_current: true, calculated_at: '2026-10-01T00:00:00Z',
      overall_score: 55, health_index: 50, stage: 'growth',
      finance_score: block(60), sales_score: block(50), operations_score: block(55), marketing_score: block(45), strategy_score: block(40),
    }],
    point_a_snapshots: [{ id: 'snap-1', company_id: COMPANY, engine: 'v4', confidence: 0.6, coverage: 0.7, created_at: '2026-10-10T00:00:00Z', blocks: [{ key: 'finance', score: 60 }], inputs: {} }],
    point_b_versions: [],
  })
}

const PLAN = { id: 'plan-1', company_id: COMPANY, user_id: CLIENT, current_version_id: null, published_version_id: null, settings: {}, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }
const goalsSnap = { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [{ metricKey: REVENUE, periodLabel: '12m', label: null, baselineValue: null, baselinePeriod: null, targetValue: 120_000_000, deadline: null, reviewStatus: 'verified' }] }
const versionRow = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', plan_id: 'plan-1', version: 1, status: 'draft', base_snapshot_id: null, goals: goalsSnap, assumptions: {}, scenarios: [], selected_scenario: null,
  strategy: {}, risks: [], expert_notes: null, change_reason: 'Первый план', author_id: EXPERT, author_name: 'Алия Эксперт', author_kind: 'expert',
  submitted_at: null, approved_by: null, approved_at: null, approval_exception: null, rejected_by: null, rejected_at: null, rejected_reason: null,
  created_at: '2026-10-09T00:00:00Z', ...over,
})
const fakeScenario = (label: string) => ({ key: 'moderate', label, feasible: true })

/** A plan with the given versions; `published` points the plan at the approved one. */
function withPlan(rows: Array<Record<string, unknown>>, published?: string) {
  db().pb_plans.push({ ...PLAN, published_version_id: published ?? null })
  for (const r of rows) db().pb_plan_versions.push(r)
}
const draft = () => withPlan([versionRow()])
const versions = () => db().pb_plan_versions as Array<Record<string, unknown>>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  s.h = seed()
  s.user = { id: CLIENT }
  s.gate402 = false
  s.gateCalls.length = 0
  s.audits.length = 0
  s.breakPlanTables = false
  as('admin')
})
afterEach(() => { vi.useRealTimers() })

const post = async (b: unknown = {}, user = CLIENT, versionId = 'v-1') => json(await scenariosRoute.POST(body('POST', b), vp(user, versionId)))
const patch = async (b: unknown, user = CLIENT, versionId = 'v-1') => json(await scenariosRoute.PATCH(body('PATCH', b), vp(user, versionId)))
const state = async () => json(await stateRoute.GET())

describe('POST …/scenarios', () => {
  it('POST scenarios stores results into the draft and returns the ModelResult', async () => {
    draft()
    s.h!.writes.length = 0
    const r = await post({})
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const result = r.body.data.result
    expect(result).toMatchObject({ modelVersion: 'pb-model-2', level: 1, kind: 'funnel', template: 'ecommerce' })
    // the golden of the funnel (base 60M, goal 120M in 12 months, 300 × 12% × 140 000): 18 / 12 / 6
    expect(result.scenarios.map((x: { timeToGoalMonths: { base: number } }) => x.timeToGoalMonths.base)).toEqual([18, 12, 6])
    expect(result.gap).toMatchObject({ baseAnnual: 60_000_000, targetAnnual: 120_000_000, months: 12 })
    expect(r.body.data.profiles.map((p: { key: string }) => p.key)).toEqual(['cautious', 'moderate', 'aggressive'])

    const row = versions()[0]
    expect(row.status).toBe('draft')
    expect(row.scenarios).toEqual(result.scenarios)
    expect(row.base_snapshot_id).toBe('snap-1')
    const assumptions = row.assumptions as { profiles: unknown[]; model: Record<string, unknown> }
    expect(assumptions.profiles).toHaveLength(3)
    expect(assumptions.model).toMatchObject({ modelVersion: 'pb-model-2', level: 1, kind: 'funnel', computedAt: NOW.toISOString() })
    expect(assumptions.model.scenarios).toBeUndefined() // the scenarios are in their own column
    // only the version was written
    expect(new Set(s.h!.writes.map((w) => w.table))).toEqual(new Set(['pb_plan_versions']))
    expect(s.audits.map((a) => a.action)).toEqual(['point_b.scenarios.computed'])
    expect(s.audits[0].metadata).toMatchObject({ version: 1, level: 1, kind: 'funnel', scenarios: 3, customProfiles: false })
  })

  it('the date of a goal kept by its label comes from the live goal (set 6 months ago → 6 months left)', async () => {
    draft()
    db().metric_targets[0].baseline_at = '2026-04-18T09:00:00Z'
    const r = await post({})
    expect(r.body.data.result.gap.months).toBe(6)
    // a goal without any date left is still a level-0 answer with a reason, not an error
    expect(r.status).toBe(200)
  })

  it('a client without a funnel gets the growth model; without a goal, level 0 with the empty scenarios stored', async () => {
    s.h = seed({ funnel: false })
    draft()
    const growth = await post({})
    expect(growth.body.data.result).toMatchObject({ level: 1, kind: 'growth' })
    expect(versions()[0].scenarios).toHaveLength(3)

    s.h = seed({ goal: false })
    draft()
    const none = await post({})
    expect(none.status).toBe(200)
    expect(none.body.data.result).toMatchObject({ level: 0, kind: 'none', scenarios: [] })
    expect(none.body.data.result.missing.map((m: { key: string }) => m.key)).toEqual(['goal'])
    expect(versions()[0].scenarios).toEqual([])
  })

  it('POST on an in_review or approved version → 409', async () => {
    draft()
    for (const status of ['in_review', 'approved', 'superseded']) {
      versions()[0].status = status
      const r = await post({})
      expect(r.status, status).toBe(409)
      expect(r.body.code).toBe('not_editable')
      expect(versions()[0].scenarios).toEqual([])
    }
  })

  it('expert of another client → 403, nothing written', async () => {
    withPlan([versionRow()])
    db().pb_plans.push({ ...PLAN, id: 'plan-2', company_id: OTHER_COMPANY, user_id: OTHER_CLIENT })
    db().pb_plan_versions.push(versionRow({ id: 'v-2', plan_id: 'plan-2' }))
    as('super_expert', EXPERT, 'assigned')
    const before = JSON.stringify(db().pb_plan_versions)
    expect((await post({}, OTHER_CLIENT, 'v-2')).status).toBe(403)
    expect((await patch({ selectedScenario: 'moderate' }, OTHER_CLIENT, 'v-2')).status).toBe(403)
    expect(JSON.stringify(db().pb_plan_versions)).toBe(before)
    expect(s.audits).toEqual([])
    // the own client works
    expect((await post({})).status).toBe(200)
  })

  it('a version of another client is not found under this client (404), a role without clients.review is refused', async () => {
    withPlan([versionRow()])
    db().pb_plans.push({ ...PLAN, id: 'plan-2', company_id: OTHER_COMPANY, user_id: OTHER_CLIENT })
    db().pb_plan_versions.push(versionRow({ id: 'v-2', plan_id: 'plan-2' }))
    expect((await post({}, CLIENT, 'v-2')).status).toBe(404)
    expect((await post({}, CLIENT, 'nope')).status).toBe(404)
    expect(db().pb_plan_versions.find((v) => v.id === 'v-2')!.scenarios).toEqual([])
    expect((await post({}, 'not-a-uuid')).status).toBe(400)
    as('analyst')
    expect((await post({})).status).toBe(403)
  })

  it('invalid profile (rampMonths 0) → 400 with the text, the draft is untouched', async () => {
    draft()
    const r = await post({ profiles: [{ key: 'moderate', rampMonths: 0 }] })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/Срок выхода рычагов.*от 1 до 36/)
    expect(r.body.code).toBe('invalid_profiles')
    expect(versions()[0].scenarios).toEqual([])
    expect(versions()[0].assumptions).toEqual({})
    for (const bad of [{ profiles: [{ key: 'turbo' }] }, { profiles: 'fast' }, { profiles: [{ key: 'cautious', leverMix: { leads: -1 } }] }]) {
      expect((await post(bad)).status).toBe(400)
    }
    expect((await post({ extra: 1 })).status).toBe(400) // unknown fields are refused
  })

  it('edited profiles are used, saved with the draft, and reused by the next recompute', async () => {
    draft()
    const first = await post({ profiles: [{ key: 'moderate', rampMonths: 9 }] })
    expect(first.status).toBe(200)
    expect(first.body.data.result.scenarios[1].timeToGoalMonths.base).toBe(9) // the plateau (= the goal) is reached in month 9
    expect(first.body.data.profiles[1].rampMonths).toBe(9)
    expect(s.audits[0].metadata).toMatchObject({ customProfiles: true })
    expect((versions()[0].assumptions as { profiles: Array<{ key: string; rampMonths: number }> }).profiles.find((p) => p.key === 'moderate')!.rampMonths).toBe(9)

    // a recompute without profiles (e.g. after the client changed the data) keeps the expert's edit
    const again = await post({})
    expect(again.body.data.result.scenarios[1].timeToGoalMonths.base).toBe(9)
    expect(again.body.data.profiles[1].rampMonths).toBe(9)
  })

  it('an empty body is a plain recompute', async () => {
    draft()
    const r = await scenariosRoute.POST(new NextRequest('http://t/api', { method: 'POST', headers: { origin: 'http://t' } }), vp(CLIENT, 'v-1'))
    expect(r.status).toBe(200)
  })

  it('the draft keeps its expert notes and goals snapshot (only scenarios, assumptions and the snapshot id change)', async () => {
    withPlan([versionRow({ expert_notes: 'Заметка', assumptions: { note: 'keep' }, selected_scenario: 'cautious' })])
    await post({})
    const row = versions()[0]
    expect(row.expert_notes).toBe('Заметка')
    expect(row.goals).toEqual(goalsSnap)
    expect(row.change_reason).toBe('Первый план')
    expect(row.selected_scenario).toBe('cautious')
    expect((row.assumptions as { note: string }).note).toBe('keep')
  })
})

describe('PATCH …/scenarios', () => {
  it('PATCH selectedScenario accepts only the three keys', async () => {
    draft()
    // nothing calculated yet
    const early = await patch({ selectedScenario: 'moderate' })
    expect(early.status).toBe(400)
    expect(early.body.code).toBe('not_calculated')
    await post({})

    for (const key of ['cautious', 'moderate', 'aggressive']) {
      const r = await patch({ selectedScenario: key })
      expect(r.status, key).toBe(200)
      expect(r.body.data).toEqual({ selectedScenario: key })
      expect(versions()[0].selected_scenario).toBe(key)
    }
    for (const bad of [{ selectedScenario: 'turbo' }, { selectedScenario: '' }, { selectedScenario: 3 }, {}, { selectedScenario: 'moderate', x: 1 }]) {
      expect((await patch(bad)).status, JSON.stringify(bad)).toBe(400)
    }
    expect(versions()[0].selected_scenario).toBe('aggressive')
    // clearing the choice is allowed
    expect((await patch({ selectedScenario: null })).status).toBe(200)
    expect(versions()[0].selected_scenario).toBeNull()
  })

  it('selecting is audited, and works only in a draft', async () => {
    draft()
    await post({})
    s.audits.length = 0
    await patch({ selectedScenario: 'moderate' })
    expect(s.audits).toHaveLength(1)
    expect(s.audits[0]).toMatchObject({ action: 'point_b.scenario.selected', entityId: 'v-1', oldValue: { selectedScenario: null }, newValue: { selectedScenario: 'moderate' } })
    versions()[0].status = 'in_review'
    const r = await patch({ selectedScenario: 'cautious' })
    expect(r.status).toBe(409)
    expect(versions()[0].selected_scenario).toBe('moderate')
  })

  it('only the scenarios that were calculated can be chosen', async () => {
    withPlan([versionRow({ scenarios: [{ ...fakeScenario('x'), key: 'moderate' }] })])
    expect((await patch({ selectedScenario: 'aggressive' })).status).toBe(400)
    expect((await patch({ selectedScenario: 'moderate' })).status).toBe(200)
  })
})

describe('GET /api/v1/point-b/state', () => {
  it('state: 401 without a session', async () => {
    s.user = null
    expect((await state()).status).toBe(401)
  })

  it('state: free tier with gates on → 402; the gate is the Pro feature «point_b», staff exempt', async () => {
    s.gate402 = true
    const r = await state()
    expect(r.status).toBe(402)
    expect(r.body.error).toBe('upgrade_required')
    expect(s.gateCalls).toEqual([{ userId: CLIENT, feature: 'point_b', opts: { exemptStaff: true } }])
  })

  it('state: the automatic overview is there even without a plan; the plan is «preparing», no scenarios', async () => {
    const r = await state()
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const d = r.body.data
    expect(d.access).toBe('ok')
    expect(d.overview.labelledAutomatic).toBe(true)
    expect(d.overview.result).toMatchObject({ modelVersion: 'pb-model-2', level: 1, kind: 'funnel', computedAt: NOW.toISOString() })
    expect(d.overview.result.gap).toMatchObject({ baseAnnual: 60_000_000, targetAnnual: 120_000_000 })
    // the goal is the owner's draft: the overview says so
    expect(d.overview.result.warnings.some((w: string) => /не проверена экспертом/.test(w))).toBe(true)
    expect(d.plan).toEqual({ status: 'preparing', version: null, selectedScenario: null, scenarios: [], approvedAt: null, authorName: null })
  })

  it('state: client sees scenarios only from the approved version (draft and in_review never leak)', async () => {
    // (a) only a draft with scenarios
    withPlan([versionRow({ scenarios: [fakeScenario('DRAFT-MARK')], selected_scenario: 'moderate', expert_notes: 'DRAFT-NOTES' })])
    let r = await state()
    expect(r.body.data.plan).toEqual({ status: 'preparing', version: null, selectedScenario: null, scenarios: [], approvedAt: null, authorName: null })
    expect(JSON.stringify(r.body)).not.toContain('DRAFT-MARK')

    // (b) a version in review
    versions()[0].status = 'in_review'
    r = await state()
    expect(r.body.data.plan.scenarios).toEqual([])
    expect(r.body.data.plan.status).toBe('preparing')
    expect(JSON.stringify(r.body)).not.toContain('DRAFT-MARK')

    // (c) an approved version and, above it, a newer draft: the client sees the approved one only
    db().pb_plans.length = 0
    versions().length = 0
    withPlan([
      versionRow({ id: 'v-1', version: 1, status: 'approved', scenarios: [fakeScenario('APPROVED-MARK')], selected_scenario: 'cautious', approved_at: '2026-10-11T00:00:00Z', author_name: 'Алия Эксперт' }),
      versionRow({ id: 'v-2', version: 2, status: 'draft', scenarios: [fakeScenario('DRAFT2-MARK')], selected_scenario: 'aggressive' }),
    ], 'v-1')
    r = await state()
    expect(r.body.data.plan).toEqual({
      status: 'published', version: 1, selectedScenario: 'cautious', approvedAt: '2026-10-11T00:00:00Z', authorName: 'Алия Эксперт',
      scenarios: [fakeScenario('APPROVED-MARK')],
    })
    expect(JSON.stringify(r.body)).not.toContain('DRAFT2-MARK')

    // (d) a newer version in review above the approved one
    versions()[1].status = 'in_review'
    r = await state()
    expect(JSON.stringify(r.body)).not.toContain('DRAFT2-MARK')
    expect(r.body.data.plan.version).toBe(1)
  })

  it('state: a superseded version is no longer shown, the author is a name and never an email', async () => {
    withPlan([
      versionRow({ id: 'v-1', version: 1, status: 'superseded', scenarios: [fakeScenario('OLD-MARK')] }),
      versionRow({ id: 'v-2', version: 2, status: 'approved', scenarios: [fakeScenario('NEW-MARK')], approved_at: '2026-10-12T00:00:00Z', author_name: 'expert@example.com' }),
    ], 'v-2')
    const r = await state()
    expect(JSON.stringify(r.body)).not.toContain('OLD-MARK')
    expect(r.body.data.plan.version).toBe(2)
    expect(r.body.data.plan.authorName).not.toContain('@')
    // junk in the stored scenarios is dropped, not passed to the page
    versions()[1].scenarios = [null, 5, 'x', { label: 'no key' }, fakeScenario('OK-MARK')]
    expect((await state()).body.data.plan.scenarios).toEqual([fakeScenario('OK-MARK')])
  })

  it('state: no company → level 0 result, plan none', async () => {
    db().companies.length = 0
    db().metric_targets.length = 0
    db().diagnostics.length = 0
    db().metrics.length = 0
    const r = await state()
    expect(r.status).toBe(200)
    expect(r.body.data.overview.result).toMatchObject({ level: 0, kind: 'none', scenarios: [] })
    expect(r.body.data.overview.result.missing.map((m: { key: string }) => m.key)).toEqual(['goal', 'revenue_base'])
    expect(r.body.data.plan).toEqual({ status: 'none', version: null, selectedScenario: null, scenarios: [], approvedAt: null, authorName: null })
  })

  it('state: a company without a goal is level 0 and asks for the goal; with a goal but no funnel it is the growth model', async () => {
    s.h = seed({ goal: false })
    let r = await state()
    expect(r.body.data.overview.result).toMatchObject({ level: 0 })
    expect(r.body.data.overview.result.missing[0]).toMatchObject({ key: 'goal', actions: ['survey', 'expert'] })
    s.h = seed({ funnel: false })
    r = await state()
    expect(r.body.data.overview.result).toMatchObject({ level: 1, kind: 'growth' })
  })

  it('state: a stale base shows the warning on the overview', async () => {
    db().metrics.find((m) => m.metric_key === REVENUE)!.period_year = 2024
    const r = await state()
    const result = r.body.data.overview.result
    expect(result.warnings[0]).toMatch(/База устарела/)
    expect(result.level).toBe(1)
  })

  it('state: the history of monthly facts gives the forecast and the verdict', async () => {
    for (let k = 0; k < 12; k++) {
      const idx = 2025 * 12 + 9 + k // 2025-10 … 2026-09
      db().metric_facts = db().metric_facts ?? []
      db().metric_facts.push({
        company_id: COMPANY, metric_key: REVENUE, period_key: `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`,
        value: Math.round(5_000_000 * 1.02 ** k), source_kind: 'integration', flags: [], confidence: 0.9,
      })
    }
    const r = await state()
    const result = r.body.data.overview.result
    expect(result.forecast.basis).toBe('history')
    expect(result.forecast.trendMonthlyPct).toBeCloseTo(2, 1)
    expect(result.verdict.key).toBe('behind')
  })

  it('state never writes', async () => {
    s.h!.writes.length = 0
    await state()
    withPlan([versionRow({ id: 'v-1', status: 'approved', scenarios: [fakeScenario('A')] }), versionRow({ id: 'v-2', version: 2, scenarios: [fakeScenario('B')] })], 'v-1')
    await state()
    s.h = seed({ goal: false })
    s.h.writes.length = 0
    await state()
    db().companies.length = 0
    await state()
    // Reading the page writes nothing but the analytics event of the view itself — never a plan, goal or review row.
    const writes = s.h.writes as Array<{ table: string; payload: unknown }>
    expect(writes.every((w) => (w.payload as { event_name?: string } | null)?.event_name === 'POINT_B_VIEWED')).toBe(true)
    expect(s.audits).toEqual([])
  })

  it('state: the client never sees the scenarios of the automatic calculation, only those of the approved version', async () => {
    withPlan([versionRow({ id: 'v-1', status: 'approved', scenarios: [fakeScenario('A')] })], 'v-1')
    const res = await state()
    expect(res.body.data.overview.result.scenarios).toEqual([])
    expect(res.body.data.plan.scenarios).toHaveLength(1)
  })

  it('state: plan tables that are not there (migration 125 not applied) mean «no plan», the overview still works', async () => {
    s.breakPlanTables = true
    const r = await state()
    expect(r.status).toBe(200)
    expect(r.body.data.overview.result.level).toBe(1)
    expect(r.body.data.plan.status).toBe('preparing')
    expect(r.body.data.plan.scenarios).toEqual([])
  })

  it('state: an unexpected failure is a 500 without internals', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    s.h = seed()
    ;(s.h.sb as unknown as { from: (t: string) => unknown }).from = () => { throw new Error('secret connection string') }
    const r = await state()
    expect(r.status).toBe(500)
    expect(JSON.stringify(r.body)).not.toContain('secret')
    spy.mockRestore()
  })
})

describe('loadModelForCompany', () => {
  it('builds ModelInputs from the stored data of the company', async () => {
    const { inputs, pb } = await loadModelForCompany(s.h!.sb, { userId: CLIENT, companyId: COMPANY, goals: goalsSnap as never, now: NOW })
    expect(pb.companyId).toBe(COMPANY)
    expect(inputs.template).toBe('ecommerce')
    expect(inputs.base.revenueYear.value).toBe(60_000_000)
    expect(inputs.levers.leads.value).toBe(300)
    expect(inputs.levers.conversion.value).toBeCloseTo(0.12, 12)
    expect(inputs.levers.avgCheck.value).toBe(140_000)
    expect(inputs.levers.activeBase).toMatchObject({ origin: 'derived' })
    expect(inputs.goal).toMatchObject({ targetAnnual: 120_000_000, months: 12, deadline: '2027-10-18', reviewStatus: 'verified' })
    expect(inputs.history).toEqual([])
    expect(inputs.now).toBe(NOW.toISOString())
  })

  it('without goals the goal is null; an unknown industry is the default template', async () => {
    db().companies[0].industry = 'Космический туризм'
    const { inputs } = await loadModelForCompany(s.h!.sb, { userId: CLIENT, companyId: COMPANY, goals: null, now: NOW })
    expect(inputs.goal).toBeNull()
    expect(inputs.template).toBe('default')
  })
})
