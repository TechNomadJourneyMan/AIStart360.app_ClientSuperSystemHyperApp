/**
 * POST /api/v1/metrics/materialize: a failed write (upsert or the stale-row
 * cleanup) is a 500 { ok:false } — with ok:true the client refetched an empty
 * catalog and told the user «Значений пока нет — заполните анкету».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  result: { total: 148, written: 0, skipped: 140, pruned: 0, errors: [] as Array<{ metricId: string; error: string }> },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) } }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/tenancy', () => ({
  resolveTenantWith: async () => ({ ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } }),
  tenantErrorMessage: () => 'Нет доступа',
}))
vi.mock('@/lib/metrics/materialize-tenant', () => ({
  materializeForTenant: async () => ({ result: h.result, values: [], ctx: {} }),
}))

const { POST } = await import('@/app/api/v1/metrics/materialize/route')
const call = async () => {
  const res = await POST(new Request('http://localhost/api/v1/metrics/materialize', { method: 'POST' }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.result = { total: 148, written: 8, skipped: 140, pruned: 0, errors: [] }
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
