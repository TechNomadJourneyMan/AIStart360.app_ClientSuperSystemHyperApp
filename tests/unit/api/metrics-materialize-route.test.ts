/**
 * POST /api/v1/metrics/materialize: a failed write (upsert or the stale-row
 * cleanup) is a 500 { ok:false } — with ok:true the client refetched an empty
 * catalog and told the user «Значений пока нет — заполните анкету».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  result: { total: 148, written: 0, skipped: 140, pruned: 0, errors: [] as Array<{ metricId: string; error: string }> },
  canManage: true,
  runs: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) } }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/tenancy', () => ({
  resolveTenantWith: async () => ({ ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: h.canManage ? 'owner' : 'viewer', canManage: h.canManage, legacy: false } }),
  tenantErrorMessage: () => 'Нет доступа',
}))
vi.mock('@/lib/metrics/materialize-tenant', () => ({
  materializeForTenant: async () => { h.runs += 1; return { result: h.result, values: [], ctx: {} } },
}))

const { POST, GET } = await import('@/app/api/v1/metrics/materialize/route')
const call = async () => {
  const res = await POST(new Request('http://localhost/api/v1/metrics/materialize', { method: 'POST' }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.result = { total: 148, written: 8, skipped: 140, pruned: 0, errors: [] }
  h.canManage = true
  h.runs = 0
})

describe('POST /api/v1/metrics/materialize', () => {
  it('a successful write is ok:true', async () => {
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, data: { written: 8, errors: [] } })
  })

  it('a failed upsert is a 500 ok:false', async () => {
    h.result = { total: 148, written: 0, skipped: 140, pruned: 0, errors: [{ metricId: '*', error: 'check constraint violated' }] }
    const { status, body } = await call()
    expect(status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.data.errors).toHaveLength(1)
  })

  it('a failed stale-row cleanup is reported too', async () => {
    h.result = { total: 148, written: 8, skipped: 140, pruned: 0, errors: [{ metricId: '*prune', error: 'permission denied' }] }
    const { status, body } = await call()
    expect(status).toBe(500)
    expect(body.ok).toBe(false)
  })
})

describe('R-147: writing is POST with the right to manage; GET only reads', () => {
  it('GET never writes: it answers whether the caller may recalculate', async () => {
    const res = await GET(new Request('http://localhost/api/v1/metrics/materialize'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, data: { companyId: 'co-1', canMaterialize: true, method: 'POST' } })
    expect(h.runs).toBe(0)
  })

  it('GET for a reader: canMaterialize false, still no write', async () => {
    h.canManage = false
    const res = await GET(new Request('http://localhost/api/v1/metrics/materialize'))
    expect((await res.json()).data.canMaterialize).toBe(false)
    expect(h.runs).toBe(0)
  })

  it('POST with only the read right (viewer / member / partner_expert) → 403 read_only, no write', async () => {
    h.canManage = false
    const { status, body } = await call()
    expect(status).toBe(403)
    expect(body).toMatchObject({ ok: false, code: 'read_only' })
    expect(h.runs).toBe(0)
  })

  it('POST with the right to manage writes', async () => {
    const { status } = await call()
    expect(status).toBe(200)
    expect(h.runs).toBe(1)
  })
})
