import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tenant: { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'admin', canManage: true, legacy: false } } as Record<string, unknown>,
  build: vi.fn(),
  limited: false,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) } }) }))
vi.mock('@/lib/tenancy', () => ({ resolveTenantWith: vi.fn(async () => h.tenant), tenantErrorMessage: () => 'Нет доступа' }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => h.limited }))
vi.mock('@/lib/point-a/snapshot', () => ({ buildPointASnapshot: h.build }))

const { POST } = await import('@/app/api/v1/point-a/recalculate/route')
const tenancy = await import('@/lib/tenancy')
const call = async () => {
  const res = await POST(new Request('http://localhost/api/v1/point-a/recalculate', { method: 'POST' }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.tenant = { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'admin', canManage: true, legacy: false } }
  h.build.mockReset().mockResolvedValue({ status: 'written' })
  h.limited = false
})

describe('POST /api/v1/point-a/recalculate', () => {
  it('recalculates the COMPANY with manage access, forced and locked', async () => {
    expect((await call()).status).toBe(200)
    expect(tenancy.resolveTenantWith).toHaveBeenLastCalledWith(expect.anything(), 'u-1', expect.objectContaining({ access: 'manage' }))
    expect(h.build).toHaveBeenCalledWith('co-1', expect.objectContaining({ trigger: 'manual', force: true, lock: true }))
  })
  it('busy → 409, no answers → 422, no access → tenant status, rate limit → 429', async () => {
    h.build.mockResolvedValueOnce({ status: 'skipped', reason: 'busy' })
    expect((await call()).status).toBe(409)
    h.build.mockResolvedValueOnce({ status: 'skipped', reason: 'no_answers' })
    expect((await call()).body.error).toMatch(/анкету/)
    h.limited = true
    expect((await call()).status).toBe(429)
    h.limited = false
    h.tenant = { ok: false, status: 403, error: 'forbidden' }
    expect((await call()).status).toBe(403)
  })
})
