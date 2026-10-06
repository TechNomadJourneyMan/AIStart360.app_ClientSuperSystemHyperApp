/**
 * Report API routes:
 *   client  GET /api/v1/reports, /api/v1/reports/:id, /api/v1/reports/:id/pdf —
 *           session client (RLS) + explicit status 'published' + lib/tenancy;
 *           401 without a session, 404 (never 403) for another tenant's or an
 *           unpublished version, no provenance and no driver errors in responses;
 *   GIGA    /api/giga-admin/reports/** and /api/giga-admin/ai-review/** —
 *           the permission is checked before any database access or audit write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const s = vi.hoisted(() => ({
  user: { id: 'user-a' } as { id: string } | null,
  rows: [] as Array<Record<string, unknown>>,
  dbError: null as { message: string; code: string } | null,
  queries: [] as Array<Array<[string, unknown]>>,
  tenant: { ok: true, tenant: { userId: 'user-a', companyId: 'co-a', role: 'owner', canManage: true, legacy: false } } as Record<string, unknown>,
  tenantCalls: [] as Array<Record<string, unknown>>,
  role: 'admin' as string,
  touched: 0,
  audits: 0,
}))

function sessionClient() {
  return {
    auth: { getUser: async () => ({ data: { user: s.user }, error: null }) },
    from(table: string) {
      expect(table).toBe('report_versions')
      const filters: Array<[string, unknown]> = []
      s.queries.push(filters)
      const result = (single: boolean) => {
        if (s.dbError) return { data: null, error: s.dbError }
        const rows = s.rows.filter((r) => filters.every(([c, v]) => r[c] === v))
        return { data: single ? rows[0] ?? null : rows, error: null }
      }
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
        order: () => b,
        limit: async () => result(false),
        maybeSingle: async () => result(true),
      }
      return b
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => sessionClient() }))
vi.mock('@/lib/tenancy', () => ({
  resolveTenantWith: async (_c: unknown, userId: string | null, opts: Record<string, unknown>) => {
    s.tenantCalls.push({ userId, ...opts })
    if (!userId) return { ok: false, status: 401, error: 'unauthenticated' }
    if (opts.companyId && opts.companyId !== 'co-a') return { ok: false, status: 404, error: 'no_company' }
    return s.tenant
  },
  tenantErrorMessage: (e: string) => ({ unauthenticated: 'Требуется вход в систему', forbidden: 'Нет доступа к компании', no_company: 'Компания не найдена' }[e]),
}))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: 'session', role: s.role as StaffRole })),
    STAFF_COOKIE_NAME: 'x',
    STAFF_COOKIE_TTL_SECONDS: 60,
  }
})
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => { s.audits++; return true } }))
const versions = vi.hoisted(() => ({
  listReportVersions: vi.fn(), getReportVersion: vi.fn(), publishReportVersion: vi.fn(), retireReportVersion: vi.fn(),
}))
vi.mock('@/lib/reports/versions', () => ({
  listReportVersions: (...a: unknown[]) => { s.touched++; return versions.listReportVersions(...a) },
  getReportVersion: (...a: unknown[]) => { s.touched++; return versions.getReportVersion(...a) },
  publishReportVersion: (...a: unknown[]) => { s.touched++; return versions.publishReportVersion(...a) },
  retireReportVersion: (...a: unknown[]) => { s.touched++; return versions.retireReportVersion(...a) },
}))
const review = vi.hoisted(() => ({ listReviewQueue: vi.fn(), reviewItem: vi.fn(), reviewItemCompany: vi.fn() }))
vi.mock('@/lib/reports/review', () => ({
  listReviewQueue: (...a: unknown[]) => { s.touched++; return review.listReviewQueue(...a) },
  reviewItem: (...a: unknown[]) => { s.touched++; return review.reviewItem(...a) },
  reviewItemCompany: (...a: unknown[]) => { s.touched++; return review.reviewItemCompany(...a) },
}))

const { buildPointAReportContent } = await import('@/lib/reports/snapshot')
const { inputs } = await import('../reports/fixtures')
const list = await import('@/app/api/v1/reports/route')
const one = await import('@/app/api/v1/reports/[id]/route')
const pdf = await import('@/app/api/v1/reports/[id]/pdf/route')
const gList = await import('@/app/api/giga-admin/reports/route')
const gOne = await import('@/app/api/giga-admin/reports/[id]/route')
const gPdf = await import('@/app/api/giga-admin/reports/[id]/pdf/route')
const gQueue = await import('@/app/api/giga-admin/ai-review/route')
const gReview = await import('@/app/api/giga-admin/ai-review/[kind]/[id]/route')

const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const B1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const content = buildPointAReportContent(inputs()).content
const row = (id: string, company: string, status: string, version: number) => ({
  id, company_id: company, report_type: 'point_a', version, title: 'Точка А: ТОО Ромашка', confidence: '0.62', data_hash: 'f'.repeat(64),
  published_at: status === 'published' ? '2026-10-06T10:00:00.000Z' : null, status, content,
  provenance: { staff: { hidden_hypotheses: 3 } },
})

const get = (url: string) => new NextRequest(`http://localhost${url}`)
const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

beforeEach(() => {
  s.user = { id: 'user-a' }
  s.rows = [row(A1, 'co-a', 'published', 1), row(A2, 'co-a', 'ready', 2), row(B1, 'co-b', 'published', 1)]
  s.dbError = null
  s.queries = []
  s.tenantCalls = []
  s.role = 'admin'
  s.touched = 0
  s.audits = 0
  for (const f of [...Object.values(versions), ...Object.values(review)]) f.mockReset()
})

describe('client: GET /api/v1/reports', () => {
  it('401 without a session, 404 without a company', async () => {
    s.user = null
    expect((await list.GET(get('/api/v1/reports'))).status).toBe(401)
    s.user = { id: 'user-a' }
    const prev = s.tenant
    s.tenant = { ok: false, status: 404, error: 'no_company' }
    const res = await list.GET(get('/api/v1/reports'))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'no_company' })
    s.tenant = prev
  })

  it('lists only published versions of the resolved company, without provenance', async () => {
    const res = await list.GET(get('/api/v1/reports'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(s.queries[0]).toEqual([['company_id', 'co-a'], ['status', 'published']])
    expect(body.data.items.map((i: { id: string }) => i.id)).toEqual([A1])
    expect(body.data.items[0]).toMatchObject({ version: 1, findings: content.findings.length, overall_score: 47, confidence: 0.62 })
    expect(JSON.stringify(body)).not.toContain('hidden_hypotheses')
  })

  it('another company id from the query goes through tenancy (404 for a foreign one)', async () => {
    const res = await list.GET(get('/api/v1/reports?companyId=co-b'))
    expect(res.status).toBe(404)
    expect(s.tenantCalls[0]).toMatchObject({ companyId: 'co-b', access: 'read' })
    expect(s.queries).toHaveLength(0)
  })

  it('a database error is a generic message, not the driver text', async () => {
    s.dbError = { message: 'relation "public.report_versions" does not exist', code: '42P01' }
    const res = await list.GET(get('/api/v1/reports'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, code: 'DB_ERROR' })
    expect(JSON.stringify(body)).not.toContain('relation')
  })
})

describe('client: GET /api/v1/reports/:id and /pdf', () => {
  it('401 without a session; 404 for a malformed id without touching the database', async () => {
    s.user = null
    expect((await one.GET(get(`/api/v1/reports/${A1}`), { params: { id: A1 } })).status).toBe(401)
    s.user = { id: 'user-a' }
    expect((await one.GET(get('/api/v1/reports/x'), { params: { id: 'x' } })).status).toBe(404)
    expect(s.queries).toHaveLength(0)
  })

  it('returns a published version of the own company with its frozen content', async () => {
    const res = await one.GET(get(`/api/v1/reports/${A1}`), { params: { id: A1 } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(s.queries[0]).toEqual([['id', A1], ['status', 'published']])
    expect(body.data).toMatchObject({ id: A1, version: 1, company_id: 'co-a' })
    expect(body.data.content.findings).toHaveLength(content.findings.length)
    expect(body.data).not.toHaveProperty('provenance')
  })

  it('an unpublished version is a 404', async () => {
    expect((await one.GET(get(`/api/v1/reports/${A2}`), { params: { id: A2 } })).status).toBe(404)
  })

  it("another tenant's published version is a 404, never a 403 (tenancy decides even if a row is readable)", async () => {
    const res = await one.GET(get(`/api/v1/reports/${B1}`), { params: { id: B1 } })
    expect(res.status).toBe(404)
    expect(s.tenantCalls.at(-1)).toMatchObject({ companyId: 'co-b' })
    expect((await pdf.GET(get(`/api/v1/reports/${B1}/pdf`), { params: { id: B1 } })).status).toBe(404)
  })

  it('the PDF of an own published version is rendered from the content', async () => {
    const res = await pdf.GET(get(`/api/v1/reports/${A1}/pdf`), { params: { id: A1 } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="aistart360-point_a-v1.pdf"')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})

describe('GIGA: permissions are checked before any data access', () => {
  const ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const cases: Array<{ name: string; roles: StaffRole[]; call: () => Promise<Response> }> = [
    { name: 'list versions', roles: ['super_expert', 'content_manager', 'support'], call: () => gList.GET(get('/api/giga-admin/reports')) },
    { name: 'view version', roles: ['super_expert', 'content_manager', 'support'], call: () => gOne.GET(get(`/api/giga-admin/reports/${ID}`), { params: { id: ID } }) },
    { name: 'version PDF', roles: ['super_expert', 'content_manager', 'support'], call: () => gPdf.GET(get(`/api/giga-admin/reports/${ID}/pdf`), { params: { id: ID } }) },
    { name: 'publish', roles: ['super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'], call: () => gOne.POST(post(`/api/giga-admin/reports/${ID}`, { action: 'publish' }), { params: { id: ID } }) },
    { name: 'review queue', roles: ['super_expert', 'analyst', 'support'], call: () => gQueue.GET(get('/api/giga-admin/ai-review')) },
    { name: 'review decision', roles: ['super_expert', 'analyst', 'support'], call: () => gReview.POST(post(`/api/giga-admin/ai-review/finding/${ID}`, { decision: 'approve' }), { params: { kind: 'finding', id: ID } }) },
  ]
  for (const c of cases) {
    it(`${c.name}: 403 for ${c.roles.join(', ')}`, async () => {
      for (const role of c.roles) {
        s.role = role
        expect((await c.call()).status, `${c.name} as ${role}`).toBe(403)
      }
      expect(s.touched).toBe(0)
      expect(s.audits).toBe(0)
    })
  }

  it('only admin and super_admin may publish; analysts may view', async () => {
    const { hasPermission } = await import('@/lib/admin/rbac')
    expect(hasPermission('admin', 'reports.publish')).toBe(true)
    expect(hasPermission('super_admin', 'reports.publish')).toBe(true)
    for (const r of ['super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'] as const) expect(hasPermission(r, 'reports.publish')).toBe(false)
    s.role = 'analyst'
    versions.listReportVersions.mockResolvedValue([])
    const res = await gList.GET(get('/api/giga-admin/reports?status=ready&company=co-a'))
    expect(await res.json()).toMatchObject({ ok: true, can: { publish: false, run: false } })
    expect(versions.listReportVersions).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready', companyId: 'co-a' }))
  })
})

describe('GIGA: version actions', () => {
  const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const current = { id: ID, status: 'ready', company_id: 'co-a', report_type: 'point_a', version: 2, data_hash: 'h' }

  it('404 for a malformed or unknown id, before the audit', async () => {
    expect((await gOne.POST(post('/api/giga-admin/reports/x', { action: 'publish' }), { params: { id: 'x' } })).status).toBe(404)
    versions.getReportVersion.mockResolvedValue(null)
    expect((await gOne.POST(post(`/api/giga-admin/reports/${ID}`, { action: 'publish' }), { params: { id: ID } })).status).toBe(404)
    expect(s.audits).toBe(0)
  })

  it('reject and withdraw need a reason; unknown actions are refused', async () => {
    for (const body of [{ action: 'reject' }, { action: 'withdraw', reason: 'x' }, { action: 'delete' }]) {
      expect((await gOne.POST(post(`/api/giga-admin/reports/${ID}`, body), { params: { id: ID } })).status).toBe(400)
    }
    expect(s.touched).toBe(0)
  })

  it('publish: audit first, then the transition; a wrong status is a conflict', async () => {
    versions.getReportVersion.mockResolvedValue(current)
    versions.publishReportVersion.mockResolvedValue({ ok: true, status: 'published', superseded: ['old'] })
    const ok = await gOne.POST(post(`/api/giga-admin/reports/${ID}`, { action: 'publish' }), { params: { id: ID } })
    expect(await ok.json()).toEqual({ ok: true, status: 'published', superseded: ['old'] })
    expect(s.audits).toBe(1)
    expect(versions.publishReportVersion).toHaveBeenCalledWith(ID, 'staff-1')

    versions.publishReportVersion.mockResolvedValue({ ok: false, reason: 'wrong_status', status: 'superseded' })
    const conflict = await gOne.POST(post(`/api/giga-admin/reports/${ID}`, { action: 'publish' }), { params: { id: ID } })
    expect(conflict.status).toBe(409)
  })

  it('withdraw passes the reason through', async () => {
    versions.getReportVersion.mockResolvedValue({ ...current, status: 'published' })
    versions.retireReportVersion.mockResolvedValue({ ok: true, status: 'superseded', superseded: [ID] })
    const res = await gOne.POST(post(`/api/giga-admin/reports/${ID}`, { action: 'withdraw', reason: 'Перепроверяем выручку' }), { params: { id: ID } })
    expect(res.status).toBe(200)
    expect(versions.retireReportVersion).toHaveBeenCalledWith(ID, 'withdraw', 'staff-1', 'Перепроверяем выручку')
  })

  it('a database failure is reported generically', async () => {
    versions.getReportVersion.mockRejectedValue(Object.assign(new Error('connection to 10.0.0.5 refused'), { code: 'P1001' }))
    const res = await gOne.GET(get(`/api/giga-admin/reports/${ID}`), { params: { id: ID } })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.5')
  })
})

describe('GIGA: AI review decisions', () => {
  const ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  it('unknown kind or id → 404; dismiss without a reason → 400', async () => {
    s.role = 'content_manager'
    expect((await gReview.POST(post(`/api/giga-admin/ai-review/metric/${ID}`, { decision: 'approve' }), { params: { kind: 'metric', id: ID } })).status).toBe(404)
    expect((await gReview.POST(post('/api/giga-admin/ai-review/finding/x', { decision: 'approve' }), { params: { kind: 'finding', id: 'x' } })).status).toBe(404)
    expect((await gReview.POST(post(`/api/giga-admin/ai-review/finding/${ID}`, { decision: 'dismiss' }), { params: { kind: 'finding', id: ID } })).status).toBe(400)
    expect(s.touched).toBe(0)
  })

  it('approve: audit, then the decision; already decided → 409', async () => {
    s.role = 'crm_manager'
    review.reviewItemCompany.mockResolvedValue({ company_id: 'co-a', title: 'Гипотеза' })
    review.reviewItem.mockResolvedValue({ ok: true, kind: 'finding', id: ID, company_id: 'co-a', status: 'active', visible_to_client: true })
    const ok = await gReview.POST(post(`/api/giga-admin/ai-review/finding/${ID}`, { decision: 'approve' }), { params: { kind: 'finding', id: ID } })
    expect(ok.status).toBe(200)
    expect(s.audits).toBe(1)
    expect(review.reviewItem).toHaveBeenCalledWith({ kind: 'finding', id: ID, decision: 'approve', actorId: 'staff-1' })
    review.reviewItem.mockResolvedValue({ ok: false, reason: 'already_reviewed' })
    expect((await gReview.POST(post(`/api/giga-admin/ai-review/finding/${ID}`, { decision: 'approve' }), { params: { kind: 'finding', id: ID } })).status).toBe(409)
  })
})
