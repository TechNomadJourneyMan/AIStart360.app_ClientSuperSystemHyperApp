// GET /api/v1/metrics/[id]/goals — progress from the tenant's own metric value.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { goalProgress } from '@/lib/metrics/catalog-helpers'

type Result = { data: unknown; error: { code?: string; message: string } | null }
const tables: Record<string, Result> = {}
const eqCalls: Array<[string, string, unknown]> = []
const supabaseMock = {
  auth: { getUser: vi.fn() },
  from: vi.fn((table: string) => {
    const result = tables[table] ?? { data: [], error: null }
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'in', 'order', 'limit', 'not']) b[m] = () => b
    b.eq = (col: string, v: unknown) => { eqCalls.push([table, col, v]); return b }
    b.maybeSingle = () => Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error })
    b.then = (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
    return b
  }),
}
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseMock) }))
const resolveTenantWithMock = vi.fn()
vi.mock('@/lib/tenancy', () => ({ resolveTenantWith: (...a: unknown[]) => resolveTenantWithMock(...a) }))

import { GET } from '@/app/api/v1/metrics/[id]/goals/route'

const call = async (id: string) => {
  const res = await GET({ nextUrl: new URL(`http://localhost/api/v1/metrics/${id}/goals`) } as never, { params: { id } })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  eqCalls.length = 0
  supabaseMock.from.mockClear()
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  resolveTenantWithMock.mockResolvedValue({ ok: true, tenant: { userId: 'u1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } })
  tables.companies = { data: { id: 'co-1', target_revenue_12m_kzt: '120000000' }, error: null }
  tables.metric_targets = { data: [], error: null }
  tables.metrics = { data: [{ metric_key: 'biz.finansy.vyruchka_god', metric_value: '90000000', computed_at: '2026-10-05T00:00:00Z' }], error: null }
})

describe('revenue goal', () => {
  it('progress = own revenue metric vs the owner 12-month target', async () => {
    const { status, body } = await call('revenue')
    expect(status).toBe(200)
    expect(body.data).toEqual({
      goalId: 'company-co-1-revenue-12m',
      metricId: 'revenue',
      targetValue: 120,
      targetUnit: '₸М',
      deadline: null,
      progress: 75,
      trajectory: 'behind', // 0.75 < 0.8
      actualValue: 90,
    })
    // Every read is scoped to the tenant company.
    expect(eqCalls.filter(([t]) => t === 'metrics' || t === 'companies').every(([, , v]) => v === 'co-1')).toBe(true)
  })

  it('works for the registry revenue id and reports at_risk / on_track', async () => {
    tables.metrics = { data: [{ metric_key: 'kpi.obschaya_vyruchka_god', metric_value: 100_000_000 }], error: null }
    expect((await call('biz.finansy.vyruchka_god')).body.data).toMatchObject({ progress: 83.3, trajectory: 'at_risk' })
    tables.metrics = { data: [{ metric_key: 'biz.finansy.vyruchka_god', metric_value: 130_000_000 }], error: null }
    expect((await call('revenue')).body.data).toMatchObject({ progress: 100, trajectory: 'on_track' })
  })

  it('no value yet → trajectory no_data (never «behind»), progress 0, actualValue null', async () => {
    tables.metrics = { data: [], error: null }
    expect((await call('revenue')).body.data).toMatchObject({ progress: 0, actualValue: null, trajectory: 'no_data' })
  })

  it('a failed metrics / company / metric_targets read is a 500, not «no value» / «no goal»', async () => {
    for (const table of ['metrics', 'companies', 'metric_targets']) {
      const saved = tables[table]
      tables[table] = { data: null, error: { code: '57014', message: 'statement timeout' } }
      const { status, body } = await call('revenue')
      expect(status, table).toBe(500)
      expect(body.data, table).toBeNull()
      tables[table] = saved
    }
  })

  it('metric_targets not created yet (before 085) still means «no targets»', async () => {
    tables.metric_targets = { data: null, error: { code: '42P01', message: 'relation "metric_targets" does not exist' } }
    const { status, body } = await call('revenue')
    expect(status).toBe(200)
    expect(body.data).toMatchObject({ targetValue: 120, progress: 75 })
  })

  it('no target → null goal; no session → 401; no company → null', async () => {
    tables.companies = { data: { id: 'co-1', target_revenue_12m_kzt: null }, error: null }
    expect((await call('revenue')).body).toEqual({ data: null })
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } })
    expect((await call('revenue')).status).toBe(401)
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    resolveTenantWithMock.mockResolvedValue({ ok: false, status: 404, error: 'no_company' })
    expect(await call('revenue')).toEqual({ status: 200, body: { data: null } })
  })
})

describe('metric_targets goals', () => {
  it('CAC with a lower-is-better target', async () => {
    tables.metric_targets = { data: [{ metric_key: 'biz.marketing.cac', target_value: 12_000, direction: 'lower_is_better', period_label: '12m', source: 'expert' }], error: null }
    tables.metrics = { data: [{ metric_key: 'biz.marketing.cac', metric_value: 15_000 }], error: null }
    expect((await call('biz.marketing.cac')).body.data).toMatchObject({
      metricId: 'biz.marketing.cac', targetValue: 12_000, targetUnit: '₸', progress: 80, trajectory: 'at_risk', actualValue: 15_000,
    })
  })

  it('unknown metric → null without touching the DB', async () => {
    expect((await call('nope')).body).toEqual({ data: null })
    expect(supabaseMock.from).not.toHaveBeenCalledWith('metrics')
  })

  it('goalProgress directions', () => {
    const t = { value: 100, periodLabel: '12m', source: 'owner' as const, direction: 'higher_is_better' as const }
    expect(goalProgress(null, t)).toBe(0)
    expect(goalProgress(50, t)).toBe(50)
    expect(goalProgress(150, t)).toBe(100)
    expect(goalProgress(200, { ...t, direction: 'lower_is_better' })).toBe(50)
    expect(goalProgress(110, { ...t, direction: 'range' })).toBe(90)
  })
})
