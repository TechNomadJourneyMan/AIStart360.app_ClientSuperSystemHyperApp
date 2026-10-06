// GET /api/v1/metrics/catalog with the REAL registry: categories, enrichment,
// targets, history-based trend sorts, tenancy errors.
import { describe, expect, it, beforeEach, vi } from 'vitest'

type Result = { data: unknown; error: { message: string } | null }

const tables: Record<string, Result> = {}
const supabaseMock = {
  auth: { getUser: vi.fn() },
  from: vi.fn((table: string) => {
    const result = tables[table] ?? { data: [], error: null }
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not']) b[m] = () => b
    b.maybeSingle = () => Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error })
    b.then = (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
    return b
  }),
}
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseMock) }))

const resolveTenantWithMock = vi.fn()
vi.mock('@/lib/tenancy', () => ({
  resolveTenantWith: (...args: unknown[]) => resolveTenantWithMock(...args),
  tenantErrorMessage: (e: string) => (e === 'no_company' ? 'Компания не найдена' : 'Нет доступа к компании'),
}))

import { GET } from '@/app/api/v1/metrics/catalog/route'

async function call(query: Record<string, string>) {
  const res = (await GET({ url: `http://localhost/api/v1/metrics/catalog?${new URLSearchParams(query)}` } as never)) as Response
  return { status: res.status, body: await res.json() }
}

const row = (metric_key: string, metric_value: number, extra: Record<string, unknown> = {}) => ({
  metric_key, metric_value, metric_unit: null, confidence: 0.9, source: 'survey',
  computed_at: '2026-10-05T10:00:00Z', recorded_at: '2026-10-05T10:00:00Z',
  period_year: null, period_quarter: null, period_month: null, ...extra,
})
const hist = (metric_key: string, value: number, recorded_at: string) => ({
  metric_key, value, source: 'survey', period_year: null, period_quarter: null, period_month: null, recorded_at,
})

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null })
  resolveTenantWithMock.mockResolvedValue({ ok: true, tenant: { userId: 'owner-1', companyId: 'co-1', role: 'owner', canManage: true, legacy: false } })
  tables.companies = { data: { id: 'co-1', user_id: 'owner-1', target_revenue_12m_kzt: '120000000' }, error: null }
  tables.metrics = {
    data: [
      row('biz.avtomatizatsiya.crm_sistema', 1),
      row('biz.finansy.vyruchka_god', 88_000_000),
      row('biz.marketing.cac', 15_000),
      row('biz.prodazhi.sredniy_chek', 50_000),
    ],
    error: null,
  }
  tables.metric_targets = {
    data: [{ metric_key: 'biz.marketing.cac', target_value: 12_000, direction: 'lower_is_better', period_label: '12m', source: 'expert' }],
    error: null,
  }
  tables.metric_value_history = {
    data: [
      hist('biz.marketing.cac', 15_000, '2026-10-05T10:00:00Z'),
      hist('biz.prodazhi.sredniy_chek', 50_000, '2026-10-05T10:00:00Z'),
      hist('biz.marketing.cac', 20_000, '2026-09-01T10:00:00Z'),
      hist('biz.prodazhi.sredniy_chek', 40_000, '2026-09-01T10:00:00Z'),
    ],
    error: null,
  }
  tables.gri_assessments = { data: [{ section_avgs: { team: 6.5 }, created_at: '2026-10-01T00:00:00Z' }], error: null }
})

