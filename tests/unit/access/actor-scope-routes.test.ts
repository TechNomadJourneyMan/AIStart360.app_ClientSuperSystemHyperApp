/**
 * Z1 / SR-02, SR-03, SR-05, R-136: service-role routes decide access by the
 * rule of migration 140 (lib/access/actor.ts), not by the legacy profiles.role.
 *
 * One table: every route that touches ONE client's data × five callers.
 *   assigned expert (approved, user_assignments → the client)  → allowed
 *   unassigned expert (approved, assigned to someone else)       → 403
 *   rejected expert (status 'rejected', even WITH an assignment) → 403
 *   legacy admin (profiles.role 'admin', no staff_roles)         → 403
 *   staff admin (staff_roles 'admin', profile role 'client')     → allowed
 * «Allowed» = the access check let the request through (not 401/403); what the
 * route does next with an empty fake database is not under test here.
 *
 * The database is a fake PostgREST (global fetch) plus a fake session client;
 * the second factor is passed (it has its own tests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const CLIENT = '00000000-0000-4000-8000-00000000c001'
const OTHER_CLIENT = '00000000-0000-4000-8000-00000000c002'
const EXPERT_ASSIGNED = '00000000-0000-4000-8000-00000000e001'
const EXPERT_UNASSIGNED = '00000000-0000-4000-8000-00000000e002'
const EXPERT_REJECTED = '00000000-0000-4000-8000-00000000e003'
const LEGACY_ADMIN = '00000000-0000-4000-8000-00000000a001'
const STAFF_ADMIN = '00000000-0000-4000-8000-00000000a002'
const COMPANY = 'co_client_1'
const VERSION = '00000000-0000-4000-8000-0000000000f1'
const DIAG = '00000000-0000-4000-8000-0000000000d1'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ current: '' as string, tables: {} as Record<string, Row[]>, writes: [] as string[], impersonating: false }))

function seed() {
  db.tables = {
    profiles: [
      { id: CLIENT, role: 'client', status: 'approved', full_name: 'C1', email: 'c1@x.kz', created_at: '2026-10-02' },
      { id: OTHER_CLIENT, role: 'client', status: 'approved', full_name: 'C2', email: 'c2@x.kz', created_at: '2026-10-01' },
      { id: EXPERT_ASSIGNED, role: 'expert', status: 'approved' },
      { id: EXPERT_UNASSIGNED, role: 'expert', status: 'approved' },
      { id: EXPERT_REJECTED, role: 'expert', status: 'rejected' },
      { id: LEGACY_ADMIN, role: 'admin', status: 'approved' },
      { id: STAFF_ADMIN, role: 'client', status: 'approved' },
    ],
    staff_roles: [{ user_id: STAFF_ADMIN, role: 'admin', client_scope: 'all' }],
    user_assignments: [
      { user_id: CLIENT, assignee_id: EXPERT_ASSIGNED },
      // Not a real state (user_id is the primary key) — proves the status, not the row, decides.
      { user_id: CLIENT, assignee_id: EXPERT_REJECTED },
      { user_id: OTHER_CLIENT, assignee_id: EXPERT_UNASSIGNED },
    ],
    companies: [{ id: COMPANY, user_id: CLIENT, name: 'Client Co' }],
    report_versions: [{ id: VERSION, company_id: COMPANY }],
    diagnostics: [{ id: DIAG, user_id: CLIENT, ai_status: 'none', ai_analysis: null }],
  }
  db.writes = []
  db.impersonating = false
}

function match(row: Row, col: string, cond: string): boolean {
  const v = row[col]
  if (cond.startsWith('eq.')) return String(v) === cond.slice(3)
  if (cond.startsWith('in.(')) return cond.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(v))
  if (cond.startsWith('is.')) return v === null || v === undefined
  return true
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict'])

// Fake PostgREST (service role).
async function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  const table = url.pathname.split('/').pop() as string
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method !== 'GET') {
    db.writes.push(`${method} ${table}`)
    return new Response(method === 'POST' ? JSON.stringify([{ id: 'new', client_id: CLIENT, author_id: db.current, text: 'x', created_at: '', updated_at: '' }]) : '[]', { status: 200 })
  }
  let rows = db.tables[table] ?? []
  for (const [k, v] of url.searchParams) if (!RESERVED.has(k)) rows = rows.filter((r) => match(r, k, v))
  const limit = Number(url.searchParams.get('limit') ?? 1000)
  const offset = Number(url.searchParams.get('offset') ?? 0)
  return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200 })
}

// Fake session client (RLS reads of the caller: own profile, a diagnostic …).
function chain(table: string) {
  const filters: Array<[string, unknown]> = []
  const rows = () => (db.tables[table] ?? []).filter((r) => filters.every(([c, v]) => String(r[c]) === String(v)))
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'like', 'limit', 'in', 'is', 'neq', 'gte', 'lte', 'upsert', 'insert', 'update']) c[m] = () => c
  c.eq = (col: string, v: unknown) => { filters.push([col, v]); return c }
  c.single = async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'none' } })
  c.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
  c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res)
  return c
}
const sessionClient = () => ({
  auth: { getUser: async () => ({ data: { user: db.current ? { id: db.current, email: `${db.current}@x.kz`, app_metadata: {}, user_metadata: {} } : null }, error: null }) },
  from: (t: string) => chain(t),
  rpc: async () => ({ data: null, error: { message: 'no rpc' } }),
})

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => sessionClient() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => sessionClient() }))
// Service-role SDK client: the same fake database.
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => sessionClient() }))
vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [] }),
  headers: () => new Headers({ host: 'portal.test' }),
}))
vi.mock('@/lib/admin/giga-actor', async () => {
  const real = await vi.importActual<typeof import('@/lib/admin/giga-actor')>('@/lib/admin/giga-actor')
  return { ...real, staffMfaGate: async () => 'ok' }
})
vi.mock('@/lib/mfa/api-staff-gate', () => ({ staffApiSecondFactor: async () => 'ok' }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false, isRateLimited: async () => false }))
vi.mock('@/lib/notifications', () => ({ notifyUser: vi.fn(async () => undefined), notifyAdmins: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: vi.fn(async () => true) }))
vi.mock('@/lib/share/tokens', () => ({
  SHARE_DEFAULT_TTL_DAYS: 90,
  createShare: vi.fn(async () => ({ token: 'tok' })),
  getShareByToken: vi.fn(async () => null),
  revokeShare: vi.fn(async () => 1),
}))
// SR-07 guard of Z2 (its own tests cover cookie / binding detection and the security log).
vi.mock('@/lib/impersonation/guard', async () => {
  const { NextResponse } = await import('next/server')
  return {
    refuseDuringImpersonation: vi.fn(async () =>
      db.impersonating ? NextResponse.json({ ok: false, error: 'Недоступно в режиме просмотра от имени клиента', code: 'IMPERSONATION_FORBIDDEN' }, { status: 403 }) : null),
  }
})
vi.mock('@/lib/reports/versions', () => ({
  getReportVersion: vi.fn(async () => ({ id: VERSION, company_id: COMPANY, status: 'published', published_at: '2026-11-01', version: 1, report_type: 'point_a', title: 'T', created_at: '2026-11-01' })),
}))
vi.mock('@/lib/reports/pdf-store', () => ({ versionPdf: vi.fn(async () => ({ bytes: Buffer.from('%PDF') })) }))
vi.mock('@/lib/reports/client-access', () => ({ pdfDisposition: () => 'attachment; filename="r.pdf"' }))
vi.mock('@/lib/reports/review-flow', () => ({ decideReportReview: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/reports/review-http', async () => {
  const { z } = await import('zod')
  const { NextResponse } = await import('next/server')
  return {
    ReviewBodySchema: z.object({ decision: z.literal('approve') }),
    reviewResponse: () => NextResponse.json({ ok: true }),
  }
})

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://portal.test${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })

const ROUTES: Array<{ name: string; call: () => Promise<Response> }> = [
  { name: 'GET /api/expert/clients/[id]/dashboard', call: async () => (await import('@/app/api/expert/clients/[id]/dashboard/route')).GET(new Request('http://x'), { params: { id: CLIENT } }) },
  { name: 'GET /api/expert/clients/[id]/gri', call: async () => (await import('@/app/api/expert/clients/[id]/gri/route')).GET(new Request('http://x'), { params: { id: CLIENT } }) },
  { name: 'GET /api/expert/clients/[id]/pulse', call: async () => (await import('@/app/api/expert/clients/[id]/pulse/route')).GET(new Request('http://x'), { params: { id: CLIENT } }) },
  { name: 'GET /api/expert/clients/[id]/expert-cases', call: async () => (await import('@/app/api/expert/clients/[id]/expert-cases/route')).GET(json('/x', 'GET'), { params: { id: CLIENT } }) },
  { name: 'PATCH /api/expert/clients/[id]/expert-cases', call: async () => (await import('@/app/api/expert/clients/[id]/expert-cases/route')).PATCH(json('/x', 'PATCH', { caseId: 'c1', status: 'open' }), { params: { id: CLIENT } }) },
  { name: 'GET /api/expert/comments?clientId', call: async () => (await import('@/app/api/expert/comments/route')).GET(json(`/api/expert/comments?clientId=${CLIENT}`, 'GET')) },
  { name: 'POST /api/expert/comments', call: async () => (await import('@/app/api/expert/comments/route')).POST(json('/api/expert/comments', 'POST', { clientId: CLIENT, text: 'Хороший рост' })) },
  { name: 'GET /api/expert/reports/[id]/pdf', call: async () => (await import('@/app/api/expert/reports/[id]/pdf/route')).GET(json('/x', 'GET'), { params: { id: VERSION } }) },
  { name: 'POST /api/expert/reports/[id]/review', call: async () => (await import('@/app/api/expert/reports/[id]/review/route')).POST(json('/x', 'POST', { decision: 'approve' }), { params: { id: VERSION } }) },
  { name: 'GET /api/clients/[id]/analysis/point-b', call: async () => (await import('@/app/api/clients/[id]/analysis/point-b/route')).GET(json('/x', 'GET'), { params: { id: CLIENT } }) },
  { name: 'GET /api/gri/baseline', call: async () => (await import('@/app/api/gri/baseline/route')).GET(json(`/api/gri/baseline?userId=${CLIENT}`, 'GET')) },
  { name: 'POST /api/share', call: async () => (await import('@/app/api/share/route')).POST(json('/api/share', 'POST', { type: 'point_a', companyId: COMPANY })) },
  { name: 'POST /api/v1/diagnostics/recalculate', call: async () => (await import('@/app/api/v1/diagnostics/recalculate/route')).POST(json('/x', 'POST', { user_id: CLIENT })) },
  { name: 'GET /api/v1/diagnostics/ai-status', call: async () => (await import('@/app/api/v1/diagnostics/ai-status/route')).GET(json(`/x?diagnostic_id=${DIAG}`, 'GET')) },
  { name: 'POST /api/v1/diagnostics/retry-ai', call: async () => (await import('@/app/api/v1/diagnostics/retry-ai/route')).POST(json('/x', 'POST', { diagnostic_id: DIAG })) },
  { name: 'GET /api/v1/gri/expert-notes', call: async () => (await import('@/app/api/v1/gri/expert-notes/route')).GET(json(`/x?user_id=${CLIENT}`, 'GET')) },
]

/** ai-status / retry-ai answer «not found» to a caller who may not see the diagnostic. */
const DENIED_AS_404 = new Set(['GET /api/v1/diagnostics/ai-status', 'POST /api/v1/diagnostics/retry-ai'])

