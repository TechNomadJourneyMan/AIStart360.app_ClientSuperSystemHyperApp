// ============================================================
// Unit tests for GET /api/v1/point-a/top-table
//
// Mocks Supabase server client + the compute engine so the
// route can be exercised in pure Node. Covers:
//   • auth gate (no user → 401)
//   • query-param parsing (period, product, manager, year)
//   • missing-data behaviour (empty rows, planSource=default)
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock Supabase server client ──────────────────────────────
const supabaseMock = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

// ── Mock the compute engine + filter discovery ───────────────
const computeTopTableMock = vi.fn()
const discoverFiltersMock = vi.fn()

vi.mock('@/lib/point-a/v3/top-table', async () => {
  const actual = await vi.importActual<typeof import('@/lib/point-a/v3/top-table')>(
    '@/lib/point-a/v3/top-table',
  )
  return {
    ...actual,
    computeTopTable: (...args: unknown[]) => computeTopTableMock(...args),
    discoverFilters: (...args: unknown[]) => discoverFiltersMock(...args),
  }
})

import { GET } from '@/app/api/v1/point-a/top-table/route'

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

function makeRequest(url: string) {
  // Minimal NextRequest-compatible stub — only `nextUrl.searchParams` is read.
  const u = new URL(url)
  return {
    url,
    nextUrl: u,
  } as unknown as Parameters<typeof GET>[0]
}

// Loose return type so individual tests can mutate numeric cells without
// triggering TS narrowing on `null`-typed properties.
type EngineRow = {
  metric: string
  label: string
  planYear: number | null
  factYear: number | null
  planMonth: number | null
  factMonth: number | null
  pctYear: number | null
  pct3y: number | null
}
type EngineResult = {
  rows: EngineRow[]
  asOf: string
  planSource: string
  dataCoverage: number
  filter: { period: string; year: number; productId: string | null; managerId: string | null }
}

function emptyEngineResult(): EngineResult {
  return {
    rows: [
      { metric: 'sales_count', label: 'Количество продаж', planYear: null, factYear: null, planMonth: null, factMonth: null, pctYear: null, pct3y: null },
      { metric: 'sales_amount', label: 'Сумма продаж', planYear: null, factYear: null, planMonth: null, factMonth: null, pctYear: null, pct3y: null },
      { metric: 'avg_check', label: 'Средний чек', planYear: null, factYear: null, planMonth: null, factMonth: null, pctYear: null, pct3y: null },
      { metric: 'new_sales_count', label: 'Количество новых продаж', planYear: null, factYear: null, planMonth: null, factMonth: null, pctYear: null, pct3y: null },
      { metric: 'new_sales_amount', label: 'Сумма новых продаж', planYear: null, factYear: null, planMonth: null, factMonth: null, pctYear: null, pct3y: null },
      { metric: 'new_avg_check', label: 'Средний чек новых продаж', planYear: null, factYear: null, planMonth: null, factMonth: null, pctYear: null, pct3y: null },
      { metric: 'repeat_sales_count', label: 'Количество повторных продаж', planYear: null, factYear: null, planMonth: null, factMonth: null, pctYear: null, pct3y: null },
      { metric: 'repeat_sales_amount', label: 'Сумма повторных продаж', planYear: null, factYear: null, planMonth: null, factMonth: null, pctYear: null, pct3y: null },
    ],
    asOf: '2026-05-20T00:00:00.000Z',
    planSource: 'default',
    dataCoverage: 0,
    filter: { period: 'month', year: 2026, productId: null, managerId: null },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  discoverFiltersMock.mockResolvedValue({ products: [], managers: [] })
})

// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/point-a/top-table', () => {
  it('returns 401 when there is no authenticated user', async () => {
    noUser()
    const res = await GET(makeRequest('http://t.test/api/v1/point-a/top-table'))
    const body = await (res as Response).json()
    expect((res as Response).status).toBe(401)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/unauth/i)
    expect(computeTopTableMock).not.toHaveBeenCalled()
  })

  it('returns 200 with empty rows + is_mock=true when no data + no plan', async () => {
    authedUser()
    computeTopTableMock.mockResolvedValue(emptyEngineResult())

    const res = await GET(makeRequest('http://t.test/api/v1/point-a/top-table'))
    const body = await (res as Response).json()
    expect((res as Response).status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.rows).toHaveLength(8)
    expect(body.data.is_mock).toBe(true)
    expect(body.data.period).toBe('month')
    expect(body.data.product).toBeNull()
    expect(body.data.manager).toBeNull()
    expect(body.data.available_products[0]).toBe('Все')
    expect(body.data.available_managers[0]).toBe('Все')
  })

  it('parses ?period query and forwards it to the engine', async () => {
    authedUser()
    computeTopTableMock.mockResolvedValue(emptyEngineResult())

    await GET(makeRequest('http://t.test/api/v1/point-a/top-table?period=quarter'))
    expect(computeTopTableMock).toHaveBeenCalledTimes(1)
    expect(computeTopTableMock.mock.calls[0][2]).toMatchObject({ period: 'quarter' })
  })

  it('falls back to period=month on invalid input', async () => {
    authedUser()
    computeTopTableMock.mockResolvedValue(emptyEngineResult())

    await GET(makeRequest('http://t.test/api/v1/point-a/top-table?period=banana'))
    expect(computeTopTableMock.mock.calls[0][2].period).toBe('month')
  })

  it('forwards product + manager + year query params', async () => {
    authedUser()
    computeTopTableMock.mockResolvedValue(emptyEngineResult())

    await GET(
      makeRequest(
        'http://t.test/api/v1/point-a/top-table?period=year&product=p1&manager=m2&year=2026',
      ),
    )
    expect(computeTopTableMock.mock.calls[0][2]).toMatchObject({
      period: 'year',
      productId: 'p1',
      managerId: 'm2',
      year: 2026,
    })
  })

  it('drops invalid year params silently', async () => {
    authedUser()
    computeTopTableMock.mockResolvedValue(emptyEngineResult())

    await GET(makeRequest('http://t.test/api/v1/point-a/top-table?year=hello'))
    expect(computeTopTableMock.mock.calls[0][2].year).toBeUndefined()
  })

  it('maps engine metric keys onto UI keys (sales_amount → sales_sum, etc.)', async () => {
    authedUser()
    const r = emptyEngineResult()
    r.rows[1].factYear = 1_000_000 // sales_amount
    computeTopTableMock.mockResolvedValue(r)

    const res = await GET(makeRequest('http://t.test/api/v1/point-a/top-table'))
    const body = await (res as Response).json()
    const keys = body.data.rows.map((row: { key: string }) => row.key)
    expect(keys).toEqual([
      'sales_count',
      'sales_sum',
      'avg_check',
      'new_count',
      'new_sum',
      'avg_check_new',
      'repeat_count',
      'repeat_sum',
    ])
    const salesSum = body.data.rows.find((row: { key: string }) => row.key === 'sales_sum')
    expect(salesSum.fact_year).toBe(1_000_000)
    expect(salesSum.unit).toBe('₸')
  })

  it('is_mock=false once there is non-default plan or any fact data', async () => {
    authedUser()
    const r = emptyEngineResult()
    r.planSource = 'company'
    r.rows[1].planYear = 100_000_000
    computeTopTableMock.mockResolvedValue(r)

    const res = await GET(makeRequest('http://t.test/api/v1/point-a/top-table'))
    const body = await (res as Response).json()
    expect(body.data.is_mock).toBe(false)
  })

  it('surfaces engine exceptions as a 500 with a JSON error body', async () => {
    authedUser()
    computeTopTableMock.mockRejectedValue(new Error('db timeout'))

    const res = await GET(makeRequest('http://t.test/api/v1/point-a/top-table'))
    const body = await (res as Response).json()
    expect((res as Response).status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/db timeout/)
  })
})