describe('catalog enrichment', () => {
  it('every item carries the enrichment fields; no demo «current state» anywhere', async () => {
    const { status, body } = await call({ pageSize: '200' })
    expect(status).toBe(200)
    const keys = ['category', 'categoryLabel', 'subcategory', 'description', 'calculationMethod', 'target', 'benchmark',
      'previousValue', 'delta', 'deltaPct', 'trend', 'status', 'period', 'lastUpdated', 'provenanceType', 'valueKind']
    for (const item of body.data.items) for (const k of keys) expect(item, `${item.id}.${k}`).toHaveProperty(k)
    const json = JSON.stringify(body)
    expect(json).not.toMatch(/current_state/)
    expect(json).not.toMatch(/₸84\.2М при цели/)
    expect(body.data.total).toBe(148)
  })

  it('category filter, per-category counts and category metadata', async () => {
    const { body } = await call({ category: 'automation', pageSize: '200' })
    expect(body.data.items.map((i: { category: string }) => i.category)).toEqual(Array(7).fill('automation'))
    expect(body.data.categoryCounts).toMatchObject({ all: 148, automation: 7, digital: 8 /* 5 maturity + 3 «Цифровой» KPIs */, management: 8, ai_maturity: 0, gri: 7, growth_goals: 59 })
    expect(body.data.counts).toMatchObject({ all: 148, gri: 7, goal: 59 })
    const ai = body.data.categories.find((c: { key: string }) => c.key === 'ai_maturity')
    expect(ai).toMatchObject({ label: 'AI-зрелость', count: 0 })
    expect(ai.emptyReason).toMatch(/нет вопросов об использовании AI/)
    const goals = await call({ category: 'growth_goals', subcategory: 'goal_09', pageSize: '200' })
    expect(goals.body.data.items.every((i: { subcategory: string }) => i.subcategory === 'goal_09')).toBe(true)
    expect(goals.body.data.total).toBe(3)
  })

  it('rejects an unknown category with a Russian 400', async () => {
    const { status, body } = await call({ category: 'astrology' })
    expect(status).toBe(400)
    expect(body).toEqual({ ok: false, error: 'Недопустимое значение category' })
  })

  it('revenue: owner 12-month goal as target, off track; CAC: metric_targets, lower is better', async () => {
    const { body } = await call({ pageSize: '200' })
    const byId = new Map(body.data.items.map((i: { id: string }) => [i.id, i]))
    expect(byId.get('biz.finansy.vyruchka_god')).toMatchObject({
      value: 88_000_000,
      target: { value: 120_000_000, periodLabel: '12m', source: 'survey', direction: 'higher_is_better' },
      status: 'off_track',
      provenanceType: 'FACT',
      lastUpdated: '2026-10-05T10:00:00Z',
      period: null,
    })
    expect(byId.get('biz.marketing.cac')).toMatchObject({
      target: { value: 12_000, direction: 'lower_is_better', source: 'expert' },
      status: 'at_risk',
      previousValue: 20_000,
      delta: -5000,
      deltaPct: -25,
      trend: 'down',
    })
    expect(byId.get('biz.avtomatizatsiya.crm_sistema')).toMatchObject({ valueKind: 'flag', status: 'no_target', category: 'automation' })
    // GRI «Команда» block scored by the assessment → CALCULATED
    expect(byId.get('gri.komanda')).toMatchObject({ value: 6.5, provenanceType: 'CALCULATED', lastUpdated: '2026-10-01T00:00:00Z' })
  })

  it('trend_up / trend_down sort by deltaPct, metrics without history last', async () => {
    const up = (await call({ sort: 'trend_up', pageSize: '200' })).body.data.items
    expect(up.slice(0, 2).map((i: { id: string }) => i.id)).toEqual(['biz.prodazhi.sredniy_chek', 'biz.marketing.cac'])
    expect(up[2].deltaPct).toBeNull()
    const down = (await call({ sort: 'trend_down', pageSize: '200' })).body.data.items
    expect(down.slice(0, 2).map((i: { id: string }) => i.id)).toEqual(['biz.marketing.cac', 'biz.prodazhi.sredniy_chek'])
  })

  it('an inaccessible explicit companyId is a 404 no_company', async () => {
    resolveTenantWithMock.mockResolvedValue({ ok: false, status: 404, error: 'no_company' })
    const { status, body } = await call({ companyId: 'someone-else' })
    expect(status).toBe(404)
    expect(body).toMatchObject({ ok: false, error: 'no_company', message: 'Компания не найдена' })
  })

  it('without a company the registry is still served, enriched, without values', async () => {
    resolveTenantWithMock.mockResolvedValue({ ok: false, status: 404, error: 'no_company' })
    const { status, body } = await call({ pageSize: '10' })
    expect(status).toBe(200)
    expect(body.data.items[0]).toMatchObject({ value: null, status: 'no_data', trend: 'unknown' })
    expect(body.data.items[0].description).toBeTruthy()
  })

  it('optional tables of migration 085 may be missing', async () => {
    tables.metric_targets = { data: null, error: { message: 'relation "public.metric_targets" does not exist' } }
    tables.metric_value_history = { data: null, error: { message: 'relation "public.metric_value_history" does not exist' } }
    const { status, body } = await call({ pageSize: '200' })
    expect(status).toBe(200)
    const cac = body.data.items.find((i: { id: string }) => i.id === 'biz.marketing.cac')
    expect(cac).toMatchObject({ target: null, status: 'no_target', trend: 'unknown', previousValue: null })
  })
})
