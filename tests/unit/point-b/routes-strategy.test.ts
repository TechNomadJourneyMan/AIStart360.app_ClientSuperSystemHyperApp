/**
 * Route that saves the strategy tree into a draft (Point B Ф5, task 4):
 * PUT /api/giga-admin/users/:id/point-b/plan/versions/:versionId/strategy.
 * In-memory DB, real store / validation / guards; the audit is a spy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  actor: { id: 'x', role: 'admin' as StaffRole, scope: 'all' as 'all' | 'assigned' },
  user: null as { id: string } | null,
  audits: [] as Array<{ action: string; entityId?: string | null; metadata?: Record<string, unknown>; oldValue?: unknown; newValue?: unknown; targetUserId?: string | null }>,
}))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.h!.sb }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) }, from: (t: string) => s.h!.sb.from(t) }),
}))
vi.mock('@/lib/access/gate', () => ({ gateFeature: async () => null as NextResponse | null }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: () => undefined }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_actor: unknown, entry: { action: string }) => { s.audits.push(entry as never); return true },
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

const strategyRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan/versions/[versionId]/strategy/route')
const planRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan/route')
const stateRoute = await import('@/app/api/v1/point-b/state/route')
const clientPlanRoute = await import('@/app/api/v1/point-b/plan/route')

const body = (method: string, b?: unknown) =>
  new NextRequest('http://t/api', { method, body: b === undefined ? undefined : JSON.stringify(b), headers: { 'content-type': 'application/json', origin: 'http://t' } })
const vp = (id: string, versionId: string) => ({ params: { id, versionId } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() })
const db = () => s.h!.db
const as = (role: StaffRole, id = role === 'admin' ? ADMIN : EXPERT, scope: 'all' | 'assigned' = 'all') => { s.actor = { id, role, scope } }
const versions = () => db().pb_plan_versions as Array<Record<string, unknown>>

const goalsSnap = { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [{ metricKey: REVENUE, periodLabel: '12m', label: null, baselineValue: null, baselinePeriod: null, targetValue: 100, deadline: null, reviewStatus: 'verified' }] }
const versionRow = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', plan_id: 'plan-1', version: 1, status: 'draft', base_snapshot_id: null, goals: goalsSnap, assumptions: {}, scenarios: [], selected_scenario: null,
  strategy: {}, risks: [], expert_notes: null, change_reason: 'Первый план', author_id: EXPERT, author_name: 'Алия Эксперт', author_kind: 'expert',
  submitted_at: null, approved_by: null, approved_at: null, approval_exception: null, rejected_by: null, rejected_at: null, rejected_reason: null,
  created_at: '2026-10-09T00:00:00Z', ...over,
})
const PLAN = { id: 'plan-1', company_id: COMPANY, user_id: CLIENT, current_version_id: null, published_version_id: null, settings: {}, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }

function withPlan(rows: Array<Record<string, unknown>>, published?: string) {
  db().pb_plans.push({ ...PLAN, published_version_id: published ?? null })
  for (const r of rows) db().pb_plan_versions.push(r)
}

const node = (kind: string, key: string, parentKey: string | null, over: Record<string, unknown> = {}) => ({
  key, kind, parentKey, title: `Узел ${key}`, description: null, ownerLabel: null, dueDate: null,
  impact: kind === 'task' ? null : 3, effort: kind === 'task' ? null : 3, metricId: null, block: null, kpi: null, dependsOn: [], delayRisk: null, order: 0, ...over,
})
const tree = () => ({
  items: [
    node('strategy', 'strat-0000001', null), node('initiative', 'init-00000001', 'strat-0000001'), node('initiative', 'init-00000002', 'strat-0000001'),
    node('task', 'task-00000001', 'init-00000001'), node('task', 'task-00000002', 'init-00000001'), node('task', 'task-00000003', 'init-00000002'),
  ],
  milestones: [{ key: 'mile-0000001', title: 'Запуск', date: '2026-12-01', description: null, kpi: null }],
})

const put = async (b: unknown, user = CLIENT, versionId = 'v-1') => json(await strategyRoute.PUT(body('PUT', b), vp(user, versionId)))

beforeEach(() => {
  s.h = pbDb({
    companies: [
      { id: COMPANY, user_id: CLIENT, name: 'Ромашка', industry: null, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, created_at: '2026-01-01T00:00:00Z' },
      { id: OTHER_COMPANY, user_id: OTHER_CLIENT, name: 'Лютик', industry: null, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, created_at: '2026-01-01T00:00:00Z' },
    ],
    profiles: [
      { id: CLIENT, role: 'client', full_name: 'Клиент Один' },
      { id: OTHER_CLIENT, role: 'client', full_name: 'Клиент Два' },
      { id: EXPERT, role: 'expert', full_name: 'Алия Эксперт' },
      { id: ADMIN, role: 'admin', full_name: 'Админ Главный' },
    ],
    user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }, { user_id: OTHER_CLIENT, assignee_id: 'someone-else' }],
    metric_targets: [],
    metrics: [],
    point_b_versions: [],
  })
  s.user = { id: CLIENT }
  s.audits.length = 0
  as('admin')
})

describe('PUT …/strategy', () => {
  it('PUT saves a valid strategy into the draft and audits the counts', async () => {
    withPlan([versionRow()])
    s.h!.writes.length = 0
    const r = await put({ strategy: tree() })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.data.strategy).toEqual(tree())
    expect(r.body.data.version).toMatchObject({ id: 'v-1', status: 'draft', version: 1 })
    expect(versions()[0].strategy).toEqual(tree())
    // only the version was written; the tasks are NOT created before the publication
    expect(new Set(s.h!.writes.map((w) => w.table))).toEqual(new Set(['pb_plan_versions']))
    expect(db().action_items).toHaveLength(0)
    expect(s.audits).toHaveLength(1)
    expect(s.audits[0]).toMatchObject({
      action: 'point_b.strategy.saved', entityId: 'v-1', targetUserId: CLIENT,
      oldValue: { strategies: 0, initiatives: 0, tasks: 0, milestones: 0 },
      newValue: { strategies: 1, initiatives: 2, tasks: 3, milestones: 1 },
      metadata: { version: 1, strategies: 1, initiatives: 2, tasks: 3, milestones: 1 },
    })
    // an expert of the client may do it too
    as('super_expert', EXPERT, 'assigned')
    expect((await put({ strategy: tree() })).status).toBe(200)
  })

  it('PUT replaces, not merges (a removed node is gone)', async () => {
    withPlan([versionRow({ strategy: tree() })])
    const smaller = { items: tree().items.slice(0, 2), milestones: [] }
    const r = await put({ strategy: smaller })
    expect(r.status).toBe(200)
    expect(versions()[0].strategy).toEqual(smaller)
    expect(s.audits[0]).toMatchObject({ oldValue: { tasks: 3, milestones: 1 }, newValue: { strategies: 1, initiatives: 1, tasks: 0, milestones: 0 } })
    // an empty strategy is valid and clears the tree
    expect((await put({ strategy: { items: [], milestones: [] } })).status).toBe(200)
    expect(versions()[0].strategy).toEqual({ items: [], milestones: [] })
  })

  it('invalid trees answer 400 with the field and write nothing', async () => {
    withPlan([versionRow({ strategy: tree() })])
    const before = JSON.stringify(versions())
    s.h!.writes.length = 0
    const cyc = tree()
    ;(cyc.items[1] as { dependsOn: string[] }).dependsOn = ['init-00000002']
    ;(cyc.items[2] as { dependsOn: string[] }).dependsOn = ['init-00000001']
    const cases: Array<[unknown, RegExp]> = [
      [{ strategy: { items: [{ ...tree().items[3], parentKey: null }], milestones: [] } }, /^items\[0\]\.parentKey$/],
      [{ strategy: { items: [{ ...tree().items[1], dependsOn: ['init-00000001'] }, tree().items[0]], milestones: [] } }, /^items\[\d\]\.(parentKey|dependsOn\[0\])$/],
      [{ strategy: cyc }, /^items\[[12]\]\.dependsOn\[0\]$/],
      [{ strategy: { items: [], milestones: [{ ...tree().milestones[0], date: '2026-02-30' }] } }, /^milestones\[0\]\.date$/],
      [{ strategy: { items: [{ ...tree().items[0], impact: 6 }], milestones: [] } }, /^items\[0\]\.impact$/],
      [{ strategy: 'x' }, /^strategy$/],
      [{ strategy: null }, /^strategy$/],
      [{}, /^strategy$/],
      [[], /^strategy$/],
    ]
    for (const [b, field] of cases) {
      const r = await put(b)
      expect(r.status, JSON.stringify(b)).toBe(400)
      expect(r.body).toMatchObject({ ok: false, code: 'invalid_strategy' })
      expect(r.body.field).toMatch(field)
      expect(typeof r.body.error).toBe('string')
    }
    expect((await json(await strategyRoute.PUT(new NextRequest('http://t/api', { method: 'PUT', headers: { origin: 'http://t' } }), vp(CLIENT, 'v-1')))).status).toBe(400)
    expect(JSON.stringify(versions())).toBe(before)
    expect(s.h!.writes).toEqual([])
    expect(s.audits).toEqual([])
  })

  it('profanity → 400 with the field', async () => {
    withPlan([versionRow()])
    const t = tree()
    t.items[3].title = 'ты хуй'
    const r = await put({ strategy: t })
    expect(r.status).toBe(400)
    expect(r.body).toMatchObject({ ok: false, code: 'profanity', field: 'items[3].title' })
    expect(r.body.error).toMatch(/нецензурн/)
    const m = tree()
    m.milestones[0].title = 'бляха муха пиздец'
    expect((await put({ strategy: m })).body).toMatchObject({ code: 'profanity', field: 'milestones[0].title' })
    expect(versions()[0].strategy).toEqual({})
    expect(s.audits).toEqual([])
  })

  it('in_review or approved version → 409, nothing changes', async () => {
    withPlan([versionRow()])
    for (const status of ['in_review', 'approved', 'superseded']) {
      versions()[0].status = status
      const r = await put({ strategy: tree() })
      expect(r.status, status).toBe(409)
      expect(r.body).toMatchObject({ ok: false, code: 'not_editable' })
      expect(versions()[0].strategy).toEqual({})
    }
    expect(s.audits).toEqual([])
    // the status is checked before the content: an invalid tree for a frozen version is still 409
    versions()[0].status = 'approved'
    expect((await put({})).status).toBe(400) // a malformed request is refused first
    expect((await put({ strategy: { items: 'x' } })).status).toBe(409)
  })

  it('expert of another client → 403; version of another client → 404', async () => {
    withPlan([versionRow()])
    db().pb_plans.push({ ...PLAN, id: 'plan-2', company_id: OTHER_COMPANY, user_id: OTHER_CLIENT })
    db().pb_plan_versions.push(versionRow({ id: 'v-2', plan_id: 'plan-2' }))
    as('super_expert', EXPERT, 'assigned')
    const before = JSON.stringify(versions())
    expect((await put({ strategy: tree() }, OTHER_CLIENT, 'v-2')).status).toBe(403)
    expect(JSON.stringify(versions())).toBe(before)
    expect(s.audits).toEqual([])

    as('admin')
    // v-2 belongs to the other client's plan: under this client it does not exist
    expect((await put({ strategy: tree() }, CLIENT, 'v-2')).status).toBe(404)
    expect((await put({ strategy: tree() }, CLIENT, 'nope')).status).toBe(404)
    expect(versions().find((v) => v.id === 'v-2')!.strategy).toEqual({})
    expect((await put({ strategy: tree() }, 'not-a-uuid')).status).toBe(400)
    as('analyst')
    expect((await put({ strategy: tree() })).status).toBe(403)
    expect(versions()[0].strategy).toEqual({})
  })

  it('a client without a company has no version → 404', async () => {
    withPlan([versionRow()])
    db().companies.length = 0
    expect((await put({ strategy: tree() })).status).toBe(404)
  })
})

describe('who reads the strategy of a draft', () => {
  const MARK = 'DRAFT-STRATEGY-MARK'

  it('GET plan returns the draft strategy to staff only', async () => {
    const t = tree()
    t.items[0].title = MARK
    withPlan([versionRow({ strategy: t })])

    // staff (an admin and the assigned expert) see it in the bundle
    for (const role of ['admin', 'super_expert'] as StaffRole[]) {
      as(role, role === 'admin' ? ADMIN : EXPERT, role === 'admin' ? 'all' : 'assigned')
      const r = await json(await planRoute.GET(new NextRequest('http://t/api'), { params: { id: CLIENT } }))
      expect(r.status).toBe(200)
      expect(r.body.data.open.strategy.items[0].title).toBe(MARK)
      expect(r.body.data.versions[0].strategy.items[0].title).toBe(MARK)
    }
    // a role without clients.review and an expert of another client get nothing
    as('analyst')
    const denied = await json(await planRoute.GET(new NextRequest('http://t/api'), { params: { id: CLIENT } }))
    expect(denied.status).toBe(403)
    expect(JSON.stringify(denied.body)).not.toContain(MARK)
    as('super_expert', EXPERT, 'assigned')
    db().pb_plans.push({ ...PLAN, id: 'plan-2', company_id: OTHER_COMPANY, user_id: OTHER_CLIENT })
    const foreign = await json(await planRoute.GET(new NextRequest('http://t/api'), { params: { id: OTHER_CLIENT } }))
    expect(foreign.status).toBe(403)

    // the client never gets the draft: neither the page state nor the client plan view
    s.user = { id: CLIENT }
    const state = await json(await stateRoute.GET())
    expect(state.status, JSON.stringify(state.body)).toBe(200)
    expect(state.body.data.plan.strategy).toBeNull()
    expect(JSON.stringify(state.body)).not.toContain(MARK)
    const view = await json(await clientPlanRoute.GET())
    expect(JSON.stringify(view.body)).not.toContain(MARK)
  })

  it('after the approval the client sees the strategy of the approved version, not of a newer draft', async () => {
    const approved = tree()
    approved.items[0].title = 'APPROVED-STRATEGY'
    const newer = tree()
    newer.items[0].title = MARK
    withPlan([
      versionRow({ id: 'v-1', version: 1, status: 'approved', strategy: approved, approved_at: '2026-10-11T00:00:00Z' }),
      versionRow({ id: 'v-2', version: 2, status: 'draft', strategy: newer }),
    ], 'v-1')
    const state = await json(await stateRoute.GET())
    expect(state.body.data.plan.strategy.items[0].title).toBe('APPROVED-STRATEGY')
    expect(JSON.stringify(state.body)).not.toContain(MARK)
    // and the draft is still editable
    expect((await put({ strategy: tree() }, CLIENT, 'v-2')).status).toBe(200)
    expect((await put({ strategy: tree() }, CLIENT, 'v-1')).status).toBe(409)
  })
})
