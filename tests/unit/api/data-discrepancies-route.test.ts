/**
 * POST /api/v1/data/discrepancies/[id]/resolve and GET /api/v1/data/discrepancies:
 * session identity, manage access for decisions, body validation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  user: { id: 'u-1' } as { id: string } | null,
  tenant: { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } } as Record<string, unknown>,
  resolve: vi.fn(),
  emit: vi.fn(),
  refresh: vi.fn(),
  rows: [] as unknown[],
  readError: null as null | { code: string },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from: () => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: h.readError ? null : h.rows, error: h.readError }).then(res)
      return b
    },
  }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/tenancy', () => ({ resolveTenantWith: vi.fn(async () => h.tenant), tenantErrorMessage: () => 'Нет доступа' }))
vi.mock('@/lib/data-layer/resolve', () => ({ resolveDiscrepancy: h.resolve }))
vi.mock('@/lib/data-layer/refresh', () => ({ refreshCompanyDataInBackground: h.refresh }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: h.emit }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }))

const { POST } = await import('@/app/api/v1/data/discrepancies/[id]/resolve/route')
const { GET } = await import('@/app/api/v1/data/discrepancies/route')
const tenancy = await import('@/lib/tenancy')
const ID = '0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3'

const post = async (body: unknown, id = ID) => {
  const res = await POST(new Request(`http://localhost/api/v1/data/discrepancies/${id}/resolve`, { method: 'POST', body: JSON.stringify(body) }), { params: { id } })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.user = { id: 'u-1' }
  h.tenant = { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } }
  h.resolve.mockReset().mockResolvedValue({ ok: true, status: 'resolved_user', value: 14, overrides: ['m'] })
  h.emit.mockReset()
  h.refresh.mockReset()
  h.rows = []
  h.readError = null
})

describe('POST resolve', () => {
  it('unauthenticated → 401; another company → the tenant status', async () => {
    h.user = null
    expect((await post({ choice: 'ignore' })).status).toBe(401)
    h.user = { id: 'u-1' }
    h.tenant = { ok: false, status: 404, error: 'no_company' }
    expect((await post({ choice: 'ignore' })).status).toBe(404)
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('asks for manage access with the session user', async () => {
    await post({ choice: 'ignore' })
    expect(tenancy.resolveTenantWith).toHaveBeenLastCalledWith(expect.anything(), 'u-1', expect.objectContaining({ access: 'manage' }))
  })

  it('a malformed body or id → 400 / 404', async () => {
    expect((await post({ choice: 'custom', value: 'много' })).status).toBe(400)
    expect((await post({ choice: 'whatever' })).status).toBe(400)
    expect((await post({ choice: 'ignore' }, 'not-a-uuid')).status).toBe(404)
  })

  it('decides, emits DISCREPANCY_RESOLVED and refreshes the company data', async () => {
    const { status, body } = await post({ choice: 'candidate', index: 1 })
    expect(status).toBe(200)
    expect(body.data).toEqual({ status: 'resolved_user', value: 14, overrides: ['m'] })
    expect(h.resolve).toHaveBeenCalledWith(expect.anything(), 'co-1', ID, { choice: 'candidate', index: 1 }, { userId: 'u-1', expert: false })
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'DISCREPANCY_RESOLVED', companyId: 'co-1' }))
    expect(h.refresh).toHaveBeenCalledWith('co-1')
  })

  it('an expert decides as an expert', async () => {
    h.tenant = { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'partner_expert', canManage: true, legacy: false } }
    await post({ choice: 'ignore' })
    expect(h.resolve.mock.calls[0][4]).toEqual({ userId: 'u-1', expert: true })
  })

  it('a refusal from the data layer is passed through without side effects', async () => {
    h.resolve.mockResolvedValue({ ok: false, status: 409, error: 'already_closed' })
    const { status, body } = await post({ choice: 'ignore' })
    expect(status).toBe(409)
    expect(body.error).toBe('Расхождение уже закрыто')
    expect(h.emit).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })
})

describe('GET list', () => {
  it('labels the metric and the period', async () => {
    h.rows = [{ id: 'x', metric_key: 'biz.finansy.vyruchka_god', period_key: '2024-Q2', kind: 'conflict', status: 'open' }]
    const res = await GET(new Request('http://localhost/api/v1/data/discrepancies'))
    const body = await res.json()
    expect(body.data.migrated).toBe(true)
    expect(body.data.items[0]).toMatchObject({ metric_label: 'Выручка (год)', period_label: 'II кв. 2024' })
  })

  it('before migration 110: an empty list', async () => {
    h.readError = { code: '42P01' }
    const body = await (await GET(new Request('http://localhost/api/v1/data/discrepancies'))).json()
    expect(body).toEqual({ ok: true, data: { items: [], migrated: false } })
  })
})
