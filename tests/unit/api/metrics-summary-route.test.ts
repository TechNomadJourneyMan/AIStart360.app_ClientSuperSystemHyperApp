import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseMock = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

import {
  buildCanonicalMetricSummaries,
} from '@/lib/metrics/canonical-summary'
import { GET } from '@/app/api/v1/metrics/route'

type Row = Parameters<typeof buildCanonicalMetricSummaries>[0][number]

function row(overrides: Partial<Row> = {}): Row {
  return {
    metric_key: 'biz.finansy.vyruchka_god',
    metric_value: 12_000_000,
    metric_unit: 'KZT',
    period_year: 2025,
    period_quarter: null,
    period_month: null,
    computed_at: '2026-01-01T00:00:00.000Z',
    recorded_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function companyQuery(companyId: string | null, error: unknown = null) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.order = vi.fn(() => query)
  query.limit = vi.fn(() => query)
  query.maybeSingle = vi.fn(async () => ({
    data: companyId ? { id: companyId } : null,
    error,
  }))
  return query
}

function metricsQuery(rows: Row[], error: unknown = null) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.in = vi.fn(() => query)
  query.order = vi.fn(async () => ({ data: rows, error }))
  return query
}

beforeEach(() => {
  vi.clearAllMocks()
  supabaseMock.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  })
})

describe('buildCanonicalMetricSummaries', () => {
  it('uses the canonical metric alias before survey fallbacks', () => {
    const result = buildCanonicalMetricSummaries([
      row({ metric_key: 'survey.s2_revenue_2025', metric_value: 99 }),
      row({ metric_key: 'biz.finansy.vyruchka_god', metric_value: 42 }),
    ])

    expect(result.find((metric) => metric.id === 'revenue')?.rawValue).toBe(42)
  })

  it('calculates trend only when a distinct previous period exists', () => {
    const result = buildCanonicalMetricSummaries([
      row({ metric_value: 120, period_year: 2025 }),
      row({ metric_value: 100, period_year: 2024 }),
    ])
    const revenue = result.find((metric) => metric.id === 'revenue')

    expect(revenue?.trend).toBe(20)
    expect(revenue?.trendAbs).toBe(20)
    expect(revenue?.trendDirection).toBe('up')
    expect(revenue?.trendLabel).toContain('2025 к 2024')
  })

  it('marks a single current value as not comparable', () => {
    const [revenue] = buildCanonicalMetricSummaries([row()])

    expect(revenue.trend).toBe(0)
    expect(revenue.trendDirection).toBe('flat')
    expect(revenue.trendLabel).toContain('сравнение недоступно')
    expect(revenue.displayValue).toContain('₸')
  })
})

describe('GET /api/v1/metrics', () => {
  it('requires an authenticated user', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const response = await GET(new Request('http://localhost/api/v1/metrics'))

    expect(response.status).toBe(401)
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('returns an honest empty result for unsupported dimensions', async () => {
    const response = await GET(new Request(
      'http://localhost/api/v1/metrics?product=Product+A',
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual([])
    expect(body.limitation).toBe('dimension_not_available')
    expect(supabaseMock.from).not.toHaveBeenCalled()
  })

  it('reads fact/calculated projections for the owned company', async () => {
    const companies = companyQuery('company-1')
    const metrics = metricsQuery([row()])
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'companies') return companies
      if (table === 'metrics') return metrics
      throw new Error(`unexpected table ${table}`)
    })

    const response = await GET(new Request('http://localhost/api/v1/metrics?period=month'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.source).toBe('canonical-point-a')
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('revenue')
    expect(metrics.eq).toHaveBeenCalledWith('scenario', 'fact')
    expect(metrics.eq).toHaveBeenCalledWith('source', 'calculated')
  })

  it('returns empty data when the user has no company', async () => {
    supabaseMock.from.mockReturnValue(companyQuery(null))

    const response = await GET(new Request('http://localhost/api/v1/metrics'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual([])
  })
})
