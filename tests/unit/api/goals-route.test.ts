import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  user: { id: 'u-1' } as { id: string } | null,
  tenant: { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } } as Record<string, unknown>,
  upsert: vi.fn(),
  del: vi.fn(),
  emit: vi.fn(),
  list: vi.fn(),
  review: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user }, error: null }) } }) }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/tenancy', () => ({ resolveTenantWith: vi.fn(async () => h.tenant), tenantErrorMessage: () => 'Нет доступа' }))
vi.mock('@/lib/metrics/company-metrics', () => ({ loadCompanyMetrics: async () => new Map([['biz.finansy.valovaya_marzha', { value: 25, provenance: { period: { year: 2026 } } }]]) }))
vi.mock('@/lib/goals/store', () => ({ upsertGoal: h.upsert, deleteGoal: h.del }))
vi.mock('@/lib/goals/current', async (orig) => ({ ...(await orig<typeof import('@/lib/goals/current')>()), loadGoalsWithEvaluation: h.list }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: h.emit }))
vi.mock('@/lib/point-b/plan/notify', () => ({ notifyGoalNeedsReview: h.review }))

const { GET, POST } = await import('@/app/api/v1/goals/route')
const { DELETE } = await import('@/app/api/v1/goals/[id]/route')
const tenancy = await import('@/lib/tenancy')

const post = async (body: unknown) => {
  const res = await POST(new Request('http://localhost/api/v1/goals', { method: 'POST', body: JSON.stringify(body) }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.user = { id: 'u-1' }
  h.tenant = { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } }
  h.upsert.mockReset().mockImplementation(async (_s, _c, input) => ({ id: 'g1', metricId: input.metricId, label: 'Маржа', unit: '%', targetValue: input.targetValue, direction: 'higher_is_better', periodLabel: input.periodLabel, deadline: null, baselineValue: 25, baselinePeriod: '2026', source: input.source, note: null, createdAt: '2026-10-12T00:00:00Z' }))
  h.del.mockReset().mockResolvedValue(true)
  h.emit.mockReset()
  h.list.mockReset().mockResolvedValue([])
  h.review.mockReset().mockResolvedValue(undefined)
})

describe('/api/v1/goals', () => {
  it('GET lists with read access', async () => {
    const res = await GET(new Request('http://localhost/api/v1/goals'))
    expect(res.status).toBe(200)
    expect(tenancy.resolveTenantWith).toHaveBeenLastCalledWith(expect.anything(), 'u-1', expect.objectContaining({ access: 'read' }))
  })

  it('POST: manage access, baseline from the current value, TARGET_CHANGED, evaluation back', async () => {
    const { status, body } = await post({ metricId: 'biz.finansy.valovaya_marzha', targetValue: 40, periodLabel: '12m' })
    expect(status).toBe(200)
    expect(tenancy.resolveTenantWith).toHaveBeenLastCalledWith(expect.anything(), 'u-1', expect.objectContaining({ access: 'manage' }))
    expect(h.upsert.mock.calls[0][3]).toMatchObject({ actorId: 'u-1', baseline: { value: 25, period: '2026' } })
    expect(h.upsert.mock.calls[0][2]).toMatchObject({ source: 'owner' })
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'TARGET_CHANGED', companyId: 'co-1' }))
    expect(body.data.evaluation).toMatchObject({ current: 25, target: 40 })
  })

  it('POST: an expert sets an expert goal', async () => {
    h.tenant = { ok: true, tenant: { userId: 'u-1', companyId: 'co-1', role: 'partner_expert', canManage: true, legacy: false } }
    await post({ metricId: 'biz.finansy.valovaya_marzha', targetValue: 40, periodLabel: '12m' })
    expect(h.upsert.mock.calls[0][2]).toMatchObject({ source: 'expert' })
    expect(h.review).not.toHaveBeenCalled() // an expert's own goal needs no review request
  })

  it('POST: an owner changing a goal triggers notifyGoalNeedsReview without changing the response', async () => {
    const { status, body } = await post({ metricId: 'biz.finansy.valovaya_marzha', targetValue: 40, periodLabel: '12m' })
    expect(status).toBe(200)
    expect(h.review).toHaveBeenCalledTimes(1)
    expect(h.review.mock.calls[0][1]).toEqual({ userId: 'u-1', companyId: 'co-1', metricLabel: 'Маржа' })
    expect(body.data).toMatchObject({ goal: { id: 'g1', targetValue: 40 }, evaluation: { current: 25, target: 40 } })
  })

  it('POST: a failing review notification never fails the request', async () => {
    h.review.mockRejectedValue(new Error('staff notifications are down'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { status, body } = await post({ metricId: 'biz.finansy.valovaya_marzha', targetValue: 40, periodLabel: '12m' })
    expect(status).toBe(200)
    expect(body.data.goal.id).toBe('g1')
  })

  it('POST: bad body, unknown metric, no access', async () => {
    expect((await post({ metricId: 'biz.finansy.valovaya_marzha', targetValue: 'много', periodLabel: '12m' })).status).toBe(400)
    expect((await post({ metricId: 'biz.finansy.valovaya_marzha', targetValue: 40, periodLabel: 'завтра' })).status).toBe(400)
    expect((await post({ metricId: 'nope.metric', targetValue: 40, periodLabel: '12m' })).status).toBe(400)
    h.tenant = { ok: false, status: 403, error: 'forbidden' }
    expect((await post({ metricId: 'biz.finansy.valovaya_marzha', targetValue: 40, periodLabel: '12m' })).status).toBe(403)
    h.user = null
    expect((await post({})).status).toBe(401)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('DELETE: manage access, id format, not found', async () => {
    const del = (id: string) => DELETE(new Request(`http://localhost/api/v1/goals/${id}`, { method: 'DELETE' }), { params: { id } })
    expect((await del('0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3')).status).toBe(200)
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'TARGET_CHANGED' }))
    expect((await del('company-12m')).status).toBe(200)
    expect((await del('drop table')).status).toBe(404)
    h.del.mockResolvedValue(false)
    expect((await del('0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3')).status).toBe(404)
  })
})
