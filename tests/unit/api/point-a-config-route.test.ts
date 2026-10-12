import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tenant: { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } } as Record<string, unknown>,
  row: null as Record<string, unknown> | null,
  upserted: [] as Array<Record<string, unknown>>,
  emit: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) } }) }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.maybeSingle = async () => ({ data: h.row, error: null })
      b.upsert = async (r: Record<string, unknown>) => { h.upserted.push(r); return { error: null } }
      return b
    },
  }),
}))
vi.mock('@/lib/tenancy', () => ({ resolveTenantWith: vi.fn(async () => h.tenant), tenantErrorMessage: () => 'Нет доступа' }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: h.emit }))

const { PATCH } = await import('@/app/api/v1/point-a/config/route')
const patch = async (body: unknown) => {
  const res = await PATCH(new Request('http://localhost/api/v1/point-a/config', { method: 'PATCH', body: JSON.stringify(body) }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.tenant = { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } }
  h.row = { client_view: { hidden: ['team'] }, expert_overrides: { finance: { weight: 0.4 } }, version: 3 }
  h.upserted = []
  h.emit.mockReset()
})

describe('PATCH /api/v1/point-a/config', () => {
  it('the owner changes the view; weights are kept, version bumped, event sent', async () => {
    const { status } = await patch({ clientView: { order: ['team', 'finance'] } })
    expect(status).toBe(200)
    expect(h.upserted[0]).toMatchObject({ company_id: 'co-1', version: 4, client_view: { hidden: ['team'], order: ['team', 'finance'] }, expert_overrides: { finance: { weight: 0.4 } } })
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'BLOCK_CONFIG_CHANGED', companyId: 'co-1' }))
  })
  it('the owner cannot change weights or the template', async () => {
    expect((await patch({ expertOverrides: { finance: { weight: 1 } } })).status).toBe(403)
    expect((await patch({ templateKey: 'ecommerce' })).status).toBe(403)
    expect(h.upserted).toEqual([])
  })
  it('an expert can', async () => {
    h.tenant = { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'partner_expert', canManage: true, legacy: false } }
    expect((await patch({ expertOverrides: { product: { enabled: false } } })).status).toBe(200)
    expect(h.upserted[0].expert_overrides).toEqual({ finance: { weight: 0.4 }, product: { enabled: false } })
  })
  it('unknown blocks and empty bodies are refused', async () => {
    expect((await patch({ clientView: { hidden: ['nope'] } })).status).toBe(400)
    expect((await patch({})).status).toBe(400)
  })
})

describe('PATCH /api/v1/point-a/config — key metrics', () => {
  it('the owner pins key metrics (catalog ids only, max 8)', async () => {
    expect((await patch({ clientView: { keyMetrics: ['biz.finansy.vyruchka_god', 'biz.klienty.nps'] } })).status).toBe(200)
    expect((h.upserted[0].client_view as { keyMetrics: string[] }).keyMetrics).toEqual(['biz.finansy.vyruchka_god', 'biz.klienty.nps'])
    expect((await patch({ clientView: { keyMetrics: ['nope.metric'] } })).status).toBe(400)
    expect((await patch({ clientView: { keyMetrics: Array.from({ length: 9 }, () => 'biz.klienty.nps') } })).status).toBe(400)
  })
})
