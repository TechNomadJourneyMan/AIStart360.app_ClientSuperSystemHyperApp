import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { MyHonorCatalogSnapshot } from '@/lib/integrations/ecommerce/myhonor-public'
import type {
  CatalogSweepPageResult,
  CatalogSweepProgress,
} from '@/lib/integrations/myhonor/catalog-repository'

const dependencies = vi.hoisted(() => ({
  getUser: vi.fn(),
  companyMaybeSingle: vi.fn(),
  crawl: vi.fn(),
  begin: vi.fn(),
  getSweep: vi.fn(),
  persist: vi.fn(),
  record: vi.fn(),
  fail: vi.fn(),
  configuration: vi.fn(),
  rateLimited: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: dependencies.getUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => ({ maybeSingle: dependencies.companyMaybeSingle }),
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/integrations/ecommerce/myhonor-public', async (original) => {
  const actual = await original<
    typeof import('@/lib/integrations/ecommerce/myhonor-public')
  >()
  return { ...actual, crawlMyHonorPublicCatalog: dependencies.crawl }
})
vi.mock('@/lib/integrations/myhonor/catalog-repository', () => ({
  beginMyHonorCatalogSweep: dependencies.begin,
  getMyHonorCatalogSweep: dependencies.getSweep,
  persistMyHonorCatalogProducts: dependencies.persist,
  recordMyHonorCatalogSweepPage: dependencies.record,
  failMyHonorCatalogSweep: dependencies.fail,
}))
vi.mock('@/lib/integrations/myhonor/order-analytics', () => ({
  getMyHonorAnalyticsConfiguration: dependencies.configuration,
}))
vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: dependencies.rateLimited,
}))

import { POST } from '@/app/api/v1/integrations/myhonor/catalog/import/route'

const endpoint = 'https://portal.example.kz/api/v1/integrations/myhonor/catalog/import'
const sweepId = '11111111-1111-4111-8111-111111111111'
const manifestHash = 'f'.repeat(64)
const manifestProductIds = Array.from(
  { length: 88 },
  (_, index) => `myhonor:${index.toString(16).padStart(64, '0')}`,
)

function snapshot(input: {
  offset?: number
  attempted?: number
  status?: MyHonorCatalogSnapshot['status']
  manifest?: string
} = {}): MyHonorCatalogSnapshot {
  const offset = input.offset ?? 0
  const attempted = input.attempted ?? 24
  const status = input.status ?? 'complete'
  const products = status === 'failed'
    ? []
    : manifestProductIds
      .slice(offset, offset + attempted)
      .map((externalId, index) => {
        const slug = `honor-${offset + index}`
        const url = `https://myhonor.shop/product/${slug}`
        return {
          externalId,
          name: `HONOR ${offset + index}`,
          url,
          images: [],
          brand: 'HONOR',
          description: null,
          offers: [{
            price: 199_990,
            priceCurrency: 'KZT' as const,
            availability: 'https://schema.org/InStock',
            url,
          }],
          syncedAt: '2026-07-29T04:00:00.000Z',
          provenance: {
            provider: 'myhonor-public' as const,
            method: 'schema.org/Product JSON-LD' as const,
            sourceUrl: url,
            sitemapUrl: 'https://myhonor.shop/sitemap.xml' as const,
            retrievedAt: '2026-07-29T04:00:00.000Z',
          },
        }
      })
  const issues = status === 'complete'
    ? []
    : [{
        stage: 'fetch' as const,
        code: 'upstream_timeout',
        message: 'Timed out',
        retryable: true,
      }]
  return {
    source: 'myhonor-public',
    status,
    syncedAt: '2026-07-29T04:00:00.000Z',
    sitemapUrl: 'https://myhonor.shop/sitemap.xml',
    manifestHash: input.manifest ?? manifestHash,
    manifestProductIds,
    offset,
    requestedLimit: 24,
    discoveredProductCount: 88,
    attemptedProductCount: attempted,
    succeededProductCount: products.length,
    excludedTestProductCount: 1,
    sitemapTruncated: false,
    products,
    issues,
    provenance: {
      origin: 'https://myhonor.shop',
      discovery: 'public-sitemap',
      extraction: 'schema.org/Product JSON-LD',
      robotsAllowedPaths: ['/sitemap.xml', '/product/*'],
    },
  }
}

