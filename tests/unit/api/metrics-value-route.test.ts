// Unit tests for GET /api/v1/metrics/[id]/value.
// Mocks the Supabase server client, the resolver context gatherer,
// and the resolver itself so the route can be exercised in pure
// Node without a real DB.

import { describe, expect, it, beforeEach, vi } from 'vitest'

// ── Mock Supabase server client ──────────────────────────────
const supabaseMock = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

// ── Mock the materialize + resolver layer ────────────────────
const gatherResolverContextMock = vi.fn()
const resolveMetricMock = vi.fn()

vi.mock('@/lib/metrics/materialize', () => ({
  gatherResolverContext: (...args: unknown[]) =>
    gatherResolverContextMock(...args),
}))

vi.mock('@/lib/metrics/resolver', () => ({
  resolveMetric: (...args: unknown[]) => resolveMetricMock(...args),
}))

// ── Mock registry lookup ─────────────────────────────────────
const getMetricByIdMock = vi.fn()
vi.mock('@/lib/metrics/registry', () => ({
  getMetricById: (...args: unknown[]) => getMetricByIdMock(...args),
}))

// Import route after mocks are wired
import { GET } from '@/app/api/v1/metrics/[id]/value/route'

// ── Helpers ──────────────────────────────────────────────────

interface QueryStub {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
}

function makeQueryStub(
  result: { data: unknown; error: unknown },
  shape: 'list' | 'single',
): QueryStub {
  const stub: Partial<QueryStub> = {}
  stub.select = vi.fn(() => stub as QueryStub)
  stub.eq = vi.fn(() => stub as QueryStub)
  stub.order = vi.fn(() => stub as QueryStub)
  stub.limit = vi.fn(() => Promise.resolve(result) as unknown as QueryStub)
  stub.maybeSingle = vi.fn(() => Promise.resolve(result))
  // List queries terminate at .limit() (returns a thenable).
  // Single queries terminate at .maybeSingle().
  if (shape === 'list') {
    // No-op — limit already returns the promise above.
  }
  return stub as QueryStub
}

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

function wireFrom(handlers: Record<string, () => QueryStub>) {
  supabaseMock.from.mockImplementation((table: string) => {
    const factory = handlers[table]
    if (!factory) throw new Error(`unexpected table: ${table}`)
    return factory()
  })
}

async function callGet(metricId: string) {
  const res = await GET({} as never, {
    params: { id: metricId },
  } as never)
  const body = await (res as Response).json()
  return { status: (res as Response).status, body }
}