const CALLERS: Array<{ who: string; id: string; allowed: boolean }> = [
  { who: 'assigned expert', id: EXPERT_ASSIGNED, allowed: true },
  { who: 'unassigned expert', id: EXPERT_UNASSIGNED, allowed: false },
  { who: 'rejected expert', id: EXPERT_REJECTED, allowed: false },
  { who: 'legacy admin without staff_roles', id: LEGACY_ADMIN, allowed: false },
  { who: 'staff admin (staff_roles)', id: STAFF_ADMIN, allowed: true },
]

beforeEach(() => {
  seed()
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('client scope of service-role routes (migration 140 rule)', () => {
  const cases = ROUTES.flatMap((r) => CALLERS.map((c) => ({ ...r, ...c })))
  it.each(cases)('$name — $who', async ({ name, call, id, allowed }) => {
    db.current = id
    const res = await call()
    if (allowed) {
      expect([401, 403], `${name}: status ${res.status}`).not.toContain(res.status)
      if (DENIED_AS_404.has(name)) expect(res.status).not.toBe(404)
    } else {
      expect(res.status).toBe(DENIED_AS_404.has(name) ? 404 : 403)
    }
  })
})

describe('GET /api/expert/clients — «Мои клиенты»', () => {
  const ids = async () => {
    const { GET } = await import('@/app/api/expert/clients/route')
    const res = await GET()
    return { status: res.status, ids: res.status === 200 ? ((await res.json()).data as Array<{ id: string }>).map((c) => c.id) : [] }
  }
  it('an expert sees only the clients assigned to them', async () => {
    db.current = EXPERT_ASSIGNED
    expect(await ids()).toEqual({ status: 200, ids: [CLIENT] })
    db.current = EXPERT_UNASSIGNED
    expect(await ids()).toEqual({ status: 200, ids: [OTHER_CLIENT] })
  })
  it('a staff admin sees every client', async () => {
    db.current = STAFF_ADMIN
    const got = (await ids()).ids
    expect(got).toEqual(expect.arrayContaining([CLIENT, OTHER_CLIENT]))
    expect(got).not.toContain(EXPERT_ASSIGNED)
  })
  it.each([EXPERT_REJECTED, LEGACY_ADMIN])('%s gets 403', async (id) => {
    db.current = id
    expect((await ids()).status).toBe(403)
  })
})

describe('share links (R-136)', () => {
  it('a new link expires after 90 days', async () => {
    db.current = EXPERT_ASSIGNED
    const { createShare } = await import('@/lib/share/tokens')
    const { POST } = await import('@/app/api/share/route')
    expect((await POST(json('/api/share', 'POST', { type: 'gri', companyId: COMPANY }))).status).toBe(200)
    expect(vi.mocked(createShare).mock.calls.at(-1)?.[0]).toMatchObject({ companyId: COMPANY, createdById: EXPERT_ASSIGNED, expiresInDays: 90 })
  })
})

describe('share links during impersonation (SR-07)', () => {
  it('no new link «от имени клиента»: 403 and nothing created', async () => {
    db.current = CLIENT
    db.impersonating = true
    const { createShare } = await import('@/lib/share/tokens')
    const { refuseDuringImpersonation } = await import('@/lib/impersonation/guard')
    vi.mocked(createShare).mockClear()
    const { POST } = await import('@/app/api/share/route')
    const res = await POST(json('/api/share', 'POST', { type: 'gri', companyId: COMPANY }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Недоступно в режиме просмотра от имени клиента')
    expect(vi.mocked(refuseDuringImpersonation).mock.calls.at(-1)?.[2]).toBe('share.create')
    expect(createShare).not.toHaveBeenCalled()
    db.impersonating = false
    expect((await POST(json('/api/share', 'POST', { type: 'gri', companyId: COMPANY }))).status).toBe(200)
  })
})

describe('lib/access/actor.ts — the rule of migration 140', () => {
  it('derives kind and scope from staff_roles and the status, never the legacy role alone', async () => {
    const { actorFromRows } = await import('@/lib/access/actor')
    const a = (profile: Row | null, staff: Row | null) => actorFromRows('u', { profile, staff })
    expect(a({ role: 'admin', status: 'approved' }, null)).toMatchObject({ kind: 'client', clientScope: 'none', staffRole: null })
    expect(a({ role: 'super_admin', status: 'approved' }, null)).toMatchObject({ kind: 'client', clientScope: 'none' })
    expect(a({ role: 'expert', status: 'rejected' }, null)).toMatchObject({ kind: 'client', clientScope: 'none', activeExpert: false })
    expect(a({ role: 'expert', status: 'approved' }, null)).toMatchObject({ kind: 'expert', clientScope: 'assigned' })
    expect(a({ role: 'client', status: 'approved' }, { role: 'admin', client_scope: 'assigned' })).toMatchObject({ kind: 'staff', clientScope: 'all' })
    expect(a({ role: 'client', status: 'approved' }, { role: 'super_expert', client_scope: 'assigned' })).toMatchObject({ kind: 'staff', clientScope: 'assigned' })
    expect(a({ role: 'client', status: 'approved' }, { role: 'support', client_scope: 'all' })).toMatchObject({ clientScope: 'all' })
    // No users.sensitive → no client data (staff_assigned_user_ids needs is_platform_staff()).
    expect(a({ role: 'client', status: 'approved' }, { role: 'analyst', client_scope: 'all' })).toMatchObject({ kind: 'staff', clientScope: 'none' })
    expect(a({ role: 'client', status: 'blocked' }, { role: 'admin' })).toMatchObject({ kind: 'client', staffRole: null })
  })

  it('MCP: the legacy super_admin profile is nobody; an expert is scoped to assigned clients', async () => {
    const { roleFromRow, clientScopeOf } = await import('@/lib/mcp/principal')
    const { clientFilterOf } = await import('@/lib/mcp/data')
    expect(roleFromRow({ email: null, profile_role: 'super_admin', status: 'approved', staff_role: null })).toBeNull()
    expect(roleFromRow({ email: null, profile_role: 'admin', status: 'approved', staff_role: null })).toBeNull()
    const expert = roleFromRow({ email: null, profile_role: 'expert', status: 'approved', staff_role: null })!
    expect(expert).toEqual({ kind: 'expert', profileRole: 'expert' })
    expect(clientScopeOf(expert, null)).toBe('assigned')
    expect(clientFilterOf({ userId: EXPERT_ASSIGNED, clientScope: 'assigned' })).toBe(EXPERT_ASSIGNED)
    const se = roleFromRow({ email: null, profile_role: 'client', status: 'approved', staff_role: 'super_expert', client_scope: 'assigned' })!
    expect(clientScopeOf(se, { email: null, profile_role: 'client', status: 'approved', staff_role: 'super_expert', client_scope: 'assigned' })).toBe('assigned')
    const admin = roleFromRow({ email: null, profile_role: 'client', status: 'approved', staff_role: 'admin', client_scope: 'assigned' })!
    expect(clientScopeOf(admin, { email: null, profile_role: 'client', status: 'approved', staff_role: 'admin', client_scope: 'assigned' })).toBe('all')
    expect(clientFilterOf({ userId: STAFF_ADMIN, clientScope: 'all' })).toBeNull()
  })
})
