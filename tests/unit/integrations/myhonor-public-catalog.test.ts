import { describe, expect, it, vi } from 'vitest'
import {
  crawlMyHonorPublicCatalog,
  MYHONOR_CRAWL_CONCURRENCY,
  MYHONOR_PRODUCT_MAX_BYTES,
  MYHONOR_PUBLIC_ORIGIN,
  MYHONOR_SITEMAP_MAX_URLS,
  MYHONOR_SITEMAP_URL,
  myHonorCatalogManifestHash,
  myHonorExternalProductId,
  parseMyHonorProductJsonLd,
  parseMyHonorSitemap,
  validateMyHonorProductUrl,
  validateMyHonorSitemapUrl,
} from '@/lib/integrations/ecommerce/myhonor-public'

const syncedAt = '2026-07-29T04:00:00.000Z'

function sitemap(urls: string[]): string {
  return `<?xml version="1.0"?><urlset>${urls
    .map((url) => `<url><loc>${url.replace(/&/g, '&amp;')}</loc></url>`)
    .join('')}</urlset>`
}

function productHtml(
  url: string,
  overrides: Record<string, unknown> = {},
): string {
  return `<!doctype html><html><head>
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Костюм HONOR',
      url,
      image: [
        'https://cdn.example.kz/honor-1.webp',
        { '@type': 'ImageObject', contentUrl: 'https://cdn.example.kz/honor-2.webp' },
      ],
      brand: { '@type': 'Brand', name: 'HONOR' },
      description: 'Публичное описание товара.',
      offers: {
        '@type': 'Offer',
        price: '42000',
        priceCurrency: 'KZT',
        availability: 'https://schema.org/InStock',
        url,
      },
      ...overrides,
    })}</script>
  </head><body></body></html>`
}

function xmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    ...init,
    headers: {
      'content-type': 'application/xml',
      ...init.headers,
    },
  })
}

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    ...init,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...init.headers,
    },
  })
}