const SAMPLE_ENTRY = {
  id: 'kpi.roe',
  namespace: 'kpi' as const,
  label: 'ROE',
  unit: '%',
  sources: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────

describe('GET /api/v1/metrics/[id]/value', () => {
  it('returns 401 when there is no authenticated user', async () => {
    noUser()
    const { status, body } = await callGet('kpi.roe')
    expect(status).toBe(401)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/unauth/i)
  })

  it('returns 404 for an unknown metric id', async () => {
    authedUser()
    getMetricByIdMock.mockReturnValue(undefined)
    const { status, body } = await callGet('does.not.exist')
    expect(status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/unknown metric/i)
  })

  it('returns 200 with a cached row when public.metrics has data', async () => {
    authedUser()
    getMetricByIdMock.mockReturnValue(SAMPLE_ENTRY)

    const computedAt = new Date().toISOString() // fresh
    wireFrom({
      companies: () =>
        makeQueryStub({ data: { id: 'co-1' }, error: null }, 'single'),
      metrics: () =>
        makeQueryStub(
          {
            data: [
              {
                metric_value: 17.5,
                metric_unit: '%',
                period_year: 2025,
                period_quarter: 'Q4',
                source: 'document',
                confidence: 0.85,
                provenance: { picked: { type: 'document' } },
                computed_at: computedAt,
                recorded_at: computedAt,
              },
            ],
            error: null,
          },
          'list',
        ),
    })

    const { status, body } = await callGet('kpi.roe')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data).toMatchObject({
      metric_id: 'kpi.roe',
      label: 'ROE',
      unit: '%',
      value: 17.5,
      period: { year: 2025, quarter: 'Q4' },
      source: 'document',
      confidence: 0.85,
      fresh: true,
    })
    expect(body.data.computed_at).toBe(computedAt)
    expect(body.data.provenance).toEqual({ picked: { type: 'document' } })

    // Resolver was NOT called on cache-hit path.
    expect(resolveMetricMock).not.toHaveBeenCalled()
    expect(gatherResolverContextMock).not.toHaveBeenCalled()
  })

  it('falls back to live resolver when no cached row exists', async () => {
    authedUser()
    getMetricByIdMock.mockReturnValue(SAMPLE_ENTRY)

    wireFrom({
      companies: () =>
        makeQueryStub({ data: { id: 'co-1' }, error: null }, 'single'),
      metrics: () => makeQueryStub({ data: [], error: null }, 'list'),
    })

    gatherResolverContextMock.mockResolvedValue({
      companyId: 'co-1',
      userId: 'user-1',
      surveyAnswers: {},
      documents: [],
      now: new Date(),
    })

    const liveComputedAt = new Date().toISOString()
    resolveMetricMock.mockReturnValue({
      metricId: 'kpi.roe',
      value: 12,
      numeric: 12,
      unit: '%',
      confidence: 0.7,
      picked: { type: 'survey', questionKey: 's_roe' },
      considered: [
        { source: { type: 'survey', questionKey: 's_roe' }, status: 'hit', value: 12, numeric: 12, confidence: 0.7 },
      ],
      periodYear: 2025,
      periodQuarter: null,
      computedAt: liveComputedAt,
    })

    const { status, body } = await callGet('kpi.roe')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.source).toBe('live')
    expect(body.data.value).toBe(12)
    expect(body.data.confidence).toBe(0.7)
    expect(body.data.period).toEqual({ year: 2025, quarter: null })
    expect(body.data.fresh).toBe(true)
    expect(body.data.provenance).toMatchObject({
      picked: { type: 'survey' },
      raw_value: 12,
    })

    expect(gatherResolverContextMock).toHaveBeenCalledTimes(1)
    expect(resolveMetricMock).toHaveBeenCalledTimes(1)
  })

  it('marks values older than 24h as stale (fresh=false)', async () => {
    authedUser()
    getMetricByIdMock.mockReturnValue(SAMPLE_ENTRY)

    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    wireFrom({
      companies: () =>
        makeQueryStub({ data: { id: 'co-1' }, error: null }, 'single'),
      metrics: () =>
        makeQueryStub(
          {
            data: [
              {
                metric_value: 5,
                metric_unit: '%',
                period_year: 2024,
                period_quarter: null,
                source: 'survey',
                confidence: 0.6,
                provenance: null,
                computed_at: stale,
                recorded_at: stale,
              },
            ],
            error: null,
          },
          'list',
        ),
    })

    const { status, body } = await callGet('kpi.roe')
    expect(status).toBe(200)
    expect(body.data.fresh).toBe(false)
    expect(body.data.computed_at).toBe(stale)
  })

  it('marks values within the last 24h as fresh=true', async () => {
    authedUser()
    getMetricByIdMock.mockReturnValue(SAMPLE_ENTRY)

    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    wireFrom({
      companies: () =>
        makeQueryStub({ data: { id: 'co-1' }, error: null }, 'single'),
      metrics: () =>
        makeQueryStub(
          {
            data: [
              {
                metric_value: 9,
                metric_unit: '%',
                period_year: 2025,
                period_quarter: 'Q1',
                source: 'document',
                confidence: 0.9,
                provenance: { picked: { type: 'document' } },
                computed_at: recent,
                recorded_at: recent,
              },
            ],
            error: null,
          },
          'list',
        ),
    })

    const { body } = await callGet('kpi.roe')
    expect(body.data.fresh).toBe(true)
  })

  it('response matches the documented contract shape', async () => {
    authedUser()
    getMetricByIdMock.mockReturnValue(SAMPLE_ENTRY)

    wireFrom({
      companies: () =>
        makeQueryStub({ data: { id: 'co-1' }, error: null }, 'single'),
      metrics: () =>
        makeQueryStub(
          {
            data: [
              {
                metric_value: 1,
                metric_unit: '%',
                period_year: 2025,
                period_quarter: 'Q2',
                source: 'manual',
                confidence: 0.99,
                provenance: { picked: { type: 'manual' } },
                computed_at: new Date().toISOString(),
                recorded_at: new Date().toISOString(),
              },
            ],
            error: null,
          },
          'list',
        ),
    })

    const { body } = await callGet('kpi.roe')
    expect(body).toHaveProperty('ok', true)
    const d = body.data
    expect(d).toHaveProperty('metric_id')
    expect(d).toHaveProperty('label')
    expect(d).toHaveProperty('unit')
    expect(d).toHaveProperty('value')
    expect(d).toHaveProperty('period')
    expect(d.period).toHaveProperty('year')
    expect(d.period).toHaveProperty('quarter')
    expect(d).toHaveProperty('source')
    expect(d).toHaveProperty('confidence')
    expect(d).toHaveProperty('provenance')
    expect(d).toHaveProperty('computed_at')
    expect(d).toHaveProperty('fresh')
  })
})