function progress(
  overrides: Partial<CatalogSweepProgress> = {},
): CatalogSweepProgress {
  return {
    sweepId,
    status: 'in_progress',
    generation: 1,
    manifestHash,
    expectedProductCount: 88,
    pageSize: 24,
    nextOffset: 0,
    seenProductCount: 0,
    activeProductCount: 0,
    tombstonedProductCount: 0,
    failureCode: null,
    startedAt: '2026-07-29T04:00:01.000Z',
    completedAt: null,
    failedAt: null,
    ...overrides,
  }
}

function recorded(
  overrides: Partial<CatalogSweepPageResult> = {},
): CatalogSweepPageResult {
  return {
    ...progress({ nextOffset: 24, seenProductCount: 24 }),
    accepted: true,
    reason: null,
    ...overrides,
  }
}

describe('MyHonor server-owned catalog import route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    dependencies.companyMaybeSingle.mockResolvedValue({
      data: { id: 'company-1' },
      error: null,
    })
    dependencies.crawl.mockResolvedValue(snapshot())
    dependencies.getSweep.mockResolvedValue(null)
    dependencies.begin.mockResolvedValue(progress())
    dependencies.persist.mockResolvedValue({
      upsertedCount: 24,
      latestSyncedAt: '2026-07-29T04:00:01.000Z',
    })
    dependencies.record.mockResolvedValue(recorded())
    dependencies.fail.mockImplementation(async (input: {
      failureCode: string
    }) => progress({
      status: 'failed',
      failureCode: input.failureCode,
      failedAt: '2026-07-29T04:01:00.000Z',
    }))
    dependencies.configuration.mockReturnValue({
      ready: true,
      missing: [],
      userId: 'user-1',
      companyId: 'company-1',
      replayWindowSeconds: 300,
    })
    dependencies.rateLimited.mockResolvedValue(false)
  })

  it('creates a DB-owned sweep and records the exact first manifest page', async () => {
    const response = await POST(new NextRequest(
      `${endpoint}?limit=24`,
      { method: 'POST' },
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(dependencies.begin).toHaveBeenCalledWith({
      binding: { userId: 'user-1', companyId: 'company-1' },
      manifestHash,
      manifestProductIds,
      pageSize: 24,
    })
    expect(dependencies.persist).toHaveBeenCalledWith({
      binding: { userId: 'user-1', companyId: 'company-1' },
      products: snapshot().products,
      sweepStartedAt: '2026-07-29T04:00:01.000Z',
    })
    expect(dependencies.record).toHaveBeenCalledWith({
      binding: { userId: 'user-1', companyId: 'company-1' },
      sweepId,
      manifestHash,
      offset: 0,
      productExternalIds: manifestProductIds.slice(0, 24),
    })
    expect(body.data.manifestProductIds).toBeUndefined()
    expect(body.data.persistence).toMatchObject({
      sweepId,
      sweepStatus: 'in_progress',
      nextOffset: 24,
      seenProductCount: 24,
      catalogComplete: false,
    })
  })

  it('resumes only from the cursor and page size stored by the database', async () => {
    dependencies.getSweep.mockResolvedValue(progress({
      nextOffset: 24,
      seenProductCount: 24,
    }))
    dependencies.crawl.mockResolvedValue(snapshot({ offset: 24 }))
    dependencies.record.mockResolvedValue(recorded({
      nextOffset: 48,
      seenProductCount: 48,
    }))

    const response = await POST(new NextRequest(
      `${endpoint}?limit=3&sweep_id=${sweepId}`,
      { method: 'POST' },
    ))

    expect(response.status).toBe(200)
    expect(dependencies.crawl).toHaveBeenCalledWith({
      limit: 24,
      offset: 24,
    })
    expect(dependencies.begin).not.toHaveBeenCalled()
    expect(dependencies.record).toHaveBeenCalledWith(expect.objectContaining({
      offset: 24,
      productExternalIds: manifestProductIds.slice(24, 48),
    }))
  })

  it('rejects the legacy client-controlled cursor before crawling', async () => {
    const response = await POST(new NextRequest(
      `${endpoint}?offset=72&sweep_started_at=2026-07-29T04:00:00.000Z`,
      { method: 'POST' },
    ))

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('server_owned_cursor')
    expect(dependencies.crawl).not.toHaveBeenCalled()
  })

  it('durably fails a partial snapshot and never persists or finalizes it', async () => {
    dependencies.crawl.mockResolvedValue(snapshot({ status: 'partial' }))

    const response = await POST(new NextRequest(
      `${endpoint}?limit=24`,
      { method: 'POST' },
    ))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(dependencies.begin).toHaveBeenCalled()
    expect(dependencies.fail).toHaveBeenCalledWith({
      binding: { userId: 'user-1', companyId: 'company-1' },
      sweepId,
      failureCode: 'catalog_snapshot_partial',
    })
    expect(dependencies.persist).not.toHaveBeenCalled()
    expect(dependencies.record).not.toHaveBeenCalled()
    expect(body.data.persistence).toMatchObject({
      sweepStatus: 'failed',
      failureCode: 'catalog_snapshot_partial',
      catalogComplete: false,
    })
  })

  it('fails a resumed sweep when the live sitemap no longer matches the frozen manifest', async () => {
    dependencies.getSweep.mockResolvedValue(progress({
      nextOffset: 24,
      seenProductCount: 24,
    }))
    dependencies.crawl.mockResolvedValue(snapshot({
      offset: 24,
      manifest: 'e'.repeat(64),
    }))

    const response = await POST(new NextRequest(
      `${endpoint}?sweep_id=${sweepId}`,
      { method: 'POST' },
    ))

    expect(response.status).toBe(502)
    expect(dependencies.fail).toHaveBeenCalledWith(expect.objectContaining({
      sweepId,
      failureCode: 'manifest_changed',
    }))
    expect(dependencies.persist).not.toHaveBeenCalled()
    expect(dependencies.record).not.toHaveBeenCalled()
  })

  it('reports completion only after the DB finalizes the exact last page', async () => {
    dependencies.getSweep.mockResolvedValue(progress({
      nextOffset: 72,
      seenProductCount: 72,
    }))
    dependencies.crawl.mockResolvedValue(snapshot({
      offset: 72,
      attempted: 16,
    }))
    dependencies.persist.mockResolvedValue({
      upsertedCount: 16,
      latestSyncedAt: '2026-07-29T04:02:00.000Z',
    })
    dependencies.record.mockResolvedValue(recorded({
      status: 'completed',
      nextOffset: 88,
      seenProductCount: 88,
      activeProductCount: 88,
      tombstonedProductCount: 2,
      completedAt: '2026-07-29T04:02:01.000Z',
    }))

    const response = await POST(new NextRequest(
      `${endpoint}?sweep_id=${sweepId}`,
      { method: 'POST' },
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.persistence).toMatchObject({
      sweepStatus: 'completed',
      nextOffset: null,
      seenProductCount: 88,
      catalogComplete: true,
      activeProductCount: 88,
      tombstonedProductCount: 2,
    })
  })

  it('records a durable failure when a verified page cannot be stored', async () => {
    dependencies.persist.mockRejectedValue(new Error('database unavailable'))

    const response = await POST(new NextRequest(
      `${endpoint}?limit=24`,
      { method: 'POST' },
    ))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(dependencies.fail).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'catalog_store_unavailable',
    }))
    expect(body.data.persistence).toMatchObject({
      sweepStatus: 'failed',
      failureCode: 'catalog_store_unavailable',
    })
  })

  it('fails before crawling when the owner has no matching company binding', async () => {
    dependencies.companyMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })

    const response = await POST(new NextRequest(
      `${endpoint}?limit=24`,
      { method: 'POST' },
    ))

    expect(response.status).toBe(409)
    expect(dependencies.crawl).not.toHaveBeenCalled()
    expect(dependencies.begin).not.toHaveBeenCalled()
  })
})
