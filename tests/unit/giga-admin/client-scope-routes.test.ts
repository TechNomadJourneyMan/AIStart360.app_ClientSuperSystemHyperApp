/**
 * R-047: the client scope ('assigned', staff_roles.client_scope) holds on every
 * client-specific GIGA route — through one helper (requireGigaClient /
 * requireGigaCompany / requireGigaReport, or the older shared guards), never a
 * hand-written condition that a new route can forget. Plus: users/bulk cannot
 * be used to assign oneself foreign clients.
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const MY_CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const FOREIGN_CLIENT = 'cccccccc-0000-4000-8000-000000000002'
const MY_COMPANY = 'co-mine'
const FOREIGN_COMPANY = 'co-foreign'
const MY_REPORT = 'eeeeeeee-0000-4000-8000-000000000001'
const FOREIGN_REPORT = 'eeeeeeee-0000-4000-8000-000000000002'

const s = vi.hoisted(() => ({
  role: 'super_expert' as string,
  scope: 'assigned' as 'all' | 'assigned',
  touched: [] as string[],
}))

const TABLES: Record<string, Array<Record<string, unknown>>> = {
  user_assignments: [{ user_id: MY_CLIENT, assignee_id: ME }, { user_id: FOREIGN_CLIENT, assignee_id: 'someone-else' }],
  companies: [{ id: MY_COMPANY, user_id: MY_CLIENT }, { id: FOREIGN_COMPANY, user_id: FOREIGN_CLIENT }],
  report_versions: [{ id: MY_REPORT, company_id: MY_COMPANY }, { id: FOREIGN_REPORT, company_id: FOREIGN_COMPANY }],
}

function query(table: string) {
  const filters: Record<string, string> = {}
  let inFilter: [string, string[]] | null = null
  const rows = () => (TABLES[table] ?? []).filter((r) =>
    Object.entries(filters).every(([k, v]) => String(r[k]) === v) && (!inFilter || inFilter[1].includes(String(r[inFilter[0]]))))
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (col: string, v: string) => { filters[col] = v; return q },
    in: (col: string, v: string[]) => { inFilter = [col, v]; return q },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
  }
  s.touched.push(table)
  return q
}

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: (t: string) => query(t) }) }))
vi.mock('@/lib/admin/giga-actor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/giga-actor')>()
  const { makeRequireGiga } = await import('../_giga-guard')
  const inner = makeRequireGiga(() => ({ id: ME, kind: 'session', role: s.role as StaffRole }))
  return {
    ...actual,
    requireGiga: async (req: unknown, p: Parameters<typeof inner>[1]) => {
      const g = await inner(req, p)
      return g.actor ? { actor: { ...g.actor, clientScope: s.scope } } : g
    },
  }
})
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => true }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))

const scope = await import('@/lib/admin/client-scope')
const req = (url = 'http://localhost/api/giga-admin/x', init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(url, init)

describe('R-047: one-call scope guards', () => {
  beforeEach(() => { s.role = 'super_expert'; s.scope = 'assigned'; s.touched = [] })

  it('R-047: requireGigaClient refuses a foreign client for an assigned-scope actor, admits their own', async () => {
    const foreign = await scope.requireGigaClient(req(), 'users.view', FOREIGN_CLIENT)
    expect(foreign.response?.status).toBe(403)
    const mine = await scope.requireGigaClient(req(), 'users.view', MY_CLIENT)
    expect(mine.actor?.id).toBe(ME)
  })

  it('R-047: requireGigaCompany / requireGigaReport resolve the owner and apply the same scope', async () => {
    expect((await scope.requireGigaCompany(req(), 'company.edit', FOREIGN_COMPANY)).response?.status).toBe(403)
    expect((await scope.requireGigaCompany(req(), 'company.edit', MY_COMPANY)).actor).toBeTruthy()
    expect((await scope.requireGigaCompany(req(), 'company.edit', 'co-missing')).response?.status).toBe(404)
    expect((await scope.requireGigaReport(req(), 'reports.review', FOREIGN_REPORT)).response?.status).toBe(403)
    expect((await scope.requireGigaReport(req(), 'reports.review', MY_REPORT)).actor).toBeTruthy()
  })

  it("R-047: scope 'all' never reads assignments", async () => {
    s.scope = 'all'
    expect((await scope.requireGigaClient(req(), 'users.view', FOREIGN_CLIENT)).actor).toBeTruthy()
    expect((await scope.requireGigaCompany(req(), 'users.view', FOREIGN_COMPANY)).actor).toBeTruthy()
    expect(s.touched).toEqual([])
  })

  it('R-047: the previously unscoped routes refuse a foreign client (timeline, billing, review, integrations, reports)', async () => {
    const cases: Array<[string, () => Promise<Response>]> = [
      ['timeline', async () => (await import('@/app/api/giga-admin/users/[id]/timeline/route')).GET(req(), { params: { id: FOREIGN_CLIENT } })],
      ['billing', async () => (await import('@/app/api/giga-admin/users/[id]/billing/route')).GET(req(), { params: { id: FOREIGN_CLIENT } })],
      ['billing/transactions', async () => (await import('@/app/api/giga-admin/users/[id]/billing/transactions/route')).GET(req(), { params: { id: FOREIGN_CLIENT } })],
      ['review', async () => (await import('@/app/api/giga-admin/users/[id]/review/route')).GET(req(), { params: { id: FOREIGN_CLIENT } })],
      ['reports/:id/review', async () => (await import('@/app/api/giga-admin/reports/[id]/review/route')).GET(req(), { params: { id: FOREIGN_REPORT } })],
      ['reports/:id/pdf', async () => (await import('@/app/api/giga-admin/reports/[id]/pdf/route')).GET(req(), { params: { id: FOREIGN_REPORT } })],
      ['integrations test', async () => (await import('@/app/api/giga-admin/integrations/[companyId]/[provider]/test/route')).POST(
        req('http://localhost/x', { method: 'POST' }), { params: { companyId: FOREIGN_COMPANY, provider: 'ga4' } })],
    ]
    for (const [name, call] of cases) {
      const res = await call()
      expect(res.status, name).toBe(403)
      expect((await res.json()).error, name).toBe(scope.NOT_ASSIGNED_ERROR)
    }
  })

  it('R-047: users/bulk «assign» needs the right to manage assignments; other actions skip foreign clients', async () => {
    const { POST } = await import('@/app/api/giga-admin/users/bulk/route')
    const body = (b: unknown) => req('http://localhost/api/giga-admin/users/bulk', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } })
    const assign = await POST(body({ action: 'assign', ids: [FOREIGN_CLIENT], assigneeId: ME }))
    expect(assign.status).toBe(403)
    s.role = 'support'
    expect((await POST(body({ action: 'assign', ids: [FOREIGN_CLIENT], assigneeId: ME }))).status).toBe(403)
    const { canManageAssignments } = await import('@/lib/admin/rbac')
    expect(['super_admin', 'admin', 'crm_manager'].every((r) => canManageAssignments(r as StaffRole))).toBe(true)
    expect(['super_expert', 'support', 'analyst', 'content_manager'].some((r) => canManageAssignments(r as StaffRole))).toBe(false)
  })
})

describe('R-047: inventory of client-specific GIGA routes', () => {
  const root = path.resolve(__dirname, '../../../app/api/giga-admin')
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === 'route.ts' ? [path.join(dir, e.name)] : [])
  const CLIENT_ROUTE = /^(users\/\[id\]\/|requests\/\[id\]\/|integrations\/\[companyId\]\/|reports\/\[id\]\/|reports\/\[id\]\/route|comm\/users\/\[userId\]\/|surveys\/\[userId\]\/|cases\/\[id\]\/)/
  const SCOPE_HELPER = /\b(requireGigaClient|requireGigaCompany|requireGigaReport|guardClientAccess|guardPlanRoute|guardPointAExpert|guardComm|authorizeUserDataRead|scopeAllows)\b/
  /** Not client data (or guarded by another rule) — keep this list short and explained. */
  const EXEMPT: Record<string, string> = {
    // A decision on an applicant: the intake queue, usually without an assignee
    // yet; the target's rank and the status transition are checked in
    // lib/users/access-requests.ts decideAccessRequest (R-007).
    'requests/[id]/route.ts': 'intake decision, R-007',
  }

  it('R-047: every route that works with ONE client checks the client scope through a shared helper', () => {
    const rel = walk(root).map((f) => path.relative(root, f).split(path.sep).join('/')).filter((f) => !f.startsWith('impersonation/'))
    const client = rel.filter((f) => CLIENT_ROUTE.test(f))
    expect(client.length).toBeGreaterThan(70)
    const missing = client.filter((f) => !EXEMPT[f] && !SCOPE_HELPER.test(fs.readFileSync(path.join(root, f), 'utf8')))
    expect(missing).toEqual([])
  })

  it('R-047: client lists are filtered by the scope', () => {
    for (const f of ['reports/route.ts', 'reports/review/route.ts', 'integrations/route.ts', 'integrations/companies/route.ts', 'requests/route.ts']) {
      expect(fs.readFileSync(path.join(root, f), 'utf8'), f).toMatch(/scopedCompanyIds|scopedClientIds|filterByScope/)
    }
  })
})
