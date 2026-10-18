/**
 * Client routes of the Point B plan (plan Phase 1 Task 7): GET /api/v1/point-b/plan (only the
 * approved version, own goal reviews, an empty state instead of a 500), POST
 * /api/v1/point-b/goals/:reviewId/respond (owner only, never «от имени»), and the
 * `expert_version` of /api/v1/diagnostics/point-b coming from the plan through compat.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { pbDb } from './_pbdb'

const REVENUE = 'biz.finansy.vyruchka_god'
const OWNER = '00000000-0000-4000-8000-000000000001'
const STRANGER = '00000000-0000-4000-8000-000000000002'
const COMPANY = 'company-1'
const OTHER_COMPANY = 'company-2'
const REVIEW = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER_REVIEW = 'aaaaaaaa-0000-4000-8000-000000000002'

const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  user: null as { id: string } | null,
  impersonating: false,
  gate402: false,
  gateCalls: [] as Array<{ userId: string; feature: string; opts: unknown }>,
  responded: [] as unknown[],
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) }, from: (t: string) => s.h!.sb.from(t) }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.h!.sb }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => s.h!.sb }))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => (s.impersonating ? { sid: 'imp-1', uid: s.user?.id } : null) }))
vi.mock('@/lib/access/gate', () => ({
  gateFeature: async (_sb: unknown, userId: string, feature: string, opts: unknown) => {
    s.gateCalls.push({ userId, feature, opts })
    return s.gate402 ? NextResponse.json({ ok: false, error: 'upgrade_required', feature }, { status: 402 }) : null
  },
}))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async () => undefined }))
vi.mock('@/lib/goals/current', () => ({ loadGoalsWithEvaluation: async () => [] }))
vi.mock('@/lib/point-b/inputs', () => ({
  loadPointBInputs: async () => ({ diagnostic: { id: 'diag-1' }, companyId: COMPANY }),
}))
vi.mock('@/lib/point-b/compute', () => ({
  computePointB: () => ({ ai_strategy: null, ai_status: 'none', generated_at: '2026-10-18T00:00:00Z', metric_goals: [] }),
}))
vi.mock('@/lib/point-b/plan/notify', () => ({
  notifyGoalResponded: async (_sb: unknown, input: unknown) => { s.responded.push(input) },
}))

const planRoute = await import('@/app/api/v1/point-b/plan/route')
const respondRoute = await import('@/app/api/v1/point-b/goals/[reviewId]/respond/route')
const diagnosticsRoute = await import('@/app/api/v1/diagnostics/point-b/route')

const get = () => new NextRequest('http://t/api/v1/point-b/plan')
const post = (b: unknown) => new NextRequest('http://t/api', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } })
const rp = (reviewId: string) => ({ params: { reviewId } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() })
const db = () => s.h!.db

const goalsSnapshot = (status = 'verified') => ({
  primary: { metricKey: REVENUE, periodLabel: '12m' },
  items: [{ metricKey: REVENUE, periodLabel: '12m', label: 'Выручка', baselineValue: 50, baselinePeriod: '2025', targetValue: 100, deadline: null, reviewStatus: status }],
})

const version = (over: Record<string, unknown>) => ({
  id: 'v-1', plan_id: 'plan-1', version: 1, status: 'approved', base_snapshot_id: null, goals: goalsSnapshot(), assumptions: {}, scenarios: [],
  selected_scenario: null, strategy: {}, risks: [], expert_notes: 'Заметка эксперта', change_reason: 'Первый план', author_id: 'e-1', author_name: 'Алия Эксперт',
  author_kind: 'expert', submitted_at: '2026-10-10T00:00:00Z', approved_by: 'a-1', approved_at: '2026-10-11T00:00:00Z', approval_exception: null,
  rejected_by: null, rejected_at: null, rejected_reason: null, created_at: '2026-10-09T00:00:00Z', ...over,
})

const review = (over: Record<string, unknown>) => ({
  id: REVIEW, company_id: COMPANY, metric_key: REVENUE, period_label: '12m', status: 'corrected', proposed_value: 150, proposed_deadline: null,
  previous_value: 100, reason: 'Выше рынка', reviewer_id: 'e-1', reviewer_name: 'Алия Эксперт', owner_agreed_at: null,
  applied_without_agreement: false, reminded_at: null, created_at: '2026-10-12T00:00:00.000Z', ...over,
})

const target = (over: Record<string, unknown> = {}) => ({
  id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 100, direction: 'higher_is_better',
  source: 'owner', deadline: null, label: null, note: null, baseline_value: 50, baseline_period: '2025', baseline_at: '2026-01-01T00:00:00Z', ...over,
})

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return pbDb({
    companies: [
      { id: COMPANY, user_id: OWNER, name: 'Ромашка', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null },
      { id: OTHER_COMPANY, user_id: STRANGER, name: 'Лютик', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null },
    ],
    metric_targets: [target()],
    diagnostics: [{ id: 'diag-1', user_id: OWNER, is_current: true }],
    point_b_versions: [],
    ...extra,
  })
}

beforeEach(() => {
  s.h = seed()
  s.user = { id: OWNER }
  s.impersonating = false
  s.gate402 = false
  s.gateCalls.length = 0
  s.responded.length = 0
})

describe('GET /api/v1/point-b/plan', () => {
  it('GET plan 401 without a session', async () => {
    s.user = null
    expect((await json(await planRoute.GET())).status).toBe(401)
  })

  it('is a Pro feature for the session user (staff exempt); 402 passes through', async () => {
    await planRoute.GET()
    expect(s.gateCalls).toEqual([{ userId: OWNER, feature: 'point_b', opts: { exemptStaff: true } }])
    s.gate402 = true
    const r = await json(await planRoute.GET())
    expect(r.status).toBe(402)
    expect(r.body.error).toBe('upgrade_required')
  })

  it('GET plan returns none for a user without a company or plan, not 500', async () => {
    db().companies.length = 0
    db().diagnostics.length = 0
    db().metric_targets.length = 0
    const r = await json(await planRoute.GET())
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, data: { status: 'none', version: null, goalReviews: [] } })
  })

  it('a company with nothing to plan on is none; with a goal or a diagnostic it is preparing', async () => {
    db().diagnostics.length = 0
    db().metric_targets.length = 0
    expect((await json(await planRoute.GET())).body.data.status).toBe('none')
    db().metric_targets.push(target())
    expect((await json(await planRoute.GET())).body.data.status).toBe('preparing')
    db().metric_targets.length = 0
    db().diagnostics.push({ id: 'diag-1', user_id: OWNER, is_current: true })
    expect((await json(await planRoute.GET())).body.data.status).toBe('preparing')
  })

  it('GET plan returns only the approved version and never a draft or in_review one', async () => {
    s.h = seed({
      pb_plans: [{ id: 'plan-1', company_id: COMPANY, user_id: OWNER, current_version_id: 'v-3', published_version_id: 'v-2', settings: {}, created_at: 'x', updated_at: 'x' }],
      pb_plan_versions: [
        version({ id: 'v-1', version: 1, status: 'superseded', expert_notes: 'Старая' }),
        version({ id: 'v-2', version: 2, status: 'approved', expert_notes: 'Одобренная заметка', author_name: 'ekspert@staff.io' }),
        version({ id: 'v-3', version: 3, status: 'draft', expert_notes: 'СЕКРЕТНЫЙ ЧЕРНОВИК', approved_at: null }),
      ],
    })
    const r = await json(await planRoute.GET())
    expect(r.body.data.status).toBe('published')
    expect(r.body.data.version).toMatchObject({ number: 2, expertNotes: 'Одобренная заметка', approvedAt: '2026-10-11T00:00:00Z', authorName: 'Эксперт AIStart360' })
    expect(r.body.data.version.goals.primary).toEqual({ metricKey: REVENUE, periodLabel: '12m' })
    expect(JSON.stringify(r.body)).not.toContain('СЕКРЕТНЫЙ')
    expect(JSON.stringify(r.body)).not.toContain('@')

    // A draft and a version in review alone: preparing, version null, no text leaks.
    db().pb_plan_versions.splice(0, 2)
    db().pb_plan_versions.push(version({ id: 'v-4', version: 4, status: 'in_review', expert_notes: 'НА ПРОВЕРКЕ', approved_at: null }))
    db().pb_plans[0].published_version_id = null
    const waiting = await json(await planRoute.GET())
    expect(waiting.body.data).toMatchObject({ status: 'preparing', version: null })
    expect(JSON.stringify(waiting.body)).not.toContain('СЕКРЕТНЫЙ')
    expect(JSON.stringify(waiting.body)).not.toContain('НА ПРОВЕРКЕ')
  })

  it('GET plan lists only this owner’s goal reviews (latest per goal), with from / to / reason', async () => {
    s.h = seed({
      pb_goal_reviews: [
        review({ id: 'rv-old', status: 'verified', proposed_value: 100, previous_value: null, reason: null, created_at: '2026-10-01T00:00:00.000Z' }),
        review({ id: REVIEW }),
        review({ id: OTHER_REVIEW, company_id: OTHER_COMPANY, reason: 'Чужая причина' }),
      ],
    })
    const r = await json(await planRoute.GET())
    expect(r.body.data.goalReviews).toHaveLength(1)
    expect(r.body.data.goalReviews[0]).toMatchObject({
      id: REVIEW, metricKey: REVENUE, status: 'corrected', from: 100, to: 150, reason: 'Выше рынка', createdAt: '2026-10-12T00:00:00.000Z',
    })
    expect(typeof r.body.data.goalReviews[0].metricLabel).toBe('string')
    expect(JSON.stringify(r.body)).not.toContain('Чужая причина')
  })

  it('a missing plan table (migration not applied) is an empty state, any other failure is 500', async () => {
    const base = seed()
    const failing = (message: string) => ({ ...base, sb: { from: (t: string) => { if (t === 'pb_plans') throw new Error(message); return base.sb.from(t) } } as never })
    s.h = failing('point-b plan: read plan failed (42P01)')
    expect((await json(await planRoute.GET())).body).toEqual({ ok: true, data: { status: 'none', version: null, goalReviews: [] } })
    s.h = failing('boom')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await json(await planRoute.GET())).status).toBe(500)
  })
})

describe('POST /api/v1/point-b/goals/:reviewId/respond', () => {
  beforeEach(() => {
    s.h = seed({ pb_goal_reviews: [review({ id: REVIEW })] })
  })

  it('401 without a session, 400 on a bad body, 404 on a malformed id', async () => {
    s.user = null
    expect((await json(await respondRoute.POST(post({ accept: true }), rp(REVIEW)))).status).toBe(401)
    s.user = { id: OWNER }
    expect((await json(await respondRoute.POST(post({ accept: 'yes' }), rp(REVIEW)))).status).toBe(400)
    expect((await json(await respondRoute.POST(post({ accept: true }), rp('not-a-uuid')))).status).toBe(404)
    expect(db().pb_goal_reviews[0].status).toBe('corrected')
  })

  it('accept applies the proposed value to metric_targets, records the agreement and tells staff', async () => {
    const r = await json(await respondRoute.POST(post({ accept: true }), rp(REVIEW)))
    expect(r).toEqual({ status: 200, body: { ok: true } })
    expect(db().metric_targets[0]).toMatchObject({ target_value: 150 })
    expect(db().pb_goal_reviews[0]).toMatchObject({ status: 'agreed' })
    expect(db().pb_goal_reviews[0].owner_agreed_at).toBeTruthy()
    expect(s.responded).toEqual([{ userId: OWNER, companyId: COMPANY, reviewId: REVIEW, metricLabel: expect.any(String), accepted: true, reviewerId: 'e-1' }])
  })

  it('dispute keeps the goal and marks it disputed', async () => {
    expect((await json(await respondRoute.POST(post({ accept: false }), rp(REVIEW)))).status).toBe(200)
    expect(db().metric_targets[0].target_value).toBe(100)
    expect(db().pb_goal_reviews[0].status).toBe('disputed')
    expect(s.responded[0]).toMatchObject({ accepted: false })
  })

  it('respond with another owner’s reviewId → 404 and no write', async () => {
    s.user = { id: STRANGER }
    const r = await json(await respondRoute.POST(post({ accept: true }), rp(REVIEW)))
    expect(r.status).toBe(404)
    expect(db().pb_goal_reviews[0]).toMatchObject({ status: 'corrected', owner_agreed_at: null })
    expect(db().metric_targets[0].target_value).toBe(100)
    expect(s.h!.writes.filter((w) => w.table === 'metric_targets' || w.table === 'pb_goal_reviews')).toHaveLength(0)
    expect(s.responded).toHaveLength(0)
  })

  it('an unknown reviewId → 404', async () => {
    expect((await json(await respondRoute.POST(post({ accept: true }), rp(OTHER_REVIEW)))).status).toBe(404)
  })

  it('respond while impersonating → 403 and no write', async () => {
    s.impersonating = true
    const r = await json(await respondRoute.POST(post({ accept: true }), rp(REVIEW)))
    expect(r.status).toBe(403)
    expect(db().pb_goal_reviews[0].status).toBe('corrected')
    expect(db().metric_targets[0].target_value).toBe(100)
    expect(s.h!.writes).toHaveLength(0)
  })

  it('a correction already answered, or no longer the newest, is 409', async () => {
    expect((await json(await respondRoute.POST(post({ accept: true }), rp(REVIEW)))).status).toBe(200)
    expect((await json(await respondRoute.POST(post({ accept: false }), rp(REVIEW)))).status).toBe(409)
    expect(db().metric_targets[0].target_value).toBe(150)
  })

  it('is gated like the page: 402 for a free client while the gates are on, nothing written', async () => {
    s.gate402 = true
    expect((await json(await respondRoute.POST(post({ accept: true }), rp(REVIEW)))).status).toBe(402)
    expect(db().pb_goal_reviews[0].status).toBe('corrected')
  })
})

describe('diagnostics/point-b route: expert_version through compat', () => {
  const client = async () => (await json(await diagnosticsRoute.GET(new NextRequest('http://t/api/v1/diagnostics/point-b')))).body

  it('diagnostics/point-b route returns expert_version from the approved plan, falling back to the legacy approved version', async () => {
    // legacy approved version only
    s.h = seed({ point_b_versions: [
      { id: 'pb-1', diagnostic_id: 'diag-1', expert_notes: 'Старая одобренная', author_name: 'expert@staff.io', is_approved: true, created_at: '2026-09-01T00:00:00Z' },
      { id: 'pb-2', diagnostic_id: 'diag-1', expert_notes: 'Старый черновик', author_name: 'Алия', is_approved: false, created_at: '2026-10-01T00:00:00Z' },
    ] })
    let body = await client()
    expect(body.ok).toBe(true)
    expect(body.expert_version).toEqual({ expert_notes: 'Старая одобренная', author_name: 'Эксперт AIStart360', created_at: '2026-09-01T00:00:00Z' })

    // an approved plan version wins over the legacy one; a newer draft is not shown
    s.h = seed({
      point_b_versions: [{ id: 'pb-1', diagnostic_id: 'diag-1', expert_notes: 'Старая одобренная', author_name: 'Алия', is_approved: true, created_at: '2026-09-01T00:00:00Z' }],
      pb_plans: [{ id: 'plan-1', company_id: COMPANY, user_id: OWNER, current_version_id: 'v-2', published_version_id: 'v-1', settings: {}, created_at: 'x', updated_at: 'x' }],
      pb_plan_versions: [
        version({ id: 'v-1', version: 1, status: 'approved', expert_notes: 'Из плана', author_name: 'Алия Эксперт' }),
        version({ id: 'v-2', version: 2, status: 'draft', expert_notes: 'ЧЕРНОВИК ПЛАНА', approved_at: null }),
      ],
    })
    body = await client()
    expect(body.expert_version).toEqual({ expert_notes: 'Из плана', author_name: 'Алия Эксперт', created_at: '2026-10-11T00:00:00Z' })
    expect(JSON.stringify(body)).not.toContain('ЧЕРНОВИК ПЛАНА')

    // nothing approved anywhere
    s.h = seed()
    expect((await client()).expert_version).toBeNull()
  })

  it('a failing plan read falls back to the legacy version instead of failing the route', async () => {
    const base = seed({ point_b_versions: [{ id: 'pb-1', diagnostic_id: 'diag-1', expert_notes: 'Старая одобренная', author_name: 'Алия', is_approved: true, created_at: '2026-09-01T00:00:00Z' }] })
    s.h = { ...base, sb: { from: (t: string) => { if (t === 'pb_plans') throw new Error('relation does not exist'); return base.sb.from(t) } } as never }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const body = await client()
    expect(body.ok).toBe(true)
    expect(body.expert_version).toMatchObject({ expert_notes: 'Старая одобренная' })
  })
})
