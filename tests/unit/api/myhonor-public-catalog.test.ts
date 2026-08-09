import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { MyHonorCatalogSnapshot } from '@/lib/integrations/ecommerce/myhonor-public'

const dependencies = vi.hoisted(() => ({
  getUser: vi.fn(),
  crawl: vi.fn(),
  configuration: vi.fn(),
  rateLimited: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: dependencies.getUser },
  }),
}))
vi.mock('@/lib/integrations/ecommerce/myhonor-public', async (original) => {
  const actual = await original<
    typeof import('@/lib/integrations/ecommerce/myhonor-public')
  >()
  return { ...actual, crawlMyHonorPublicCatalog: dependencies.crawl }
})
vi.mock('@/lib/integrations/myhonor/order-analytics', () => ({
  getMyHonorAnalyticsConfiguration: dependencies.configuration,
}))
vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: dependencies.rateLimited,
}))

import { GET } from '@/app/api/v1/integrations/myhonor/catalog/route'
import { POST } from '@/app/api/v1/integrations/myhonor/catalog/sync/route'

const endpoint = 'https://portal.example.kz/api/v1/integrations/myhonor/catalog/sync'

function snapshot(
  status: MyHonorCatalogSnapshot['status'] = 'complete',
): MyHonorCatalogSnapshot {
  return {
    source: 'myhonor-public',
    status,
    syncedAt: '2026-07-29T04:00:00.000Z',
    sitemapUrl: 'https://myhonor.shop/sitemap.xml',
    manifestHash: 'f'.repeat(64),
    manifestProductIds: Array.from(
      { length: 88 },
      (_, index) => `myhonor:${index.toString(16).padStart(64, '0')}`,
    ),
    offset: 0,
    requestedLimit: 12,
    discoveredProductCount: 88,
    attemptedProductCount: 12,
    succeededProductCount: status === 'failed' ? 0 : 12,
    excludedTestProductCount: 1,
    sitemapTruncated: false,
    products: [],
    issues: status === 'failed'
      ? [{
          stage: 'sitemap',
          code: 'upstream_timeout',
          message: 'The public MyHonor page did not respond before the timeout',
          retryable: true,
          url: 'https://myhonor.shop/sitemap.xml',
        }]
      : [],
    provenance: {
      origin: 'https://myhonor.shop',
      discovery: 'public-sitemap',
      extraction: 'schema.org/Product JSON-LD',
      robotsAllowedPaths: ['/sitemap.xml', '/product/*'],
    },
  }
}

describe('authenticated MyHonor public catalog routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    dependencies.crawl.mockResolvedValue(snapshot())
    dependencies.configuration.mockReturnValue({
      ready: true,
      missing: [],
      userId: 'user-1',
      companyId: 'company-1',
      replayWindowSeconds: 300,
    })
    dependencies.rateLimited.mockResolvedValue(false)
  })

  it('rejects anonymous status and sync requests without crawling', async () => {
    dependencies.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const statusResponse = await GET()
    const syncResponse = await POST(new NextRequest(endpoint, { method: 'POST' }))

    expect(statusResponse.status).toBe(401)
    expect(syncResponse.status).toBe(401)
    expect(dependencies.crawl).not.toHaveBeenCalled()
  })

  it('reports bounded live reads and the separate normalized import endpoint', async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(
      'private, no-store, max-age=0',
    )
    expect(body).toMatchObject({
      ok: true,
      data: {
        status: 'ready',
        mode: 'live-bounded-snapshot',
        persistence: 'server-normalized',
        source: {
          origin: 'https://myhonor.shop',
          robotsAllowedPaths: ['/sitemap.xml', '/product/*'],
        },
        importEndpoint: '/api/v1/integrations/myhonor/catalog/import',
      },
    })
  })

  it('bounds pagination before starting a live crawl', async () => {
    const response = await POST(new NextRequest(
      `${endpoint}?limit=24&offset=48`,
      { method: 'POST' },
    ))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(
      'private, no-store, max-age=0',
    )
    expect(dependencies.crawl).toHaveBeenCalledWith({ limit: 24, offset: 48 })
  })

  it('rejects a signed-in account that is not the configured tenant', async () => {
    dependencies.configuration.mockReturnValue({
      ready: true,
      missing: [],
      userId: 'different-user',
      companyId: 'company-1',
      replayWindowSeconds: 300,
    })
    const response = await POST(new NextRequest(endpoint, { method: 'POST' }))

    expect(response.status).toBe(403)
    expect(dependencies.crawl).not.toHaveBeenCalled()
  })

  it('rejects invalid pagination without touching the upstream site', async () => {
    const response = await POST(new NextRequest(
      `${endpoint}?limit=25&offset=-1`,
      { method: 'POST' },
    ))

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('invalid_pagination')
    expect(dependencies.crawl).not.toHaveBeenCalled()
  })

  it('returns a retryable 502 with the bounded failure snapshot', async () => {
    dependencies.crawl.mockResolvedValue(snapshot('failed'))
    const response = await POST(new NextRequest(endpoint, { method: 'POST' }))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(response.headers.get('retry-after')).toBe('15')
    expect(body).toMatchObject({
      ok: false,
      data: { status: 'failed' },
      error: {
        code: 'catalog_sync_failed',
        retryable: true,
      },
    })
  })
})
