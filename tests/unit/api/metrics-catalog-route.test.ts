// Unit tests for GET /api/v1/metrics/catalog.
// Mocks the Supabase server client and the metric registry so the
// route can be exercised in pure Node without a real DB.

import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { MetricEntry } from '@/lib/metrics/types'

// ── Mock Supabase server client ──────────────────────────────
const supabaseMock = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

// ── Mock registry ────────────────────────────────────────────
const getMetricRegistryMock = vi.fn()
vi.mock('@/lib/metrics/registry', () => ({
  getMetricRegistry: () => getMetricRegistryMock(),
}))

// Import route after mocks are wired
import { GET } from '@/app/api/v1/metrics/catalog/route'

// ── Helpers ──────────────────────────────────────────────────

function authedUser(userId = 'user-1') {
  supabaseMock.auth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function noUser() {
  supabaseMock.auth.getUser.mockResolvedValue({
    data: { user: null },
    error: null,
  })
}

interface MetricsRow {
  metric_key: string
  metric_value: number | string | null
  metric_unit: string | null
  confidence: number | string | null
  source: string | null
  computed_at: string | null
  recorded_at: string | null
}

function makeCompaniesStub(companyId: string | null) {
  const stub: Record<string, unknown> = {}
  stub.select = vi.fn(() => stub)
  stub.eq = vi.fn(() => stub)
  stub.maybeSingle = vi.fn(() =>
    Promise.resolve({
      data: companyId ? { id: companyId } : null,
      error: null,
    }),
  )
  return stub
}

function makeMetricsStub(rows: MetricsRow[]) {
  // The route chains: .select(...).eq(...).in(...).order(...).order(...)
  // and awaits the result of the last `.order(...)`.
  const stub: Record<string, unknown> = {}
  stub.select = vi.fn(() => stub)
  stub.eq = vi.fn(() => stub)
  stub.in = vi.fn(() => stub)
  // First .order() returns stub; second .order() returns thenable.
  let orderCalls = 0
  stub.order = vi.fn(() => {
    orderCalls += 1
    if (orderCalls >= 2) {
      return Promise.resolve({ data: rows, error: null })
    }
    return stub
  })
  return stub
}

function wireFrom(handlers: Record<string, () => unknown>) {
  supabaseMock.from.mockImplementation((table: string) => {
    const factory = handlers[table]
    if (!factory) throw new Error(`unexpected table: ${table}`)
    return factory()
  })
}

function makeRequest(query: Record<string, string | undefined>) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, v)
  }
  const url = `http://localhost/api/v1/metrics/catalog?${params.toString()}`
  return { url } as never
}

async function callGet(query: Record<string, string | undefined> = {}) {
  const res = await GET(makeRequest(query))
  const body = await (res as Response).json()
  return { status: (res as Response).status, body }
}

// ── Fixtures ─────────────────────────────────────────────────

function makeRegistry(): MetricEntry[] {
  const entries: MetricEntry[] = []
  // 50 biz/Финансы items so we can exercise pagination
  for (let i = 0; i < 50; i++) {
    entries.push({
      id: `biz.finansy.metric_${String(i).padStart(2, '0')}`,
      namespace: 'biz',
      department: 'Финансы',
      label: `Финансовая метрика ${String(i).padStart(2, '0')}`,
      unit: '₸',
      sources: [{ type: 'survey', key: `s_${i}` }],
    })
  }
  // 10 biz/Маркетинг items
  for (let i = 0; i < 10; i++) {
    entries.push({
      id: `biz.marketing.metric_${i}`,
      namespace: 'biz',
      department: 'Маркетинг',
      label: `Маркетинговая метрика ${i}`,
      unit: '%',
      sources: [{ type: 'survey', key: `m_${i}` }],
    })
  }
  // 5 kpi
  for (let i = 0; i < 5; i++) {
    entries.push({
      id: `kpi.metric_${i}`,
      namespace: 'kpi',
      label: `KPI ${i}`,
      unit: '%',
      sources: [{ type: 'prisma', field: `PulseMetric.f${i}` }],
    })
  }
  // 2 gri
  entries.push({
    id: 'gri.product',
    namespace: 'gri',
    label: 'GRI Продукт',
    unit: '',
    sources: [{ type: 'survey', key: 's_gri_product' }],
  })
  entries.push({
    id: 'gri.market',
    namespace: 'gri',
    label: 'GRI Рынок',
    unit: '',
    sources: [{ type: 'survey', key: 's_gri_market' }],
  })
  // 3 goals
  for (let i = 1; i <= 3; i++) {
    entries.push({
      id: `goal.0${i}.win_rate`,
      namespace: 'goal',
      goalNumber: `0${i}`,
      label: `Цель ${i} Выручка год`,
      unit: '₸',
      formula: 'A/B',
      sources: [{ type: 'document', doc_type: 'finance' }],
    })
  }
  return entries
}