describe('MyHonor public catalog URL boundary', () => {
  it('allows only the exact HTTPS origin and robots-approved paths', () => {
    expect(validateMyHonorSitemapUrl(MYHONOR_SITEMAP_URL))
      .toBe(MYHONOR_SITEMAP_URL)
    expect(validateMyHonorProductUrl(`${MYHONOR_PUBLIC_ORIGIN}/product/2036/`))
      .toBe(`${MYHONOR_PUBLIC_ORIGIN}/product/2036`)

    const rejected = [
      'http://myhonor.shop/product/2036',
      'https://www.myhonor.shop/product/2036',
      'https://myhonor.shop.evil.example/product/2036',
      'https://myhonor.shop:444/product/2036',
      'https://user@myhonor.shop/product/2036',
      'https://myhonor.shop/api/products',
      'https://myhonor.shop/catalog',
      'https://myhonor.shop/product/2036?preview=1',
      'https://myhonor.shop/product/a%2Fb',
      'https://myhonor.shop/product/test-tx-prod-1785266493377-3',
    ]
    rejected.forEach((url) => expect(() => validateMyHonorProductUrl(url)).toThrow())
  })

  it('creates a deterministic external ID from the canonical product URL', () => {
    const withoutSlash = myHonorExternalProductId(
      `${MYHONOR_PUBLIC_ORIGIN}/product/2036`,
    )
    const withSlash = myHonorExternalProductId(
      `${MYHONOR_PUBLIC_ORIGIN}/product/2036/`,
    )
    expect(withoutSlash).toBe(withSlash)
    expect(withoutSlash).toMatch(/^myhonor:[a-f0-9]{64}$/)
  })

  it('hashes an ordered manifest exactly like the database contract', () => {
    expect(myHonorCatalogManifestHash(['myhonor:a', 'myhonor:b'])).toBe(
      '01b81b54e2b0f2a9fde69898142aad487a95b6d9b063745eab010959eab80b00',
    )
    expect(myHonorCatalogManifestHash([])).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})

describe('MyHonor sitemap parser', () => {
  it('keeps only public products, de-duplicates them, and excludes test transactions', () => {
    const result = parseMyHonorSitemap(sitemap([
      `${MYHONOR_PUBLIC_ORIGIN}/`,
      `${MYHONOR_PUBLIC_ORIGIN}/product/test-tx-prod-1785266493377-3`,
      `${MYHONOR_PUBLIC_ORIGIN}/product/2036`,
      `${MYHONOR_PUBLIC_ORIGIN}/product/2036/`,
      `${MYHONOR_PUBLIC_ORIGIN}/api/private`,
      'https://evil.example/product/1',
    ]))

    expect(result.urls).toEqual([`${MYHONOR_PUBLIC_ORIGIN}/product/2036`])
    expect(result.excludedTestProductUrlCount).toBe(1)
    expect(result.ignoredNonProductUrlCount).toBe(2)
    expect(result.rejectedUrlCount).toBe(1)
    expect(result.truncated).toBe(false)
  })

  it('never parses more than 500 sitemap locations', () => {
    const urls = Array.from(
      { length: MYHONOR_SITEMAP_MAX_URLS + 1 },
      (_, index) => `${MYHONOR_PUBLIC_ORIGIN}/product/item-${index}`,
    )
    const result = parseMyHonorSitemap(sitemap(urls))

    expect(result.urls).toHaveLength(MYHONOR_SITEMAP_MAX_URLS)
    expect(result.locationCount).toBe(MYHONOR_SITEMAP_MAX_URLS)
    expect(result.truncated).toBe(true)
  })
})

describe('MyHonor Product JSON-LD parser', () => {
  it('extracts verified public fields, KZT offers, provenance, and sync time', () => {
    const url = `${MYHONOR_PUBLIC_ORIGIN}/product/2036`
    const result = parseMyHonorProductJsonLd(productHtml(url), url, syncedAt)

    expect(result.issues).toEqual([])
    expect(result.product).toMatchObject({
      externalId: myHonorExternalProductId(url),
      name: 'Костюм HONOR',
      url,
      images: [
        'https://cdn.example.kz/honor-1.webp',
        'https://cdn.example.kz/honor-2.webp',
      ],
      brand: 'HONOR',
      description: 'Публичное описание товара.',
      offers: [{
        price: 42000,
        priceCurrency: 'KZT',
        availability: 'https://schema.org/InStock',
        url,
      }],
      syncedAt,
      provenance: {
        provider: 'myhonor-public',
        method: 'schema.org/Product JSON-LD',
        sourceUrl: url,
        sitemapUrl: MYHONOR_SITEMAP_URL,
        retrievedAt: syncedAt,
      },
    })
  })

  it('returns usable partial data while surfacing missing and non-KZT fields', () => {
    const url = `${MYHONOR_PUBLIC_ORIGIN}/product/2036`
    const result = parseMyHonorProductJsonLd(productHtml(url, {
      image: 'javascript:alert(1)',
      brand: null,
      description: null,
      offers: {
        price: '99',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
    }), url, syncedAt)

    expect(result.product).toMatchObject({
      url,
      images: [],
      brand: null,
      description: null,
      offers: [],
    })
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'invalid_product_images',
      'brand_unavailable',
      'description_unavailable',
      'non_kzt_offer',
      'offers_unavailable',
    ]))
  })

  it('does not substitute a requested URL for mismatched JSON-LD', () => {
    const sourceUrl = `${MYHONOR_PUBLIC_ORIGIN}/product/2036`
    const otherUrl = `${MYHONOR_PUBLIC_ORIGIN}/product/3013`
    const result = parseMyHonorProductJsonLd(
      productHtml(otherUrl),
      sourceUrl,
      syncedAt,
    )

    expect(result.product).toBeNull()
    expect(result.issues.map((issue) => issue.code)).toContain('product_url_mismatch')
    expect(result.issues.map((issue) => issue.code)).toContain('product_json_ld_missing')
  })
})

