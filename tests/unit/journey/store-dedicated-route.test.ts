import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildStoreJourneyState } from '@/lib/journey/store-seed'
import type { StoreOverview } from '@/lib/store/types'

const ACTOR = '5cd75337-ff7a-49df-80ef-7cb63d7fe8c4'
const WORKSPACE = `journey-store-user-${ACTOR}`

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  bootstrap: vi.fn(),
}))

vi.mock('@/lib/journey/store-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/store-context')>(
    '@/lib/journey/store-context',
  )
  return { ...actual, resolveStoreJourneyContext: mocks.context }
})

vi.mock('@/lib/journey/auth-bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/auth-bootstrap')>(
    '@/lib/journey/auth-bootstrap',
  )
  return { ...actual, resolveNamedOwnedJourneyState: mocks.bootstrap }
})

vi.mock('@/lib/ai/structured', () => ({ hasOpenRouterKey: () => true }))

import { GET } from '@/app/api/v1/journey/store/route'

describe('GET /api/v1/journey/store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'production')
    const overview = completeOverview()
    const live = buildStoreJourneyState(overview, { workspaceId: WORKSPACE })
    const stored = {
      ...live,
      companyName: '',
      businessDescription: '',
      facts: [],
      widgetDecisions: (live.widgetDecisions ?? []).map((decision) => ({
        ...decision,
        evidenceFactIds: [],
      })),
    }
    mocks.context.mockResolvedValue({ userId: ACTOR, overview })
    mocks.bootstrap.mockResolvedValue({
      state: stored,
      persistence: { mode: 'database', label: 'Сохранено в AIStart360' },
      deviceToken: 'raw-store-device-token-never-in-json',
      switchedWorkspace: false,
    })
  })

  it('derives the Store workspace from the session and issues a distinct path-scoped cookie', async () => {
    const response = await GET(new Request('https://example.test/api/v1/journey/store', {
      headers: { 'x-journey-workspace-id': WORKSPACE },
    }))
    const body = await response.json()
    const cookie = response.headers.get('set-cookie') ?? ''

    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.state.workspaceId).toBe(WORKSPACE)
    expect(body.state.facts).toContainEqual(expect.objectContaining({ id: 'fact:store:revenue' }))
    expect(JSON.stringify(body)).not.toContain('raw-store-device-token-never-in-json')
    expect(cookie).toContain('aistart_journey_store_device=')
    expect(cookie).toContain('Path=/api/v1/journey/store')
    expect(cookie).toMatch(/HttpOnly/i)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('rejects a browser-selected non-Store workspace', async () => {
    const response = await GET(new Request('https://example.test/api/v1/journey/store', {
      headers: { 'x-journey-workspace-id': `journey-user-${ACTOR}` },
    }))
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.bootstrap).not.toHaveBeenCalled()
  })
})

function completeOverview(): StoreOverview {
  return {
    source: 'operational',
    confidence: 'complete',
    companyName: 'Интернет-магазин HONOR / MyHonor',
    period: { from: '2026-07-01', to: '2026-07-31' },
    asOf: '2026-08-07',
    versionLabel: 'Продажи · 12.08.2026',
    availability: { sales: true, inventory: true, prices: true },
    metrics: {
      revenue: 28_053_253,
      cost: 17_139_974.46,
      grossProfit: 10_913_278.54,
      grossMarginPct: 38.902024,
      listRevenue: 42_082_620,
      discount: 14_029_367,
      discountRatePct: 33.337668,
      units: 1_324,
      returns: 9,
    },
    catalog: { products: 1_365, activeProducts: 1_365, latest: [] },
    inventory: {
      availableUnits: 62_039,
      reservedUnits: 0,
      inventoryCost: 221_500_000,
      inventoryRetail: 365_000_000,
      warehouses: [],
    },
    channels: [],
    alerts: [],
    limitations: [],
  }
}