beforeEach(() => {
  vi.clearAllMocks()
  getMetricRegistryMock.mockReturnValue(makeRegistry())
})

// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/metrics/catalog', () => {
  it('returns first 50 items by default (no filters, paginated total)', async () => {
    authedUser()
    wireFrom({
      companies: () => makeCompaniesStub('co-1'),
      metrics: () => makeMetricsStub([]),
    })

    const { status, body } = await callGet()
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.page).toBe(1)
    expect(body.data.pageSize).toBe(50)
    // total includes the entire registry fixture (70 items)
    expect(body.data.total).toBe(70)
    expect(body.data.items).toHaveLength(50)
  })

  it('namespace=biz returns only biz items', async () => {
    authedUser()
    wireFrom({
      companies: () => makeCompaniesStub('co-1'),
      metrics: () => makeMetricsStub([]),
    })

    const { body } = await callGet({ namespace: 'biz', pageSize: '200' })
    expect(body.data.total).toBe(60)
    for (const item of body.data.items) {
      expect(item.namespace).toBe('biz')
    }
  })

  it("department='Финансы' returns only biz finance items", async () => {
    authedUser()
    wireFrom({
      companies: () => makeCompaniesStub('co-1'),
      metrics: () => makeMetricsStub([]),
    })

    const { body } = await callGet({
      namespace: 'biz',
      department: 'Финансы',
      pageSize: '200',
    })
    expect(body.data.total).toBe(50)
    for (const item of body.data.items) {
      expect(item.department).toBe('Финансы')
    }
  })

  it("search='маркетинговая' returns filtered items", async () => {
    authedUser()
    wireFrom({
      companies: () => makeCompaniesStub('co-1'),
      metrics: () => makeMetricsStub([]),
    })

    const { body } = await callGet({
      search: 'маркетинговая',
      pageSize: '200',
    })
    expect(body.data.total).toBe(10)
    for (const item of body.data.items) {
      expect(item.label.toLowerCase()).toContain('маркетинговая')
    }
  })

  it('sort=label_desc reverses alpha order', async () => {
    authedUser()
    wireFrom({
      companies: () => makeCompaniesStub('co-1'),
      metrics: () => makeMetricsStub([]),
    })

    const { body: asc } = await callGet({
      sort: 'label_asc',
      pageSize: '200',
    })
    const { body: desc } = await callGet({
      sort: 'label_desc',
      pageSize: '200',
    })

    const ascLabels = asc.data.items.map((i: { label: string }) => i.label)
    const descLabels = desc.data.items.map((i: { label: string }) => i.label)
    expect(descLabels).toEqual(ascLabels.slice().reverse())
  })

  it('page=2, pageSize=10 returns correct slice', async () => {
    authedUser()
    wireFrom({
      companies: () => makeCompaniesStub('co-1'),
      metrics: () => makeMetricsStub([]),
    })

    const { body: full } = await callGet({
      pageSize: '200',
      sort: 'label_asc',
    })
    const { body: p2 } = await callGet({
      page: '2',
      pageSize: '10',
      sort: 'label_asc',
    })
    expect(p2.data.page).toBe(2)
    expect(p2.data.pageSize).toBe(10)
    expect(p2.data.items).toHaveLength(10)
    expect(p2.data.items.map((i: { id: string }) => i.id)).toEqual(
      full.data.items.slice(10, 20).map((i: { id: string }) => i.id),
    )
  })

  it('includeValues=false does not populate value fields', async () => {
    authedUser()
    // metrics table should NOT be queried when includeValues=false
    wireFrom({
      companies: () => makeCompaniesStub('co-1'),
    })

    const { status, body } = await callGet({
      includeValues: 'false',
      pageSize: '200',
    })
    expect(status).toBe(200)
    for (const item of body.data.items) {
      expect(item.value).toBeNull()
      expect(item.confidence).toBeNull()
      expect(item.source).toBeNull()
      expect(item.computedAt).toBeNull()
      expect(item.fresh).toBe(false)
    }
  })

  it('includeValues=true merges cached rows onto items', async () => {
    authedUser()

    const fresh = new Date().toISOString()
    const rows: MetricsRow[] = [
      {
        metric_key: 'kpi.metric_0',
        metric_value: 17.5,
        metric_unit: '%',
        confidence: 0.85,
        source: 'document',
        computed_at: fresh,
        recorded_at: fresh,
      },
      // duplicate metric_key — first row wins (DB ORDER BY computed_at DESC)
      {
        metric_key: 'kpi.metric_0',
        metric_value: 5,
        metric_unit: '%',
        confidence: 0.3,
        source: 'survey',
        computed_at: '2020-01-01T00:00:00.000Z',
        recorded_at: '2020-01-01T00:00:00.000Z',
      },
      {
        metric_key: 'gri.product',
        metric_value: '8/10',
        metric_unit: null,
        confidence: 0.7,
        source: 'survey',
        computed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        recorded_at: null,
      },
    ]

    wireFrom({
      companies: () => makeCompaniesStub('co-1'),
      metrics: () => makeMetricsStub(rows),
    })

    const { status, body } = await callGet({
      includeValues: 'true',
      pageSize: '200',
    })
    expect(status).toBe(200)

    const items = body.data.items as Array<{
      id: string
      value: unknown
      confidence: number | null
      source: string | null
      fresh: boolean
      unit: string
    }>
    const kpi0 = items.find((i) => i.id === 'kpi.metric_0')!
    expect(kpi0.value).toBe(17.5)
    expect(kpi0.confidence).toBe(0.85)
    expect(kpi0.source).toBe('document')
    expect(kpi0.fresh).toBe(true)
    expect(kpi0.unit).toBe('%')

    const gri = items.find((i) => i.id === 'gri.product')!
    expect(gri.value).toBe('8/10')
    expect(gri.fresh).toBe(false)

    // An item without a row stays null
    const untouched = items.find((i) => i.id === 'kpi.metric_4')!
    expect(untouched.value).toBeNull()
    expect(untouched.fresh).toBe(false)
  })

  it('rejects an invalid sort param with 400', async () => {
    authedUser()
    wireFrom({
      companies: () => makeCompaniesStub('co-1'),
      metrics: () => makeMetricsStub([]),
    })

    const { status, body } = await callGet({ sort: 'banana' })
    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
  })

  it('falls back to registry-only (200) when unauth + includeValues=true', async () => {
    noUser()
    // companies/metrics should not be reached
    wireFrom({})

    const { status, body } = await callGet({
      includeValues: 'true',
      pageSize: '200',
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.items.length).toBeGreaterThan(0)
    for (const item of body.data.items) {
      expect(item.value).toBeNull()
      expect(item.confidence).toBeNull()
    }
    // We never tried to read tables
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })
})
