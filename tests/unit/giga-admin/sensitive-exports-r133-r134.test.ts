/**
 * R-133: an analyst (no users.sensitive) gets neither a report's content / PDF
 * nor Point A diagnostics of a request, and sees masked e-mails in the request
 * list. R-134: the CSV export of users is written to the GIGA audit journal
 * before the file is handed out (no journal — no file).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const REPORT = 'eeeeeeee-0000-4000-8000-000000000001'

const s = vi.hoisted(() => ({
  role: 'analyst' as string,
  audit: [] as Array<{ action: string; metadata?: Record<string, unknown>; required?: boolean }>,
  auditFails: false,
}))

function query(table: string) {
  const rows = (): Array<Record<string, unknown>> => {
    if (table === 'profiles') return [{ id: CLIENT, email: 'ivan.petrov@mail.ru', full_name: 'Иван', organization: null, status: 'approved', role: 'client', created_at: '2026-11-01T00:00:00Z' }]
    if (table === 'admin_requests') return [{ id: 'r1', type: 'registration', status: 'new', payload: { userId: 'u-2', email: 'olga@corp.kz', name: 'Ольга' }, created_at: '2026-11-02T00:00:00Z' }]
    if (table === 'diagnostics') return [{ id: 'd1', user_id: CLIENT, revenue: 1_000_000 }]
    return []
  }
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, range: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
  }
  return q
}

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (t: string) => query(t),
    rpc: async () => ({ data: [{ id: CLIENT, email: 'ivan.petrov@mail.ru', phone: '+77011234567', full_name: 'Иван', total_count: 1 }], error: null }),
  }),
}))
vi.mock('@/lib/admin/giga-actor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/giga-actor')>()
  const { makeRequireGiga } = await import('../_giga-guard')
  const inner = makeRequireGiga(() => ({ id: ME, kind: 'session', role: s.role as StaffRole }))
  return {
    ...actual,
    requireGiga: async (req: unknown, p: Parameters<typeof inner>[1]) => {
      const g = await inner(req, p)
      return g.actor ? { actor: { ...g.actor, clientScope: 'all' } } : g
    },
  }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, entry: { action: string; metadata?: Record<string, unknown> }, _r: unknown, opts?: { required?: boolean }) => {
    if (s.auditFails) {
      if (opts?.required) throw new Error('Audit log unavailable — action refused')
      return false
    }
    s.audit.push({ ...entry, required: opts?.required })
    return true
  },
}))
vi.mock('@/lib/expert-auth', () => ({ resolveExpert: async () => ({ ok: false, block: 'forbidden' }), expertBlockResponse: () => new Response(null, { status: 403 }) }))
vi.mock('@/lib/reports/versions', () => ({ getReportVersion: async () => ({ id: REPORT, company_id: 'co', content: { secret: true }, provenance: {} }) }))

const req = (url: string) => new NextRequest(url)

describe('R-133: sensitive client data needs users.sensitive', () => {
  beforeEach(() => { s.role = 'analyst'; s.audit = []; s.auditFails = false })

  it('R-133: an analyst gets 403 on a report version content and its PDF', async () => {
    const detail = await (await import('@/app/api/giga-admin/reports/[id]/route')).GET(req('http://localhost/x'), { params: { id: REPORT } })
    expect(detail.status).toBe(403)
    const pdf = await (await import('@/app/api/giga-admin/reports/[id]/pdf/route')).GET(req('http://localhost/x'), { params: { id: REPORT } })
    expect(pdf.status).toBe(403)
  })

  it('R-133: an analyst gets 403 on the Point A diagnostics of a request', async () => {
    const res = await (await import('@/app/api/giga-admin/requests/[id]/diagnostics/route')).GET(req('http://localhost/x'), { params: { id: CLIENT } })
    expect(res.status).toBe(403)
  })

  it('R-133: the request list masks e-mails without users.sensitive, shows them with it', async () => {
    const { GET } = await import('@/app/api/giga-admin/requests/route')
    const masked = await (await GET(req('http://localhost/api/giga-admin/requests'))).json()
    const emails = masked.requests.map((r: { userEmail: string }) => r.userEmail).sort()
    expect(emails).toEqual(['i***@mail.ru', 'o***@corp.kz'])
    expect(JSON.stringify(masked)).not.toContain('ivan.petrov@mail.ru')
    s.role = 'crm_manager'
    const open = await (await GET(req('http://localhost/api/giga-admin/requests'))).json()
    expect(open.requests.map((r: { userEmail: string }) => r.userEmail).sort()).toEqual(['ivan.petrov@mail.ru', 'olga@corp.kz'])
  })
})

describe('R-134: the users CSV export is audited', () => {
  beforeEach(() => { s.role = 'crm_manager'; s.audit = []; s.auditFails = false })

  it('R-134: a successful export writes users.exported (required) with the filters and the row count', async () => {
    const { GET } = await import('@/app/api/giga-admin/users/export/route')
    const res = await GET(req('http://localhost/api/giga-admin/users/export?status=approved'))
    expect(res.status).toBe(200)
    expect(s.audit).toHaveLength(1)
    expect(s.audit[0]).toMatchObject({ action: 'users.exported', required: true })
    expect(s.audit[0].metadata).toMatchObject({ rows: 1, sensitive: true, filters: expect.objectContaining({ status: 'approved' }) })
  })

  it('R-134: no journal — no file', async () => {
    s.auditFails = true
    const { GET } = await import('@/app/api/giga-admin/users/export/route')
    const res = await GET(req('http://localhost/api/giga-admin/users/export'))
    expect(res.status).toBe(503)
  })
})
