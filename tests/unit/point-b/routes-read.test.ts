/**
 * The four read routes of Point B (client, AI bridge, expert, GIGA) take their
 * inputs from ONE loader: the same revenue base (with period), the same
 * snapshot, the same goals — and an expert reaches only their own clients.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { ADMIN, CLIENT, EXPERT, OTHER_CLIENT, pointBSeed } from './_pb'

const s = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('./_pb').pointBSeed> | null,
  admin: null as ReturnType<typeof import('./_pb').pointBSeed> | null,
  sessionUser: null as { id: string } | null,
  expert: { ok: true, viewer: { id: 'x', role: 'expert', email: null } } as Record<string, unknown>,
  actor: { role: 'super_admin' as StaffRole, scope: 'all' as 'all' | 'assigned', id: 'x' },
  ai: [] as unknown[],
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.sessionUser } }) }, from: (t: string) => s.db!.sb.from(t) }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.db!.sb }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => s.admin!.sb }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async () => undefined }))
vi.mock('@/lib/goals/current', () => ({ loadGoalsWithEvaluation: async () => [] }))
vi.mock('@/lib/expert-auth', async (orig) => ({ ...(await orig<typeof import('@/lib/expert-auth')>()), resolveExpert: async () => s.expert }))
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
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => true }))
vi.mock('@/lib/api-identity', () => ({
  getSessionUser: async () => s.sessionUser,
  getSessionRole: async () => 'client',
  isStaffRole: () => false,
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/ai/budget', () => ({ guardAiBudget: async () => null }))
vi.mock('@/lib/internal-auth', () => ({ hasValidInternalToken: () => false }))
vi.mock('@/lib/ai/point-b-analyzer', () => ({
  analyzePointBStrategy: async (pb: unknown) => { s.ai.push(pb); return { narrative: 'x' } },
}))

const clientRoute = await import('@/app/api/v1/diagnostics/point-b/route')
const aiRoute = await import('@/app/api/v1/diagnostics/point-b/ai-generate/route')
const expertRoute = await import('@/app/api/expert/clients/[id]/point-b/route')
const gigaRoute = await import('@/app/api/giga-admin/users/[id]/point-b/route')

const req = (url = 'http://t/api') => new NextRequest(url)
const json = async (r: Response) => ({ status: r.status, body: await r.json() })
const idParams = (id: string) => ({ params: { id } })

beforeEach(() => {
  s.db = pointBSeed()
  s.admin = pointBSeed()
  s.sessionUser = { id: CLIENT }
  s.expert = { ok: true, viewer: { id: EXPERT, role: 'expert', email: 'e@example.com' } }
  s.actor = { role: 'super_admin', scope: 'all', id: ADMIN }
  s.ai = []
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test') }))
})

describe('client route', () => {
  it('401 without a session', async () => {
    s.sessionUser = null
    expect((await json(await clientRoute.GET(req()))).status).toBe(401)
  })

  it('reads only the session user, ignores a user_id query', async () => {
    s.db = pointBSeed()
    const res = await json(await clientRoute.GET(req(`http://t/api?user_id=${OTHER_CLIENT}`)))
    expect(res.status).toBe(200)
    expect(res.body.data.diagnostic_id).toBe('diag-1')
    s.sessionUser = { id: OTHER_CLIENT } // a user with no diagnostic of their own
    const other = await json(await clientRoute.GET(req(`http://t/api?user_id=${CLIENT}`)))
    expect(other.body).toEqual({ ok: true, data: null, reason: 'no_diagnostic' })
  })

  it('returns data_quality with a stale base for revenue 2024 and the snapshot', async () => {
    const res = await json(await clientRoute.GET(req()))
    expect(res.body.data.data_quality.base).toMatchObject({ period: '2024', stale: true })
    expect(res.body.data.data_quality.snapshot).toEqual({ id: 'snap-1', confidence: 0.6, coverage: 0.7 })
    expect(res.body.data.goals.current_revenue_year).toBe(60_000_000)
  })

  it('persists the snapshot with the service client and keeps the AI fields', async () => {
    await clientRoute.GET(req())
    const writes = s.admin!.writes.filter((w) => w.table === 'point_b_analysis')
    expect(writes).toHaveLength(1)
    expect(writes[0].op).toBe('insert')
  })
})

describe('AI route', () => {
  it('feeds the analyzer the same inputs (stale 2024 base included)', async () => {
    const res = await json(await aiRoute.POST(new NextRequest('http://t/api', { method: 'POST', body: '{}' })))
    expect(res.body).toMatchObject({ ok: true, ai_status: 'completed' })
    const pb = s.ai[0] as { data_quality: { base: { stale: boolean; period: string } }; goals: { current_revenue_year: number } }
    expect(pb.data_quality.base).toMatchObject({ stale: true, period: '2024' })
    expect(pb.goals.current_revenue_year).toBe(60_000_000)
  })

  it('404 for a user without a diagnostic', async () => {
    s.sessionUser = { id: OTHER_CLIENT }
    expect((await json(await aiRoute.POST(new NextRequest('http://t/api', { method: 'POST', body: '{}' })))).status).toBe(404)
  })
})

describe('expert route', () => {
  beforeEach(() => {
    s.db = pointBSeed({ user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }] })
  })

  it('no longer queries metrics?metric_key=eq.revenue: registry revenue fills the gap', async () => {
    const res = await json(await expertRoute.GET(req(), idParams(CLIENT)))
    expect(res.status).toBe(200)
    expect(fetch).not.toHaveBeenCalled()
    const g12 = res.body.data.gap.find((g: { horizon: string }) => g.horizon === '12m')
    expect(g12.current_revenue).toBe(60_000_000)
    expect(g12.data_complete).toBe(true)
    expect(res.body.data.data_quality.base).toMatchObject({ period: '2024', stale: true })
  })

  it('a client not assigned to the expert gets 403', async () => {
    s.db = pointBSeed({ user_assignments: [{ user_id: CLIENT, assignee_id: 'someone-else' }] })
    expect((await json(await expertRoute.GET(req(), idParams(CLIENT)))).status).toBe(403)
    s.db = pointBSeed({ user_assignments: [] })
    expect((await json(await expertRoute.GET(req(), idParams(CLIENT)))).status).toBe(403)
  })

  it('an admin reaches any client; a non-uuid id is a 400', async () => {
    s.expert = { ok: true, viewer: { id: ADMIN, role: 'admin', email: null } }
    s.db = pointBSeed()
    expect((await json(await expertRoute.GET(req(), idParams(CLIENT)))).status).toBe(200)
    expect((await json(await expertRoute.GET(req(), idParams('not-a-uuid')))).status).toBe(400)
  })

  it('no_diagnostic for an assigned client without Point A', async () => {
    s.db = pointBSeed({ diagnostics: [], user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }] })
    const res = await json(await expertRoute.GET(req(), idParams(CLIENT)))
    expect(res.body).toEqual({ ok: true, data: null, reason: 'no_diagnostic' })
  })

  it('an unauthenticated viewer is refused before any read', async () => {
    s.expert = { ok: false, block: 'unauthenticated' }
    expect((await json(await expertRoute.GET(req(), idParams(CLIENT)))).status).toBe(401)
  })
})

describe('GIGA route', () => {
  it('returns the same Point B with a stale base', async () => {
    const res = await json(await gigaRoute.GET(req(), idParams(CLIENT)))
    expect(res.status).toBe(200)
    expect(res.body.data.pointB.data_quality.base).toMatchObject({ period: '2024', stale: true })
    expect(res.body.data.version).toBeNull()
  })

  it('403 for an actor without access to the client (guardClientAccess)', async () => {
    s.actor = { role: 'super_expert', scope: 'assigned', id: ADMIN }
    s.db = pointBSeed({ user_assignments: [{ user_id: OTHER_CLIENT, assignee_id: ADMIN }] })
    expect((await json(await gigaRoute.GET(req(), idParams(CLIENT)))).status).toBe(403)
  })

  it('no_diagnostic keeps the old shape', async () => {
    s.db = pointBSeed({ diagnostics: [] })
    const res = await json(await gigaRoute.GET(req(), idParams(CLIENT)))
    expect(res.body.data).toEqual({ pointB: null, reason: 'no_diagnostic', version: null })
  })
})
