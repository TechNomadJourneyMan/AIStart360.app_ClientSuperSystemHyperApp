/**
 * /api/v1/point-a/aggregate reads the resolver inputs with the SERVICE client
 * after the tenant check, attributed to the company's primary owner: a
 * member's / partner's / staff session would not see the owner's rows without
 * company_id (RLS, migration 084), and their POST recalculation deleted the
 * owner's metric values. (DB proof: tests/integration/db/metrics-recalc-tenant.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sessionMock = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'member-1' } }, error: null })) }, from: vi.fn() }
const serviceMock = {
  from: vi.fn(() => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) b[m] = () => b
    b.maybeSingle = () => Promise.resolve({ data: { user_id: 'owner-1' }, error: null })
    return b
  }),
}
const aggregateMock = vi.fn(async () => ({ intelligence: {} }))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => sessionMock) }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => serviceMock }))
vi.mock('@/lib/point-a/aggregator', () => ({ aggregatePointA: (...a: unknown[]) => aggregateMock(...(a as [])) }))
vi.mock('@/lib/tenancy', () => ({
  resolveTenantWith: vi.fn(async () => ({ ok: true, tenant: { userId: 'member-1', companyId: 'co-1', role: 'member', canManage: false, legacy: false } })),
  tenantErrorMessage: () => 'Нет доступа',
}))

import { GET, POST } from '@/app/api/v1/point-a/aggregate/route'

beforeEach(() => aggregateMock.mockClear())

describe('point-a aggregate route: inputs via the service client, owner-attributed', () => {
  it('POST (recalculation) by a member: owner id, service inputs, service writes', async () => {
    const res = await POST(new Request('http://localhost/api/v1/point-a/aggregate'))
    expect(res.status).toBe(200)
    expect(aggregateMock).toHaveBeenCalledWith(sessionMock, 'owner-1', 'co-1', expect.objectContaining({
      skipMaterialize: false, documentsScope: 'company', inputClient: serviceMock, writeClient: serviceMock,
    }))
  })

  it('GET by a member: same inputs, no write', async () => {
    await GET(new Request('http://localhost/api/v1/point-a/aggregate'))
    const opts = (aggregateMock.mock.calls[0] as unknown[])[3] as Record<string, unknown>
    expect(opts).toMatchObject({ skipMaterialize: true, inputClient: serviceMock })
    expect(opts.writeClient).toBeUndefined()
  })
})
