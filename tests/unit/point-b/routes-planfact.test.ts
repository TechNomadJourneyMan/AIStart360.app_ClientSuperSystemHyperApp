/**
 * Point B Ф6b, Task 5: the plan-fact routes — the staff button «Пересчитать» (GIGA and the expert portal), the staff
 * plan-fact view, «Факт за месяц» of the client and of the expert, the reconciliation list, and the plan-fact in the
 * client's page state. Who may: a client never reaches the staff routes (401 / 403), a free client gets 402 where
 * Point B is PRO-gated, «от имени» is read-only, an expert only his clients. In-memory DB with the real column names
 * (public.companies has camelCase timestamps); notifications and the rate store mocked — no network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import type { ScenarioResult } from '@/lib/point-b/model/types'
import { pbDb } from './_pbdb'

const REVENUE = 'biz.finansy.vyruchka_god'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const OTHER_CLIENT = 'cccccccc-0000-4000-8000-000000000002'
const EXPERT = 'eeeeeeee-0000-4000-8000-000000000001'
const EXPERT2 = 'eeeeeeee-0000-4000-8000-000000000002'
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const OTHER_COMPANY = 'company-2'
const NOW = new Date('2026-10-22T09:00:00Z')

const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  actor: null as { id: string; role: StaffRole; scope: 'all' | 'assigned' } | null,
  expert: null as { id: string; role: string; email: string | null } | null,
  expertBlock: 'forbidden' as 'forbidden' | 'unauthenticated',
  user: null as { id: string } | null,
  impersonating: false,
  gate402: false,
  limited: new Set<string>(),
  audits: [] as Array<{ action: string; entityType?: string; entityId?: string | null; metadata?: Record<string, unknown>; targetUserId?: string | null }>,
  staff: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.h!.sb }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) }, from: (t: string) => s.h!.sb.from(t) }),
}))
vi.mock('@/lib/access/gate', () => ({
  gateFeature: async () => (s.gate402 ? NextResponse.json({ ok: false, error: 'upgrade_required' }, { status: 402 }) : null),
}))
vi.mock('@/lib/settings/system-settings', () => ({ getAccessGatesEnabled: async () => false }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (k: string) => (k === 'pb_verdict_tolerances' ? { on_track_pct: 5, risk_pct: 15 } : '0 22 * * 1,4') }))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => (s.impersonating ? { sid: 's', uid: CLIENT } : null) }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: () => undefined }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_actor: unknown, entry: { action: string }) => { s.audits.push(entry as never); return true },
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: vi.fn(async (_id: string, bucket: string) => s.limited.has(bucket)) }))
vi.mock('@/lib/notifications/notify', () => ({ notifyClient: async () => ({ ok: true, delivered: { inApp: true, email: false, telegram: false } }) }))
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: async (n: Record<string, unknown>) => { s.staff.push(n); return { eventId: 'e', duplicate: false, deliveries: [] } } }))
vi.mock('@/lib/notifications/store', () => ({ getRecipient: async () => null, claimSend: async () => ({ result: 'claimed', id: 'c' }), releaseSend: async () => undefined }))
vi.mock('@/lib/point-b/plan/notify', () => ({
  notifyPlanSubmitted: async () => undefined, notifyPlanApproved: async () => undefined, notifyGoalCorrection: async () => undefined,
  notifyGoalNeedsReview: async () => undefined, notifyGoalResponded: async () => undefined,
  POINT_B_STAFF_PERMISSION: 'clients.review', pointBStaffLink: (id: string) => `/admin-giga-panel/users/${id}?tab=point-b`,
}))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const inner = makeRequireGiga(() => (s.actor ? { id: s.actor.id, kind: 'session', role: s.actor.role } : null))
  return {
    requireGiga: async (req: unknown, p: Parameters<typeof inner>[1]) => {
      const g = await inner(req, p)
      return g.actor ? { actor: { ...g.actor, clientScope: s.actor!.scope } } : g
    },
    forbidTarget: async () => null,
    staffMfaGate: async () => 'ok',
  }
})
vi.mock('@/lib/expert-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/expert-auth')>()),
  resolveExpert: async () => (s.expert ? { ok: true, viewer: s.expert } : { ok: false, block: s.expertBlock }),
}))

const recomputeRoute = await import('@/app/api/giga-admin/users/[id]/point-b/recompute/route')
const planFactRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan-fact/route')
const expertRoute = await import('@/app/api/expert/clients/[id]/point-b/plan-fact/route')
const clientFactsRoute = await import('@/app/api/v1/point-b/monthly-facts/route')
const reconciliationRoute = await import('@/app/api/giga-admin/point-b/reconciliation/route')
const stateRoute = await import('@/app/api/v1/point-b/state/route')

const req = (method: string, b?: unknown, url = 'http://t/api') =>
  new NextRequest(url, { method, body: b === undefined ? undefined : JSON.stringify(b), headers: { 'content-type': 'application/json', origin: 'http://t' } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() })
const db = () => s.h!.db
const staffAs = (role: StaffRole, id = role === 'admin' ? ADMIN : EXPERT, scope: 'all' | 'assigned' = 'all') => { s.actor = { id, role, scope } }

function scenario(): ScenarioResult {
  return {
    key: 'moderate', label: 'Умеренный', feasible: true, infeasibleReason: null,
    timeToGoalMonths: { low: 14, base: 12, high: 10 }, revenueAtDeadline: { low: 1e8, base: 1.2e8, high: 1.3e8 },
    requiredUplift: [
      { lever: 'leads', label: 'Лиды в месяц', current: 300, target: 420, upliftPct: 40 },
      { lever: 'conversion', label: 'Конверсия лида в клиента', current: 0.1, target: 0.13, upliftPct: 30 },
    ],
    investments: { marketingMonthlyIncrease: null, totalOverRamp: null, staffNeed: null, note: '' },
    constraints: [], risks: [], conditions: [], downside: '', reviewPoints: [], signsToChangePace: [], assumptions: [],
    trajectory: Array.from({ length: 13 }, (_, m) => ({ month: m, low: (60 + 5 * m) * 0.9e6, base: (60 + 5 * m) * 1e6, high: (60 + 5 * m) * 1.1e6 })),
  }
}
const goalsSnap = { primary: { metricKey: REVENUE, periodLabel: '12m' }, items: [{ metricKey: REVENUE, periodLabel: '12m', label: 'Удвоить выручку', baselineValue: 60_000_000, baselinePeriod: '2026', targetValue: 120_000_000, deadline: null, reviewStatus: 'verified' }] }
const version = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', plan_id: 'plan-1', version: 1, status: 'approved', base_snapshot_id: null, goals: goalsSnap,
  assumptions: { model: { computedAt: '2026-06-10T00:00:00Z' } }, scenarios: [scenario()], selected_scenario: 'moderate', strategy: {}, risks: [],
  expert_notes: null, change_reason: 'Первый план', author_id: EXPERT, author_name: 'Алия Эксперт', author_kind: 'expert', submitted_at: '2026-06-12T00:00:00Z',
  approved_by: ADMIN, approved_at: '2026-06-15T00:00:00Z', approval_exception: null, rejected_by: null, rejected_at: null, rejected_reason: null,
  created_at: '2026-06-10T00:00:00Z', ...over,
})
const metric = (company: string, key: string, value: number) => ({ company_id: company, metric_key: key, metric_value: value, source: 'survey', period_year: 2026, computed_at: '2026-10-01T00:00:00Z' })

function seed(opts: { plan?: boolean } = {}) {
  s.h = pbDb({
    companies: [
      { id: COMPANY, user_id: CLIENT, name: 'Ромашка', industry: 'Интернет-магазин', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: OTHER_COMPANY, user_id: OTHER_CLIENT, name: 'Лютик', industry: null, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
    ],
    profiles: [
      { id: CLIENT, role: 'client', full_name: 'Клиент Один', email: 'one@example.com', tier: 'pro', feature_flags: {}, expert_title: null },
      { id: OTHER_CLIENT, role: 'client', full_name: 'Клиент Два', email: 'two@example.com', tier: 'pro', feature_flags: {}, expert_title: null },
      { id: EXPERT, role: 'expert', full_name: 'Алия Эксперт', email: 'aliya@example.com', expert_title: null },
      { id: ADMIN, role: 'admin', full_name: 'Админ Главный', email: 'admin@example.com', expert_title: null },
    ],
    user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }, { user_id: OTHER_CLIENT, assignee_id: EXPERT2 }],
    metric_targets: [{
      id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 120_000_000, direction: 'higher_is_better',
      source: 'owner', deadline: null, label: 'Удвоить выручку', note: null, baseline_value: 60_000_000, baseline_period: '2026', baseline_at: '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z',
    }],
    pb_goal_reviews: [{ id: 'gr-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', status: 'verified', proposed_value: 120_000_000, created_at: '2026-06-10T00:00:00Z' }],
    metrics: [metric(COMPANY, REVENUE, 60_000_000), metric(COMPANY, 'biz.marketing.lidov_v_mes', 300), metric(COMPANY, 'biz.marketing.konversiya_lid_klient', 10), metric(COMPANY, 'biz.prodazhi.sredniy_chek', 140_000)],
    diagnostics: [], point_a_snapshots: [], point_b_versions: [], staff_tasks: [],
    pb_plans: opts.plan === false ? [] : [
      { id: 'plan-1', company_id: COMPANY, user_id: CLIENT, current_version_id: 'v-2', published_version_id: 'v-1', settings: {}, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' },
      { id: 'plan-2', company_id: OTHER_COMPANY, user_id: OTHER_CLIENT, current_version_id: 'w-1', published_version_id: 'w-1', settings: {}, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' },
    ],
    pb_plan_versions: opts.plan === false ? [] : [
      version(),
      version({ id: 'v-2', version: 2, status: 'draft', approved_by: null, approved_at: null, change_reason: 'Черновик эксперта', scenarios: [] }),
      version({ id: 'w-1', plan_id: 'plan-2' }),
    ],
  })
}

const recompute = async (user = CLIENT) => json(await recomputeRoute.POST(req('POST'), { params: { id: user } }))
const clientFacts = async (b: unknown) => json(await clientFactsRoute.PUT(req('PUT', b)))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  seed()
  s.actor = null
  s.expert = null
  s.expertBlock = 'forbidden'
  s.user = { id: CLIENT }
  s.impersonating = false
  s.gate402 = false
  s.limited.clear()
  s.audits.length = 0
  s.staff.length = 0
  return () => vi.useRealTimers()
})

describe('the staff button «Пересчитать» (GIGA)', () => {
  it('a client (no staff role) and a role without clients.review are refused; nothing is written', async () => {
    expect((await recompute()).status).toBe(403)
    staffAs('support' as StaffRole, 'ffffffff-0000-4000-8000-000000000001')
    expect((await recompute()).status).toBe(403)
    expect(db().pb_checkpoints).toEqual([])
    expect(db().pb_runs).toEqual([])
  })

  it('an expert limited to his clients cannot recompute another expert’s client', async () => {
    staffAs('super_expert', EXPERT, 'assigned')
    expect((await recompute(OTHER_CLIENT)).status).toBe(403)
  })

  it('recomputes now, journals a manual run with who asked, audits; a second press within 10 minutes → 429', async () => {
    staffAs('super_expert', EXPERT, 'assigned')
    const r = await recompute()
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data).toMatchObject({ status: 'done', period: '2026-09', overall: 'no_data', computedAt: NOW.toISOString() })
    expect(r.body.data).not.toHaveProperty('companyId')
    expect(db().pb_checkpoints.map((c) => c.period)).toEqual(['2026-09', '2026-10'])
    expect(db().pb_runs).toEqual([expect.objectContaining({ kind: 'manual', company_id: COMPANY, triggered_by: EXPERT, status: 'done', companies: 1 })])
    expect(s.audits).toEqual([expect.objectContaining({ action: 'point_b.recomputed', entityType: 'company', entityId: COMPANY, targetUserId: CLIENT })])
    // never approves: the draft stays a draft, the published version stays
    expect(db().pb_plan_versions.map((v) => [v.id, v.status])).toEqual([['v-1', 'approved'], ['v-2', 'draft'], ['w-1', 'approved']])

    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000))
    const again = await recompute()
    expect(again.status).toBe(429)
    expect(again.body).toMatchObject({ code: 'rate_limited', retryAt: '2026-10-22T09:10:00.000Z' })
    vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000))
    expect((await recompute()).status).toBe(200)
  })

  it('the shared rate store also stops a second press; a client without a plan → no_plan', async () => {
    staffAs('admin')
    s.limited.add('pb-recompute')
    expect((await recompute()).status).toBe(429)
    s.limited.clear()
    seed({ plan: false })
    const r = await recompute()
    expect(r.body.data).toEqual({ status: 'no_plan' })
  })
})

describe('the staff plan-fact view and «Факт за месяц» of the expert (GIGA)', () => {
  it('GET: every version with its content for the staff, the runs; a client is refused', async () => {
    expect((await json(await planFactRoute.GET(req('GET'), { params: { id: CLIENT } }))).status).toBe(403)
    staffAs('admin')
    const r = await json(await planFactRoute.GET(req('GET'), { params: { id: CLIENT } }))
    expect(r.status).toBe(200)
    expect(r.body.data.published).toBe(true)
    expect(r.body.data.planFact.versions.map((v: { id: string; status: string }) => [v.id, v.status])).toEqual([['v-2', 'draft'], ['v-1', 'approved']])
    expect(r.body.data.planFact.versions[1]).toMatchObject({ approverName: 'Админ Главный', pace: { key: 'moderate' } })
    expect(r.body.data.planFact.kpis).toEqual(['revenue', 'leads', 'conversion'])
    expect(r.body.data.runs).toEqual([])
  })

  it('PUT: saved as the expert with the source «ежемесячная сверка», checkpoints recalculated; 400 / 409', async () => {
    staffAs('super_expert', EXPERT, 'assigned')
    const put = async (b: unknown) => json(await planFactRoute.PUT(req('PUT', b), { params: { id: CLIENT } }))
    const r = await put({ period: '2026-09', values: { revenue: 6_000_000, conversion: 8 } })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data).toMatchObject({ period: '2026-09', saved: ['revenue', 'conversion'], checkpoint: { status: 'done', overall: 'behind' } })
    expect(db().pb_monthly_facts.every((f) => f.entered_role === 'expert' && f.entered_by === EXPERT && f.source === 'monthly_reconciliation')).toBe(true)
    expect(db().pb_checkpoints.find((c) => c.period === '2026-09')).toMatchObject({ overall: 'behind' })
    // checkpoints only: no draft, no invites from a saved fact
    expect(db().pb_plan_versions).toHaveLength(3)
    expect(s.audits.at(-1)).toMatchObject({ action: 'point_b.monthly_facts.saved', metadata: { period: '2026-09', via: 'giga' } })
    expect((await put({ period: '2026-09', values: { cash: 1 } }))).toMatchObject({ status: 400, body: { code: 'invalid', field: 'cash' } })
    expect((await put({ period: '2026-09', values: { revenue: 1 }, note: 'полная херня' }))).toMatchObject({ status: 400, body: { code: 'profanity', field: 'note' } })
    seed({ plan: false })
    expect((await put({ period: '2026-09', values: { revenue: 1 } }))).toMatchObject({ status: 409, body: { code: 'no_plan' } })
  })
})

describe('the expert portal', () => {
  const get = async (user = CLIENT) => json(await expertRoute.GET(req('GET'), { params: { id: user } }))
  const post = async (b: unknown, user = CLIENT) => json(await expertRoute.POST(req('POST', b), { params: { id: user } }))
  const put = async (b: unknown, user = CLIENT) => json(await expertRoute.PUT(req('PUT', b), { params: { id: user } }))

  it('a client session → 403, no session → 401', async () => {
    expect((await post({ action: 'recompute' })).status).toBe(403)
    s.expertBlock = 'unauthenticated'
    expect((await post({ action: 'recompute' })).status).toBe(401)
    expect((await get()).status).toBe(401)
    expect(db().pb_runs).toEqual([])
  })

  it('the assigned expert recomputes and enters facts; another expert’s client → 403', async () => {
    s.expert = { id: EXPERT, role: 'expert', email: 'aliya@example.com' }
    expect((await post({ action: 'nope' })).status).toBe(400)
    const r = await post({ action: 'recompute' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data.status).toBe('done')
    expect(s.audits.at(-1)).toMatchObject({ action: 'point_b.recomputed', targetUserId: CLIENT, metadata: { via: 'expert-portal' } })
    expect((await post({ action: 'recompute' })).status).toBe(429)
    const f = await put({ period: '2026-09', values: { leads: 310 } })
    expect(f.status, JSON.stringify(f.body)).toBe(200)
    expect(db().pb_monthly_facts[0]).toMatchObject({ metric: 'leads', entered_role: 'expert', entered_by: EXPERT })
    expect((await get()).body.data.planFact.reconciliation).toMatchObject({ period: '2026-09', done: true, values: { leads: 310 } })
    expect((await post({ action: 'recompute' }, OTHER_CLIENT)).status).toBe(403)
    expect((await put({ period: '2026-09', values: { leads: 1 } }, OTHER_CLIENT)).status).toBe(403)
  })
})

describe('«Факт за месяц» of the client', () => {
  it('401 without a session, 403 «от имени», 402 for a free client while the gates are on', async () => {
    s.user = null
    expect((await clientFacts({ period: '2026-09', values: { revenue: 1 } })).status).toBe(401)
    s.user = { id: CLIENT }
    s.impersonating = true
    expect((await clientFacts({ period: '2026-09', values: { revenue: 1 } })).status).toBe(403)
    s.impersonating = false
    s.gate402 = true
    expect((await clientFacts({ period: '2026-09', values: { revenue: 1 } })).status).toBe(402)
    expect(db().pb_monthly_facts).toEqual([])
  })

  it('saves the owner’s facts of HIS company with the source «ежемесячная сверка» and refreshes the checkpoints', async () => {
    const r = await clientFacts({ period: '2026-09', values: { revenue: '6 300 000', leads: 330, conversion: '10,8' }, note: 'Сентябрь закрыли' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.data).toMatchObject({ period: '2026-09', saved: ['revenue', 'leads', 'conversion'], checkpoint: { status: 'done', overall: 'on_track' } })
    expect(db().pb_monthly_facts.map((f) => [f.company_id, f.metric, f.value, f.source, f.entered_role, f.entered_by, f.note])).toEqual([
      [COMPANY, 'revenue', 6_300_000, 'monthly_reconciliation', 'owner', CLIENT, 'Сентябрь закрыли'],
      [COMPANY, 'leads', 330, 'monthly_reconciliation', 'owner', CLIENT, 'Сентябрь закрыли'],
      [COMPANY, 'conversion', 10.8, 'monthly_reconciliation', 'owner', CLIENT, 'Сентябрь закрыли'],
    ])
    // the page state now carries the plan-fact: the verdict, the progress, the form's month filled
    const st = await json(await stateRoute.GET())
    const pf = st.body.data.planFact
    expect(pf.current).toMatchObject({ period: '2026-09', overall: 'on_track' })
    expect(pf.kpis).toEqual(['revenue', 'leads', 'conversion'])
    expect(pf.reconciliation).toMatchObject({ period: '2026-09', done: true })
    expect(pf.progress[0]).toMatchObject({ metricKey: REVENUE, fact: 75_600_000, factPeriod: '2026-09', target: 120_000_000 })
    expect(pf.staleDays).toBe(0)
    // the client sees the approved version only — never the draft
    expect(pf.versions.map((v: { id: string }) => v.id)).toEqual(['v-1'])
    expect(JSON.stringify(st.body)).not.toContain('Черновик эксперта')
  })

  it('validation: KPIs outside the plan, the future, profanity; no approved plan → 409', async () => {
    expect(await clientFacts({ period: '2026-09', values: { cash: 5 } })).toMatchObject({ status: 400, body: { field: 'cash' } })
    expect(await clientFacts({ period: '2026-12', values: { revenue: 5 } })).toMatchObject({ status: 400, body: { field: 'period' } })
    expect(await clientFacts({ period: '2026-09', values: { revenue: 5 }, note: 'бля' })).toMatchObject({ status: 400, body: { code: 'profanity', field: 'note' } })
    expect((await clientFacts(null)).status).toBe(400)
    seed({ plan: false })
    expect(await clientFacts({ period: '2026-09', values: { revenue: 5 } })).toMatchObject({ status: 409, body: { code: 'no_plan' } })
  })

  it('a superseded version reaches the client as metadata only', async () => {
    db().pb_plan_versions[0].status = 'superseded'
    db().pb_plan_versions.push(version({ id: 'v-3', version: 3, status: 'approved', change_reason: 'Снизили темп', author_name: 'expert@example.com', scenarios: [{ ...scenario(), label: 'NEW-PACE' }] }))
    db().pb_plans[0].published_version_id = 'v-3'
    const pf = (await json(await stateRoute.GET())).body.data.planFact
    expect(pf.versions.map((v: { id: string; contentHidden?: boolean }) => [v.id, !!v.contentHidden])).toEqual([['v-3', false], ['v-1', true]])
    expect(pf.versions[1]).toMatchObject({ changeReason: 'Первый план', goals: [], pace: null, strategy: [] })
    expect(pf.versions[0].authorName).toBe('Эксперт AIStart360') // a name, never an email
  })
})

describe('the reconciliation list of the staff', () => {
  it('clients with an approved plan, those without facts for the month first; scoped to the expert', async () => {
    await s.h!.sb.from('pb_monthly_facts').insert({ company_id: OTHER_COMPANY, period: '2026-09', metric: 'revenue', value: 1, entered_role: 'owner' })
    const list = async (url = 'http://t/api/giga-admin/point-b/reconciliation') => json(await reconciliationRoute.GET(req('GET', undefined, url)))
    expect((await list()).status).toBe(403)
    staffAs('admin')
    const r = await list()
    expect(r.body.data.period).toBe('2026-09')
    expect(r.body.data.items.map((i: { userId: string; done: boolean }) => [i.userId, i.done])).toEqual([[CLIENT, false], [OTHER_CLIENT, true]])
    expect(r.body.data.items[0]).toMatchObject({ clientName: 'Клиент Один', companyName: 'Ромашка' })
    staffAs('super_expert', EXPERT, 'assigned')
    expect((await list()).body.data.items.map((i: { userId: string }) => i.userId)).toEqual([CLIENT])
    staffAs('admin')
    expect((await list('http://t/api/giga-admin/point-b/reconciliation?period=2026-08')).body.data.items.every((i: { done: boolean }) => !i.done)).toBe(true)
  })
})
