/**
 * GET /api/v1/metrics/[id]/timeseries | forecast | anomalies
 *   • the company comes from lib/tenancy like the other metric routes
 *     (members / partners read the company's history; ?companyId= is honoured),
 *     not from companies.user_id = caller;
 *   • a failed history read is a 500, not an empty series («нет истории»)
 *     that forecast / anomalies then run on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fetchTimeseries } from '@/lib/metrics/timeseries-fetch'

type Result = { data: unknown; error: { code?: string; message: string } | null }
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Result>,
  eqs: [] as Array<[string, string, unknown]>,
  tenant: null as unknown,
  tenantCalls: [] as unknown[],
}))

function fakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'member-1' } }, error: null }) },
    from(table: string) {
      const result = h.tables[table] ?? { data: [], error: null }
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'order', 'limit', 'gte', 'in']) b[m] = () => b
      b.eq = (c: string, v: unknown) => { h.eqs.push([table, c, v]); return b }
      b.maybeSingle = () => Promise.resolve({ data: null, error: null })
      b.then = (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
      return b
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeSupabase() }))
vi.mock('@/lib/tenancy', () => ({
  resolveTenantWith: async (...a: unknown[]) => { h.tenantCalls.push(a.slice(1)); return h.tenant },
  tenantErrorMessage: () => 'Нет доступа к компании',
}))

const timeseries = await import('@/app/api/v1/metrics/[id]/timeseries/route')
const forecast = await import('@/app/api/v1/metrics/[id]/forecast/route')
const anomalies = await import('@/app/api/v1/metrics/[id]/anomalies/route')
const ROUTES = { timeseries: timeseries.GET, forecast: forecast.GET, anomalies: anomalies.GET }

const call = async (name: keyof typeof ROUTES, query = '') => {
  const res = await ROUTES[name](new NextRequest(`http://localhost/api/v1/metrics/biz.finansy.vyruchka_god/${name}?period=ALL${query}`), { params: { id: 'biz.finansy.vyruchka_god' } })
  return { status: res.status, body: await res.json() }
}
const hist = (value: number, period_year: number) => ({ value, source: 'survey', period_year, period_quarter: null, period_month: null, recorded_at: '2026-10-01T00:00:00Z' })

beforeEach(() => {
  h.eqs = []
  h.tenantCalls = []
  h.tenant = { ok: true, tenant: { userId: 'member-1', companyId: 'co-1', role: 'member', canManage: false, legacy: false } }
  h.tables = { metric_value_history: { data: [hist(60, 2023), hist(80, 2024), hist(95, 2025)], error: null } }
})

describe('series routes — tenancy', () => {
  it.each(Object.keys(ROUTES) as Array<keyof typeof ROUTES>)('%s reads the tenant company (member access, ?companyId=)', async (name) => {
    const { status } = await call(name, '&companyId=co-1')
    expect(status).toBe(200)
    expect(h.tenantCalls[0]).toEqual(['member-1', { companyId: 'co-1', access: 'read' }])
    expect(h.eqs).toContainEqual(['metric_value_history', 'company_id', 'co-1'])
    expect(h.eqs.some(([t, c]) => t === 'companies' && c === 'user_id')).toBe(false)
  })

  it('timeseries returns the company history to a member', async () => {
    const { body } = await call('timeseries')
    expect(body.data.map((p: { value: number }) => p.value)).toEqual([60, 80, 95])
  })

  it('an inaccessible company is the tenancy status, not an empty series', async () => {
    h.tenant = { ok: false, status: 403, error: 'forbidden' }
    for (const name of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
      expect((await call(name, '&companyId=other')).status, name).toBe(403)
    }
  })

  it('no company yet (none requested) → an empty series, 200', async () => {
    h.tenant = { ok: false, status: 404, error: 'no_company' }
    expect(await call('timeseries')).toMatchObject({ status: 200, body: { data: [] } })
  })
})

describe('series routes — read errors', () => {
  it.each(Object.keys(ROUTES) as Array<keyof typeof ROUTES>)('%s answers 500 when the history read fails', async (name) => {
    h.tables.metric_value_history = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
    expect((await call(name)).status).toBe(500)
  })

  it('fetchTimeseries: only a missing history table falls back to public.metrics', async () => {
    h.tables.metric_value_history = { data: null, error: { code: '42P01', message: 'relation does not exist' } }
    h.tables.metrics = { data: [{ metric_value: 5, metric_unit: '₸', computed_at: '2026-10-01T00:00:00Z', recorded_at: null, source: 'survey' }], error: null }
    const pts = await fetchTimeseries(fakeSupabase() as never, { companyId: 'co-1', metricKey: 'x', period: 'ALL' })
    expect(pts.map((p) => p.value)).toEqual([5])
    h.tables.metrics = { data: null, error: { code: '57014', message: 'timeout' } }
    await expect(fetchTimeseries(fakeSupabase() as never, { companyId: 'co-1', metricKey: 'x', period: 'ALL' })).rejects.toThrow(/read failed/)
  })
})
