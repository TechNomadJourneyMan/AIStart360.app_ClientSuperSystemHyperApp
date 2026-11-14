/**
 * R2-A: every API of a paid section answers 402 upgrade_required to a Free
 * account while the gates are on — BEFORE any data is read — and lets Pro,
 * staff and «gates off» through. Point A, Point B, Market, full GRI.
 * (Point B's own routes: tests/unit/access/point-b-gate.test.ts and the
 * point-b route tests; the express view of Point A: point-a-express.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({
  gates: true,
  tier: 'free' as 'free' | 'pro',
  flags: {} as Record<string, boolean>,
  count: 0,
  role: 'client' as string,
  user: { id: '11111111-1111-4111-8111-111111111111' } as { id: string } | null,
  fromCalls: [] as string[],
}))

function fakeClient() {
  const result = { data: null, error: null, get count() { return s.count } }
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'order', 'limit', 'range', 'match', 'filter', 'contains', 'insert', 'update', 'upsert', 'delete']) chain[m] = self
  chain.single = async () => result
  chain.maybeSingle = async () => result
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return {
    auth: {
      getUser: async () => ({ data: { user: s.user }, error: null }),
      getSession: async () => ({ data: { session: s.user ? { access_token: 'tok' } : null }, error: null }),
    },
    from: (t: string) => { s.fromCalls.push(t); return chain },
    rpc: async () => result,
    storage: { from: () => ({ download: async () => result, createSignedUrl: async () => result }) },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fakeClient() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeClient() }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeClient(), requireServiceRoleKey: () => 'k' }))
vi.mock('@/lib/settings/system-settings', async () => {
  const real = await vi.importActual<Record<string, unknown>>('@/lib/settings/system-settings')
  return { ...real, getAccessGatesEnabled: async () => s.gates, getInsightModerationEnabled: async () => true }
})
vi.mock('@/lib/access/server', async () => {
  const ent = await import('@/lib/access/entitlements')
  return { readEntitlements: async () => ent.entitlementsFor(s.tier, s.flags, 1) }
})
vi.mock('@/lib/api-identity', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-identity')>('@/lib/api-identity')
  return {
    ...real,
    getSessionUser: async () => s.user,
    getSessionRole: async () => s.role,
    getSessionStaff: async () => (real.isStaffRole(s.role) ? { id: s.user?.id ?? '', role: s.role } : null),
    mayActOnUser: async () => true,
    resolveTargetUserId: async () => (s.user ? { userId: s.user.id } : { error: 'unauthorized' }),
  }
})
vi.mock('@/lib/tenancy', async () => {
  const real = await vi.importActual<Record<string, unknown>>('@/lib/tenancy')
  return { ...real, resolveTenantWith: async () => ({ ok: true, tenant: { companyId: 'c-1', canManage: true, role: 'owner', userId: s.user?.id } }) }
})
vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: async () => false,
  isRateLimited: async () => false,
  checkRateLimit: async () => ({ limited: false }),
  rateLimitResponse: () => new Response('{}', { status: 429 }),
}))
vi.mock('@/lib/ai/budget', () => ({ guardAiBudget: async () => null }))
vi.mock('@/lib/ai/openrouter', async () => {
  const real = await vi.importActual<Record<string, unknown>>('@/lib/ai/openrouter')
  return { ...real, hasOpenRouterKey: () => true }
})
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => null }))
vi.mock('@/lib/impersonation/guard', () => ({ refuseDuringImpersonation: async () => null }))
vi.mock('@/lib/share/tokens', () => ({ createShare: async () => ({ token: 'tok' }), revokeShare: async () => undefined, getShareByToken: async () => null, SHARE_DEFAULT_TTL_DAYS: 30 }))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => undefined, trackEventOnce: async () => undefined }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async () => undefined }))
vi.mock('@/lib/point-a/v4/state', () => ({ loadPointAState: async () => { throw new Error('not in this test') } }))

const UUID = '22222222-2222-4222-8222-222222222222'
const { ALL_QUESTION_KEYS } = await import('@/lib/market-analysis/questions')
const marketKey = ALL_QUESTION_KEYS[0]

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const get = (url: string) => new NextRequest(url)

type Handler = (req: NextRequest, ctx: { params: Record<string, unknown> }) => Promise<Response>
interface Case { name: string; feature: 'point_a' | 'point_b' | 'market' | 'gri_full'; load: () => Promise<Handler>; req: () => NextRequest; params?: Record<string, unknown> }

const h = (mod: Promise<Record<string, unknown>>, method: string) => async () => (await mod)[method] as Handler

const CASES: Case[] = [
  // Точка А
  { name: 'GET point-a/state (full page)', feature: 'point_a', load: h(import('@/app/api/v1/point-a/state/route'), 'GET'), req: () => get('http://t/api/v1/point-a/state') },
  { name: 'GET point-a/aggregate', feature: 'point_a', load: h(import('@/app/api/v1/point-a/aggregate/route'), 'GET'), req: () => get('http://t/api/v1/point-a/aggregate') },
  { name: 'POST point-a/aggregate', feature: 'point_a', load: h(import('@/app/api/v1/point-a/aggregate/route'), 'POST'), req: () => json('http://t/api/v1/point-a/aggregate', 'POST', {}) },
  { name: 'GET point-a/block/[key]', feature: 'point_a', load: h(import('@/app/api/v1/point-a/block/[key]/route'), 'GET'), req: () => get('http://t/api/v1/point-a/block/finance'), params: { key: 'finance' } },
  { name: 'PATCH point-a/config', feature: 'point_a', load: h(import('@/app/api/v1/point-a/config/route'), 'PATCH'), req: () => json('http://t/api/v1/point-a/config', 'PATCH', {}) },
  { name: 'GET point-a/filters', feature: 'point_a', load: h(import('@/app/api/v1/point-a/filters/route'), 'GET'), req: () => get('http://t/api/v1/point-a/filters') },
  { name: 'GET point-a/insights', feature: 'point_a', load: h(import('@/app/api/v1/point-a/insights/route'), 'GET'), req: () => get('http://t/api/v1/point-a/insights') },
  { name: 'POST point-a/insights', feature: 'point_a', load: h(import('@/app/api/v1/point-a/insights/route'), 'POST'), req: () => json('http://t/api/v1/point-a/insights', 'POST', { question_text: 'Почему падает выручка?', category: 'ВЫРУЧКА' }) },
  { name: 'PATCH point-a/insights/[id]', feature: 'point_a', load: h(import('@/app/api/v1/point-a/insights/[id]/route'), 'PATCH'), req: () => json(`http://t/api/v1/point-a/insights/${UUID}`, 'PATCH', { action: 'confirm' }), params: { id: UUID } },
  { name: 'DELETE point-a/insights/[id]', feature: 'point_a', load: h(import('@/app/api/v1/point-a/insights/[id]/route'), 'DELETE'), req: () => json(`http://t/api/v1/point-a/insights/${UUID}`, 'DELETE'), params: { id: UUID } },
  { name: 'POST point-a/insights/ai-generate', feature: 'point_a', load: h(import('@/app/api/v1/point-a/insights/ai-generate/route'), 'POST'), req: () => json('http://t/api/v1/point-a/insights/ai-generate', 'POST', {}) },
  { name: 'GET point-a/loss-map', feature: 'point_a', load: h(import('@/app/api/v1/point-a/loss-map/route'), 'GET'), req: () => get('http://t/api/v1/point-a/loss-map') },
  { name: 'POST point-a/narrative', feature: 'point_a', load: h(import('@/app/api/v1/point-a/narrative/route'), 'POST'), req: () => json('http://t/api/v1/point-a/narrative', 'POST', {}) },
  { name: 'GET point-a/overview', feature: 'point_a', load: h(import('@/app/api/v1/point-a/overview/route'), 'GET'), req: () => get('http://t/api/v1/point-a/overview') },
  { name: 'POST point-a/recalculate', feature: 'point_a', load: h(import('@/app/api/v1/point-a/recalculate/route'), 'POST'), req: () => json('http://t/api/v1/point-a/recalculate', 'POST', {}) },
  { name: 'GET point-a/retention-curve', feature: 'point_a', load: h(import('@/app/api/v1/point-a/retention-curve/route'), 'GET'), req: () => get('http://t/api/v1/point-a/retention-curve') },
  { name: 'GET point-a/segments', feature: 'point_a', load: h(import('@/app/api/v1/point-a/segments/route'), 'GET'), req: () => get('http://t/api/v1/point-a/segments') },
  { name: 'GET point-a/top-table', feature: 'point_a', load: h(import('@/app/api/v1/point-a/top-table/route'), 'GET'), req: () => get('http://t/api/v1/point-a/top-table') },
  { name: 'GET point-a/v3', feature: 'point_a', load: h(import('@/app/api/v1/point-a/v3/route'), 'GET'), req: () => get('http://t/api/v1/point-a/v3') },
  { name: 'GET diagnostics/current', feature: 'point_a', load: h(import('@/app/api/v1/diagnostics/current/route'), 'GET'), req: () => get('http://t/api/v1/diagnostics/current') },
  { name: 'GET diagnostics/ai-status', feature: 'point_a', load: h(import('@/app/api/v1/diagnostics/ai-status/route'), 'GET'), req: () => get(`http://t/api/v1/diagnostics/ai-status?diagnostic_id=${UUID}`) },
  { name: 'POST diagnostics/retry-ai', feature: 'point_a', load: h(import('@/app/api/v1/diagnostics/retry-ai/route'), 'POST'), req: () => json('http://t/api/v1/diagnostics/retry-ai', 'POST', { diagnostic_id: UUID }) },
  // Точка Б (the rest of its routes are covered by the point-b tests)
  { name: 'GET diagnostics/point-b/ai-status', feature: 'point_b', load: h(import('@/app/api/v1/diagnostics/point-b/ai-status/route'), 'GET'), req: () => get('http://t/api/v1/diagnostics/point-b/ai-status') },
  // Рынок
  { name: 'GET /api/market/companies (proxy)', feature: 'market', load: h(import('@/app/api/market/[...path]/route'), 'GET'), req: () => get('http://t/api/market/companies'), params: { path: ['companies'] } },
  { name: 'POST /api/market/competitors/wizard (proxy)', feature: 'market', load: h(import('@/app/api/market/[...path]/route'), 'POST'), req: () => json('http://t/api/market/competitors/wizard', 'POST', {}), params: { path: ['competitors', 'wizard'] } },
  { name: 'GET market-analysis', feature: 'market', load: h(import('@/app/api/v1/market-analysis/route'), 'GET'), req: () => get('http://t/api/v1/market-analysis') },
  { name: 'PATCH market-analysis', feature: 'market', load: h(import('@/app/api/v1/market-analysis/route'), 'PATCH'), req: () => json('http://t/api/v1/market-analysis', 'PATCH', { question_key: marketKey, action: 'confirm' }) },
  { name: 'POST market-analysis/generate', feature: 'market', load: h(import('@/app/api/v1/market-analysis/generate/route'), 'POST'), req: () => json('http://t/api/v1/market-analysis/generate', 'POST', {}) },
  // Public links and PDFs of a paid section
  { name: 'POST /api/share (point_a)', feature: 'point_a', load: h(import('@/app/api/share/route'), 'POST'), req: () => json('http://t/api/share', 'POST', { type: 'point_a', companyId: 'c-1' }) },
  { name: 'POST /api/share (point_b)', feature: 'point_b', load: h(import('@/app/api/share/route'), 'POST'), req: () => json('http://t/api/share', 'POST', { type: 'point_b', companyId: 'c-1' }) },
  { name: 'POST /api/share (gri)', feature: 'gri_full', load: h(import('@/app/api/share/route'), 'POST'), req: () => json('http://t/api/share', 'POST', { type: 'gri', companyId: 'c-1' }) },
  { name: 'GET /api/export/report?type=point-a', feature: 'point_a', load: h(import('@/app/api/export/report/route'), 'GET'), req: () => get('http://t/api/export/report?type=point-a') },
  { name: 'GET /api/export/report?type=point-b', feature: 'point_b', load: h(import('@/app/api/export/report/route'), 'GET'), req: () => get('http://t/api/export/report?type=point-b') },
  { name: 'GET /api/export/report?type=gri', feature: 'gri_full', load: h(import('@/app/api/export/report/route'), 'GET'), req: () => get('http://t/api/export/report?type=gri') },
  // Полный GRI
  { name: 'GET gri/assessment', feature: 'gri_full', load: h(import('@/app/api/v1/gri/assessment/route'), 'GET'), req: () => get('http://t/api/v1/gri/assessment') },
  { name: 'POST gri/assessment', feature: 'gri_full', load: h(import('@/app/api/v1/gri/assessment/route'), 'POST'), req: () => json('http://t/api/v1/gri/assessment', 'POST', { scores: { s1: { c1: 5 } } }) },
  { name: 'GET gri/draft', feature: 'gri_full', load: h(import('@/app/api/v1/gri/draft/route'), 'GET'), req: () => get('http://t/api/v1/gri/draft') },
  { name: 'PUT gri/draft', feature: 'gri_full', load: h(import('@/app/api/v1/gri/draft/route'), 'PUT'), req: () => json('http://t/api/v1/gri/draft', 'PUT', {}) },
  { name: 'DELETE gri/draft', feature: 'gri_full', load: h(import('@/app/api/v1/gri/draft/route'), 'DELETE'), req: () => json('http://t/api/v1/gri/draft', 'DELETE') },
  { name: 'GET gri/calc-sessions', feature: 'gri_full', load: h(import('@/app/api/v1/gri/calc-sessions/route'), 'GET'), req: () => get('http://t/api/v1/gri/calc-sessions') },
  { name: 'POST gri/calc-sessions', feature: 'gri_full', load: h(import('@/app/api/v1/gri/calc-sessions/route'), 'POST'), req: () => json('http://t/api/v1/gri/calc-sessions', 'POST', {}) },
  { name: 'DELETE gri/calc-sessions/[id]', feature: 'gri_full', load: h(import('@/app/api/v1/gri/calc-sessions/[id]/route'), 'DELETE'), req: () => json(`http://t/api/v1/gri/calc-sessions/${UUID}`, 'DELETE'), params: { id: UUID } },
  { name: 'GET gri/plan-progress', feature: 'gri_full', load: h(import('@/app/api/v1/gri/plan-progress/route'), 'GET'), req: () => get(`http://t/api/v1/gri/plan-progress?assessment_id=${UUID}`) },
  { name: 'PATCH gri/plan-progress', feature: 'gri_full', load: h(import('@/app/api/v1/gri/plan-progress/route'), 'PATCH'), req: () => json('http://t/api/v1/gri/plan-progress', 'PATCH', { assessment_id: UUID, step_key: 'days_1_30-c0', done: true }) },
  { name: 'GET gri/reality-check', feature: 'gri_full', load: h(import('@/app/api/v1/gri/reality-check/route'), 'GET'), req: () => get('http://t/api/v1/gri/reality-check') },
  { name: 'POST /api/gri/ai-strategy', feature: 'gri_full', load: h(import('@/app/api/gri/ai-strategy/route'), 'POST'), req: () => json('http://t/api/gri/ai-strategy', 'POST', {}) },
  { name: 'POST /api/gri/financial-analyst', feature: 'gri_full', load: h(import('@/app/api/gri/financial-analyst/route'), 'POST'), req: () => json('http://t/api/gri/financial-analyst', 'POST', {}) },
]

async function call(c: Case): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const handler = await c.load()
  const res = await handler(c.req(), { params: c.params ?? {} })
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return { status: res.status, body }
}

beforeEach(() => {
  s.gates = true
  s.tier = 'free'
  s.flags = {}
  s.count = 0
  s.role = 'client'
  s.user = { id: '11111111-1111-4111-8111-111111111111' }
  s.fromCalls = []
})

describe('Free with the gates on: 402 on every paid API, no data read', () => {
  for (const c of CASES) {
    it(`${c.feature} · ${c.name}`, async () => {
      const { status, body } = await call(c)
      expect(status).toBe(402)
      expect(body).toMatchObject({ ok: false, error: 'upgrade_required', feature: c.feature })
      expect(s.fromCalls).toEqual([])
    })
  }
})

describe('the gate lets the others through (status is anything but 402)', () => {
  for (const c of CASES) {
    it(`${c.feature} · ${c.name}: Pro, staff, gates off`, async () => {
      s.tier = 'pro'
      expect((await call(c)).status).not.toBe(402)
      s.tier = 'free'
      s.role = 'admin'
      expect((await call(c)).status).not.toBe(402)
      s.role = 'client'
      s.gates = false
      expect((await call(c)).status).not.toBe(402)
    })
  }
})

describe('without a session nothing changes: 401 stays 401', () => {
  it('a paid API without a session is not turned into a paywall', async () => {
    s.user = null
    const c = CASES.find((x) => x.name === 'GET gri/assessment')!
    expect((await call(c)).status).toBe(401)
  })
})

describe('full GRI: the run limit applies only to an individually opened Free account', () => {
  const postGri = CASES.find((x) => x.name === 'POST gri/assessment')!

  it('Free with feature_flags.gri_full = true: the first run passes the gate, the next is 402 with the limit message', async () => {
    s.flags = { gri_full: true }
    s.count = 0
    expect((await call(postGri)).status).not.toBe(402)
    s.count = 1
    const { status, body } = await call(postGri)
    expect(status).toBe(402)
    expect(body).toMatchObject({ error: 'upgrade_required', feature: 'gri_full' })
    expect(String(body?.message)).toContain('Доступно полных проходов GRI: 1')
  })

  it('Pro and staff are never limited by the number of runs', async () => {
    s.count = 50
    s.tier = 'pro'
    expect((await call(postGri)).status).not.toBe(402)
    s.tier = 'free'
    s.role = 'admin'
    expect((await call(postGri)).status).not.toBe(402)
  })
})

describe('the questionnaire stays free: its public link and PDF are not gated', () => {
  it('share survey / export survey → not 402 for Free', async () => {
    const share = await (await import('@/app/api/share/route')).POST(json('http://t/api/share', 'POST', { type: 'survey', companyId: 'c-1' }))
    expect(share.status).not.toBe(402)
    const pdf = await (await import('@/app/api/export/report/route')).GET(get('http://t/api/export/report?type=survey'))
    expect(pdf.status).not.toBe(402)
  })
})
