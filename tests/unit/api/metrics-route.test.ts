import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUserMock = vi.fn()
const loadEcommerceAnalyticsMock = vi.fn()
const buildOrderMetricSummariesMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
  })),
}))

vi.mock('@/lib/point-a/v3/ecommerce-orders-loader', () => ({
  loadEcommerceAnalytics: (...args: unknown[]) =>
    loadEcommerceAnalyticsMock(...args),
  buildOrderMetricSummaries: (...args: unknown[]) =>
    buildOrderMetricSummariesMock(...args),
}))

import { GET } from '@/app/api/v1/metrics/route'

const emptyLoad = {
  available: true,
  allSalesRows: [],
  selectedSalesRows: [],
  clientBase: {
    rows: [],
    has_client_base: false,
    source_document_ids: [],
  },
  products: [],
  syncedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserMock.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  })
  loadEcommerceAnalyticsMock.mockResolvedValue(emptyLoad)
  buildOrderMetricSummariesMock.mockReturnValue([])
})

describe('GET /api/v1/metrics', () => {
  it('requires an authenticated user', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const response = await GET(new Request('http://test/api/v1/metrics'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ source: 'empty', data: [] })
    expect(loadEcommerceAnalyticsMock).not.toHaveBeenCalled()
  })

  it('returns honest empty state for a connected source with no period rows', async () => {
    const response = await GET(
      new Request('http://test/api/v1/metrics?period=quarter&product=2036'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(loadEcommerceAnalyticsMock).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { productId: '2036' },
    )
    expect(buildOrderMetricSummariesMock).toHaveBeenCalledWith([], 'quarter')
    expect(body).toEqual({
      source: 'empty',
      data: [],
      connected: true,
      synced_at: null,
    })
  })

  it('returns attributed MyHonor metrics', async () => {
    const selectedRows = [
      {
        sale_id: 'order-1',
        client_id: 'client-1',
        amount: 15_000,
        occurred_at: '2026-07-10T00:00:00.000Z',
      },
    ]
    loadEcommerceAnalyticsMock.mockResolvedValue({
      ...emptyLoad,
      selectedSalesRows: selectedRows,
      syncedAt: '2026-07-10T00:05:00.000Z',
    })
    buildOrderMetricSummariesMock.mockReturnValue([
      { id: 'revenue', rawValue: 15_000 },
    ])

    const response = await GET(
      new Request('http://test/api/v1/metrics?period=month'),
    )
    expect(await response.json()).toEqual({
      source: 'external',
      provider: 'myhonor',
      data: [{ id: 'revenue', rawValue: 15_000 }],
      synced_at: '2026-07-10T00:05:00.000Z',
    })
  })

  it('does not claim manager-scoped metrics when MyHonor has no manager dimension', async () => {
    loadEcommerceAnalyticsMock.mockResolvedValue({
      ...emptyLoad,
      selectedSalesRows: [
        {
          sale_id: 'order-1',
          client_id: 'client-1',
          amount: 15_000,
          occurred_at: '2026-07-10T00:00:00.000Z',
        },
      ],
    })

    await GET(new Request('http://test/api/v1/metrics?manager=m1'))
    expect(buildOrderMetricSummariesMock).toHaveBeenCalledWith([], 'month')
  })
})