describe('MyHonor bounded crawler', () => {
  it('uses at most three product requests and surfaces partial failures', async () => {
    const productUrls = Array.from(
      { length: 6 },
      (_, index) => `${MYHONOR_PUBLIC_ORIGIN}/product/item-${index + 1}`,
    )
    let activeProducts = 0
    let maximumActiveProducts = 0
    const requested: string[] = []

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      requested.push(url)
      if (url === MYHONOR_SITEMAP_URL) {
        return xmlResponse(sitemap([
          `${MYHONOR_PUBLIC_ORIGIN}/product/test-tx-prod-1`,
          ...productUrls,
        ]))
      }

      activeProducts += 1
      maximumActiveProducts = Math.max(maximumActiveProducts, activeProducts)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeProducts -= 1
      if (url.endsWith('/item-4')) {
        return htmlResponse('unavailable', { status: 503 })
      }
      return htmlResponse(productHtml(url))
    })

    const result = await crawlMyHonorPublicCatalog({
      fetch: fetchMock,
      limit: 6,
      timeoutMs: 1_000,
      now: () => new Date(syncedAt),
    })

    expect(maximumActiveProducts).toBeLessThanOrEqual(MYHONOR_CRAWL_CONCURRENCY)
    expect(result.status).toBe('partial')
    expect(result.discoveredProductCount).toBe(6)
    expect(result.excludedTestProductCount).toBe(1)
    expect(result.attemptedProductCount).toBe(6)
    expect(result.succeededProductCount).toBe(5)
    expect(result.manifestProductIds).toEqual(
      productUrls.map(myHonorExternalProductId),
    )
    expect(result.manifestHash).toBe(
      myHonorCatalogManifestHash(result.manifestProductIds),
    )
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'upstream_http_error',
        url: `${MYHONOR_PUBLIC_ORIGIN}/product/item-4`,
        retryable: true,
      }),
    ]))
    expect(requested).not.toContain(
      `${MYHONOR_PUBLIC_ORIGIN}/product/test-tx-prod-1`,
    )
  })

  it('blocks a cross-origin redirect without fetching its target', async () => {
    const requested: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      requested.push(String(input))
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example/sitemap.xml' },
      })
    })

    const result = await crawlMyHonorPublicCatalog({
      fetch: fetchMock,
      now: () => new Date(syncedAt),
    })

    expect(result.status).toBe('failed')
    expect(result.issues[0].code).toBe('invalid_url')
    expect(requested).toEqual([MYHONOR_SITEMAP_URL])
  })

  it('rejects an oversized response before consuming its body', async () => {
    const fetchMock = vi.fn(async () => xmlResponse('<urlset/>', {
      headers: {
        'content-type': 'application/xml',
        'content-length': String(MYHONOR_PRODUCT_MAX_BYTES * 2),
      },
    }))

    const result = await crawlMyHonorPublicCatalog({
      fetch: fetchMock,
      now: () => new Date(syncedAt),
    })

    expect(result.status).toBe('failed')
    expect(result.issues[0].code).toBe('body_too_large')
  })

  it('does not report an empty public sitemap as a successful sync', async () => {
    const result = await crawlMyHonorPublicCatalog({
      fetch: async () => xmlResponse(sitemap([
        `${MYHONOR_PUBLIC_ORIGIN}/`,
        `${MYHONOR_PUBLIC_ORIGIN}/product/test-tx-prod-1`,
      ])),
      now: () => new Date(syncedAt),
    })

    expect(result.status).toBe('failed')
    expect(result.products).toEqual([])
    expect(result.issues[0].code).toBe('sitemap_products_missing')
  })

  it('aborts an upstream request at the configured timeout', async () => {
    const fetchMock = vi.fn((
      _input: string | URL | Request,
      init?: RequestInit,
    ) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'))
      })
    }))

    const result = await crawlMyHonorPublicCatalog({
      fetch: fetchMock,
      timeoutMs: 100,
      now: () => new Date(syncedAt),
    })

    expect(result.status).toBe('failed')
    expect(result.issues[0]).toMatchObject({
      code: 'upstream_timeout',
      retryable: true,
    })
  })

  it('classifies a timeout while streaming the response body as retryable', async () => {
    const productUrl = `${MYHONOR_PUBLIC_ORIGIN}/product/slow-body`
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(input) === MYHONOR_SITEMAP_URL) {
        return xmlResponse(sitemap([productUrl]))
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('aborted', 'AbortError'))
          })
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })

    const result = await crawlMyHonorPublicCatalog({
      fetch: fetchMock,
      timeoutMs: 100,
      now: () => new Date(syncedAt),
    })

    expect(result.status).toBe('failed')
    expect(result.issues[0]).toMatchObject({
      stage: 'fetch',
      code: 'upstream_timeout',
      retryable: true,
      url: productUrl,
    })
  })
})
