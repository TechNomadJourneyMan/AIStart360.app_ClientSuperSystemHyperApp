import { createHash } from 'node:crypto'

export const MYHONOR_PUBLIC_ORIGIN = 'https://myhonor.shop'
export const MYHONOR_SITEMAP_URL = `${MYHONOR_PUBLIC_ORIGIN}/sitemap.xml`
export const MYHONOR_ROBOTS_SCOPE = ['/sitemap.xml', '/product/*'] as const

export const MYHONOR_SITEMAP_MAX_URLS = 500
export const MYHONOR_CRAWL_CONCURRENCY = 3
export const MYHONOR_SITEMAP_MAX_BYTES = 512 * 1024
export const MYHONOR_PRODUCT_MAX_BYTES = 1536 * 1024
export const MYHONOR_FETCH_TIMEOUT_MS = 30_000
export const MYHONOR_ROUTE_DEFAULT_LIMIT = 12
export const MYHONOR_ROUTE_MAX_LIMIT = 24

const MAX_REDIRECTS = 2
const MAX_URL_LENGTH = 2_048
const PRODUCT_PATH_PATTERN = /^\/product\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/
const TEST_PRODUCT_SLUG_PATTERN = /^test-tx-prod(?:-|$)/i
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type MyHonorCatalogIssueStage = 'sitemap' | 'fetch' | 'parse'

export interface MyHonorCatalogIssue {
  stage: MyHonorCatalogIssueStage
  code: string
  message: string
  retryable: boolean
  url?: string
}

export interface MyHonorPublicOffer {
  price: number
  priceCurrency: 'KZT'
  availability: string | null
  url: string | null
}

export interface MyHonorProductProvenance {
  provider: 'myhonor-public'
  method: 'schema.org/Product JSON-LD'
  sourceUrl: string
  sitemapUrl: typeof MYHONOR_SITEMAP_URL
  retrievedAt: string
}

export interface MyHonorPublicProduct {
  externalId: string
  name: string
  url: string
  images: string[]
  brand: string | null
  description: string | null
  offers: MyHonorPublicOffer[]
  syncedAt: string
  provenance: MyHonorProductProvenance
}

export interface MyHonorProductParseResult {
  product: MyHonorPublicProduct | null
  issues: MyHonorCatalogIssue[]
}

export interface MyHonorSitemapParseResult {
  urls: string[]
  locationCount: number
  ignoredNonProductUrlCount: number
  excludedTestProductUrlCount: number
  rejectedUrlCount: number
  truncated: boolean
}

export interface MyHonorCatalogSnapshot {
  source: 'myhonor-public'
  status: 'complete' | 'partial' | 'failed'
  syncedAt: string
  sitemapUrl: typeof MYHONOR_SITEMAP_URL
  manifestHash: string
  manifestProductIds: string[]
  offset: number
  requestedLimit: number
  discoveredProductCount: number
  attemptedProductCount: number
  succeededProductCount: number
  excludedTestProductCount: number
  sitemapTruncated: boolean
  products: MyHonorPublicProduct[]
  issues: MyHonorCatalogIssue[]
  provenance: {
    origin: typeof MYHONOR_PUBLIC_ORIGIN
    discovery: 'public-sitemap'
    extraction: 'schema.org/Product JSON-LD'
    robotsAllowedPaths: typeof MYHONOR_ROBOTS_SCOPE
  }
}

export interface CrawlMyHonorCatalogOptions {
  fetch?: FetchLike
  limit?: number
  offset?: number
  timeoutMs?: number
  now?: () => Date
}

class MyHonorPublicError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'MyHonorPublicError'
  }
}

function parseExactOriginUrl(input: string): URL {
  if (
    typeof input !== 'string'
    || input.length === 0
    || input.length > MAX_URL_LENGTH
    || /[\u0000-\u0020\u007f]/.test(input)
  ) {
    throw new MyHonorPublicError('invalid_url', 'URL is not allowed', false)
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new MyHonorPublicError('invalid_url', 'URL is not allowed', false)
  }

  if (
    url.origin !== MYHONOR_PUBLIC_ORIGIN
    || url.protocol !== 'https:'
    || url.hostname !== 'myhonor.shop'
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw new MyHonorPublicError('invalid_url', 'URL is not allowed', false)
  }
  return url
}

export function validateMyHonorSitemapUrl(input: string): string {
  const url = parseExactOriginUrl(input)
  if (url.pathname !== '/sitemap.xml') {
    throw new MyHonorPublicError(
      'robots_scope_violation',
      'Only the public MyHonor sitemap may be fetched for discovery',
      false,
    )
  }
  return MYHONOR_SITEMAP_URL
}

export function validateMyHonorProductUrl(input: string): string {
  const url = parseExactOriginUrl(input)
  const matched = PRODUCT_PATH_PATTERN.exec(url.pathname)
  if (!matched) {
    throw new MyHonorPublicError(
      'robots_scope_violation',
      'Only public MyHonor product pages may be fetched',
      false,
    )
  }

  const slug = matched[1]
  if (TEST_PRODUCT_SLUG_PATTERN.test(slug)) {
    throw new MyHonorPublicError(
      'test_product_excluded',
      'Public transaction-test products are excluded from the catalog',
      false,
    )
  }
  return `${MYHONOR_PUBLIC_ORIGIN}/product/${slug}`
}

export function myHonorExternalProductId(productUrl: string): string {
  const canonicalUrl = validateMyHonorProductUrl(productUrl)
  return `myhonor:${createHash('sha256').update(canonicalUrl).digest('hex')}`
}

export function myHonorCatalogManifestHash(
  orderedProductIds: readonly string[],
): string {
  return createHash('sha256').update(orderedProductIds.join('\n')).digest('hex')
}

function decodeXmlText(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .trim()
}

export function parseMyHonorSitemap(xml: string): MyHonorSitemapParseResult {
  const urls: string[] = []
  const seen = new Set<string>()
  const matches = xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)
  let locationCount = 0
  let ignoredNonProductUrlCount = 0
  let excludedTestProductUrlCount = 0
  let rejectedUrlCount = 0
  let truncated = false

  for (const match of matches) {
    locationCount += 1
    if (locationCount > MYHONOR_SITEMAP_MAX_URLS) {
      truncated = true
      break
    }

    const value = decodeXmlText(match[1])
    let parsed: URL
    try {
      parsed = parseExactOriginUrl(value)
    } catch {
      rejectedUrlCount += 1
      continue
    }

    const productMatch = PRODUCT_PATH_PATTERN.exec(parsed.pathname)
    if (!productMatch) {
      ignoredNonProductUrlCount += 1
      continue
    }
    if (TEST_PRODUCT_SLUG_PATTERN.test(productMatch[1])) {
      excludedTestProductUrlCount += 1
      continue
    }

    try {
      const canonical = validateMyHonorProductUrl(value)
      if (!seen.has(canonical)) {
        seen.add(canonical)
        urls.push(canonical)
      }
    } catch {
      rejectedUrlCount += 1
    }
  }

  return {
    urls,
    locationCount: Math.min(locationCount, MYHONOR_SITEMAP_MAX_URLS),
    ignoredNonProductUrlCount,
    excludedTestProductUrlCount,
    rejectedUrlCount,
    truncated,
  }
}

function cleanText(
  value: unknown,
  maxLength: number,
  field: string,
  issues: MyHonorCatalogIssue[],
  sourceUrl: string,
): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  issues.push({
    stage: 'parse',
    code: 'field_truncated',
    message: `${field} exceeded the safe catalog field limit`,
    retryable: false,
    url: sourceUrl,
  })
  return normalized.slice(0, maxLength)
}

function isProductType(value: unknown): boolean {
  if (typeof value === 'string') {
    return value === 'Product' || value === 'https://schema.org/Product'
  }
  return Array.isArray(value) && value.some(isProductType)
}

function collectProductNodes(value: unknown, output: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectProductNodes(item, output))
    return
  }
  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  if (isProductType(record['@type'])) output.push(record)
  if (record['@graph']) collectProductNodes(record['@graph'], output)
}

function parseJsonLdScripts(
  html: string,
  sourceUrl: string,
): { products: Record<string, unknown>[]; issues: MyHonorCatalogIssue[] } {
  const products: Record<string, unknown>[] = []
  const issues: MyHonorCatalogIssue[] = []
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  let scriptMatch: RegExpExecArray | null
  let jsonLdCount = 0

  while ((scriptMatch = scriptPattern.exec(html)) !== null && jsonLdCount < 100) {
    if (!/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)(?:\s|>|$)/i.test(
      scriptMatch[1],
    )) {
      continue
    }
    jsonLdCount += 1
    try {
      collectProductNodes(JSON.parse(scriptMatch[2]) as unknown, products)
    } catch {
      issues.push({
        stage: 'parse',
        code: 'invalid_json_ld',
        message: 'A JSON-LD block could not be parsed',
        retryable: false,
        url: sourceUrl,
      })
    }
  }

  return { products, issues }
}

function normalizeHttpsDataUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:'
      || url.username !== ''
      || url.password !== ''
    ) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}

function imageValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(imageValues)
  if (value && typeof value === 'object') {
    const image = value as Record<string, unknown>
    return [image.contentUrl ?? image.url]
  }
  return [value]
}

function collectOfferValues(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectOfferValues)
  if (!value || typeof value !== 'object') return []
  const offer = value as Record<string, unknown>
  if (offer.price !== undefined) return [offer]
  return collectOfferValues(offer.offers)
}

function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  if (
    typeof value === 'string'
    && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())
  ) {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}

function issueOnce(
  issues: MyHonorCatalogIssue[],
  issue: MyHonorCatalogIssue,
): void {
  if (!issues.some((current) => current.code === issue.code && current.url === issue.url)) {
    issues.push(issue)
  }
}

function parseOffers(
  value: unknown,
  sourceUrl: string,
  issues: MyHonorCatalogIssue[],
): MyHonorPublicOffer[] {
  const offers: MyHonorPublicOffer[] = []
  for (const offer of collectOfferValues(value).slice(0, 100)) {
    const price = parsePrice(offer.price)
    const currency = typeof offer.priceCurrency === 'string'
      ? offer.priceCurrency.trim().toUpperCase()
      : ''

    if (price === null) {
      issueOnce(issues, {
        stage: 'parse',
        code: 'invalid_offer_price',
        message: 'An offer without a valid public price was ignored',
        retryable: false,
        url: sourceUrl,
      })
      continue
    }
    if (currency !== 'KZT') {
      issueOnce(issues, {
        stage: 'parse',
        code: 'non_kzt_offer',
        message: 'An offer without an explicit KZT currency was ignored',
        retryable: false,
        url: sourceUrl,
      })
      continue
    }

    const availability = cleanText(
      offer.availability,
      120,
      'offers.availability',
      issues,
      sourceUrl,
    )
    let offerUrl: string | null = null
    if (offer.url !== undefined) {
      try {
        offerUrl = validateMyHonorProductUrl(String(offer.url))
      } catch {
        issueOnce(issues, {
          stage: 'parse',
          code: 'invalid_offer_url',
          message: 'An offer URL outside the public MyHonor product scope was ignored',
          retryable: false,
          url: sourceUrl,
        })
      }
    }

    offers.push({
      price,
      priceCurrency: 'KZT',
      availability,
      url: offerUrl,
    })
  }

  if (offers.length === 0) {
    issueOnce(issues, {
      stage: 'parse',
      code: 'offers_unavailable',
      message: 'No valid public KZT offer was present in Product JSON-LD',
      retryable: false,
      url: sourceUrl,
    })
  }
  return offers
}

export function parseMyHonorProductJsonLd(
  html: string,
  sourceUrlInput: string,
  syncedAt: string,
): MyHonorProductParseResult {
  let sourceUrl: string
  try {
    sourceUrl = validateMyHonorProductUrl(sourceUrlInput)
  } catch {
    return {
      product: null,
      issues: [{
        stage: 'parse',
        code: 'invalid_source_url',
        message: 'The product source URL is outside the public MyHonor scope',
        retryable: false,
      }],
    }
  }

  const parsed = parseJsonLdScripts(html, sourceUrl)
  const issues = [...parsed.issues]
  let selected: Record<string, unknown> | null = null

  for (const candidate of parsed.products) {
    try {
      const candidateUrl = validateMyHonorProductUrl(String(candidate.url ?? ''))
      if (candidateUrl === sourceUrl) {
        selected = candidate
        break
      }
      issueOnce(issues, {
        stage: 'parse',
        code: 'product_url_mismatch',
        message: 'A Product JSON-LD block described a different product URL',
        retryable: false,
        url: sourceUrl,
      })
    } catch {
      issueOnce(issues, {
        stage: 'parse',
        code: 'invalid_product_url',
        message: 'A Product JSON-LD block had no allowed MyHonor product URL',
        retryable: false,
        url: sourceUrl,
      })
    }
  }

  if (!selected) {
    issueOnce(issues, {
      stage: 'parse',
      code: 'product_json_ld_missing',
      message: 'No matching Product JSON-LD block was found',
      retryable: false,
      url: sourceUrl,
    })
    return { product: null, issues }
  }

  const name = cleanText(selected.name, 300, 'name', issues, sourceUrl)
  if (!name) {
    issueOnce(issues, {
      stage: 'parse',
      code: 'product_name_missing',
      message: 'Product JSON-LD did not contain a usable name',
      retryable: false,
      url: sourceUrl,
    })
    return { product: null, issues }
  }

  const rawImages = imageValues(selected.image)
  const images = Array.from(new Set(
    rawImages
      .map(normalizeHttpsDataUrl)
      .filter((image): image is string => image !== null),
  )).slice(0, 20)
  if (rawImages.some((image) => image != null) && images.length === 0) {
    issueOnce(issues, {
      stage: 'parse',
      code: 'invalid_product_images',
      message: 'Product image URLs were not safe HTTPS URLs',
      retryable: false,
      url: sourceUrl,
    })
  }

  const brandValue = selected.brand && typeof selected.brand === 'object'
    ? (selected.brand as Record<string, unknown>).name
    : selected.brand
  const brand = cleanText(brandValue, 200, 'brand', issues, sourceUrl)
  const description = cleanText(
    selected.description,
    5_000,
    'description',
    issues,
    sourceUrl,
  )

  if (!brand) {
    issueOnce(issues, {
      stage: 'parse',
      code: 'brand_unavailable',
      message: 'Product JSON-LD did not contain a public brand',
      retryable: false,
      url: sourceUrl,
    })
  }
  if (!description) {
    issueOnce(issues, {
      stage: 'parse',
      code: 'description_unavailable',
      message: 'Product JSON-LD did not contain a public description',
      retryable: false,
      url: sourceUrl,
    })
  }

  return {
    product: {
      externalId: myHonorExternalProductId(sourceUrl),
      name,
      url: sourceUrl,
      images,
      brand,
      description,
      offers: parseOffers(selected.offers, sourceUrl, issues),
      syncedAt,
      provenance: {
        provider: 'myhonor-public',
        method: 'schema.org/Product JSON-LD',
        sourceUrl,
        sitemapUrl: MYHONOR_SITEMAP_URL,
        retrievedAt: syncedAt,
      },
    },
    issues,
  }
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new MyHonorPublicError(
      'body_too_large',
      'The upstream response exceeded the safe body limit',
      false,
    )
  }

  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new MyHonorPublicError(
        'body_too_large',
        'The upstream response exceeded the safe body limit',
        false,
      )
    }
    chunks.push(value)
  }

  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

async function fetchAllowedText(input: {
  url: string
  kind: 'sitemap' | 'product'
  fetch: FetchLike
  timeoutMs: number
}): Promise<string> {
  const validate = input.kind === 'sitemap'
    ? validateMyHonorSitemapUrl
    : validateMyHonorProductUrl
  const maxBytes = input.kind === 'sitemap'
    ? MYHONOR_SITEMAP_MAX_BYTES
    : MYHONOR_PRODUCT_MAX_BYTES
  let currentUrl = validate(input.url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs)

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      let response: Response
      try {
        response = await input.fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            Accept: input.kind === 'sitemap'
              ? 'application/xml,text/xml;q=0.9'
              : 'text/html,application/xhtml+xml;q=0.9',
            'User-Agent': 'AIStart360-MyHonor-Public-Catalog/1.0',
          },
        })
      } catch {
        if (controller.signal.aborted) {
          throw new MyHonorPublicError(
            'upstream_timeout',
            'The public MyHonor page did not respond before the timeout',
            true,
          )
        }
        throw new MyHonorPublicError(
          'network_error',
          'The public MyHonor page could not be reached',
          true,
        )
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location')
        void response.body?.cancel().catch(() => undefined)
        if (!location || redirectCount === MAX_REDIRECTS) {
          throw new MyHonorPublicError(
            'invalid_redirect',
            'The public MyHonor page returned an invalid redirect',
            false,
          )
        }
        let redirected: string
        try {
          redirected = new URL(location, currentUrl).href
        } catch {
          throw new MyHonorPublicError(
            'invalid_redirect',
            'The public MyHonor page returned an invalid redirect',
            false,
          )
        }
        currentUrl = validate(redirected)
        continue
      }

      if (!response.ok) {
        throw new MyHonorPublicError(
          'upstream_http_error',
          `The public MyHonor page returned HTTP ${response.status}`,
          response.status === 429 || response.status >= 500,
        )
      }

      const contentType = response.headers.get('content-type')
        ?.split(';', 1)[0]
        .trim()
        .toLowerCase() ?? ''
      const allowedTypes = input.kind === 'sitemap'
        ? new Set(['application/xml', 'text/xml'])
        : new Set(['text/html', 'application/xhtml+xml'])
      if (!allowedTypes.has(contentType)) {
        throw new MyHonorPublicError(
          'invalid_content_type',
          'The public MyHonor page returned an unexpected content type',
          false,
        )
      }
      try {
        return await readTextWithLimit(response, maxBytes)
      } catch (error) {
        if (error instanceof MyHonorPublicError) throw error
        if (controller.signal.aborted) {
          throw new MyHonorPublicError(
            'upstream_timeout',
            'The public MyHonor page did not respond before the timeout',
            true,
          )
        }
        throw new MyHonorPublicError(
          'network_error',
          'The public MyHonor response could not be read',
          true,
        )
      }
    }
  } finally {
    clearTimeout(timeout)
  }

  throw new MyHonorPublicError(
    'invalid_redirect',
    'The public MyHonor page returned too many redirects',
    false,
  )
}

function errorToIssue(
  error: unknown,
  stage: MyHonorCatalogIssueStage,
  url: string,
): MyHonorCatalogIssue {
  if (error instanceof MyHonorPublicError) {
    return {
      stage,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      url,
    }
  }
  return {
    stage,
    code: 'unexpected_error',
    message: 'The public catalog could not be processed',
    retryable: false,
    url,
  }
}

function emptySnapshot(input: {
  syncedAt: string
  offset: number
  limit: number
  issue: MyHonorCatalogIssue
}): MyHonorCatalogSnapshot {
  const manifestProductIds: string[] = []
  return {
    source: 'myhonor-public',
    status: 'failed',
    syncedAt: input.syncedAt,
    sitemapUrl: MYHONOR_SITEMAP_URL,
    manifestHash: myHonorCatalogManifestHash(manifestProductIds),
    manifestProductIds,
    offset: input.offset,
    requestedLimit: input.limit,
    discoveredProductCount: 0,
    attemptedProductCount: 0,
    succeededProductCount: 0,
    excludedTestProductCount: 0,
    sitemapTruncated: false,
    products: [],
    issues: [input.issue],
    provenance: {
      origin: MYHONOR_PUBLIC_ORIGIN,
      discovery: 'public-sitemap',
      extraction: 'schema.org/Product JSON-LD',
      robotsAllowedPaths: MYHONOR_ROBOTS_SCOPE,
    },
  }
}

export async function crawlMyHonorPublicCatalog(
  options: CrawlMyHonorCatalogOptions = {},
): Promise<MyHonorCatalogSnapshot> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const limit = Math.max(
    1,
    Math.min(
      MYHONOR_SITEMAP_MAX_URLS,
      Math.trunc(options.limit ?? MYHONOR_ROUTE_DEFAULT_LIMIT),
    ),
  )
  const offset = Math.max(
    0,
    Math.min(
      MYHONOR_SITEMAP_MAX_URLS - 1,
      Math.trunc(options.offset ?? 0),
    ),
  )
  const timeoutMs = Math.max(
    100,
    Math.min(30_000, Math.trunc(options.timeoutMs ?? MYHONOR_FETCH_TIMEOUT_MS)),
  )
  const syncedAt = (options.now ?? (() => new Date()))().toISOString()

  let sitemapXml: string
  try {
    sitemapXml = await fetchAllowedText({
      url: MYHONOR_SITEMAP_URL,
      kind: 'sitemap',
      fetch: fetchImpl,
      timeoutMs,
    })
  } catch (error) {
    return emptySnapshot({
      syncedAt,
      offset,
      limit,
      issue: errorToIssue(error, 'sitemap', MYHONOR_SITEMAP_URL),
    })
  }

  const sitemap = parseMyHonorSitemap(sitemapXml)
  const manifestProductIds = sitemap.urls.map(myHonorExternalProductId)
  const urls = sitemap.urls.slice(offset, offset + limit)
  const products: Array<MyHonorPublicProduct | null> = Array(urls.length).fill(null)
  const perProductIssues: MyHonorCatalogIssue[][] = Array.from(
    { length: urls.length },
    () => [],
  )
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < urls.length) {
      const index = nextIndex
      nextIndex += 1
      const url = urls[index]
      try {
        const html = await fetchAllowedText({
          url,
          kind: 'product',
          fetch: fetchImpl,
          timeoutMs,
        })
        const parsed = parseMyHonorProductJsonLd(html, url, syncedAt)
        products[index] = parsed.product
        perProductIssues[index].push(...parsed.issues)
      } catch (error) {
        perProductIssues[index].push(errorToIssue(error, 'fetch', url))
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(MYHONOR_CRAWL_CONCURRENCY, urls.length) },
    () => worker(),
  ))

  const issues = perProductIssues.flat()
  if (sitemap.urls.length === 0) {
    issues.unshift({
      stage: 'sitemap',
      code: 'sitemap_products_missing',
      message: 'The public sitemap contained no allowed MyHonor product URLs',
      retryable: false,
      url: MYHONOR_SITEMAP_URL,
    })
  }
  if (sitemap.rejectedUrlCount > 0) {
    issues.unshift({
      stage: 'sitemap',
      code: 'sitemap_urls_rejected',
      message: `${sitemap.rejectedUrlCount} sitemap URL(s) were outside the allowed public scope`,
      retryable: false,
      url: MYHONOR_SITEMAP_URL,
    })
  }
  if (sitemap.truncated) {
    issues.unshift({
      stage: 'sitemap',
      code: 'sitemap_truncated',
      message: `The sitemap exceeded the ${MYHONOR_SITEMAP_MAX_URLS} URL safety limit`,
      retryable: false,
      url: MYHONOR_SITEMAP_URL,
    })
  }

  const successfulProducts = products.filter(
    (product): product is MyHonorPublicProduct => product !== null,
  )
  const status: MyHonorCatalogSnapshot['status'] = issues.length === 0
    ? 'complete'
    : successfulProducts.length === 0
      && (urls.length > 0 || sitemap.urls.length === 0)
      ? 'failed'
      : 'partial'

  return {
    source: 'myhonor-public',
    status,
    syncedAt,
    sitemapUrl: MYHONOR_SITEMAP_URL,
    manifestHash: myHonorCatalogManifestHash(manifestProductIds),
    manifestProductIds,
    offset,
    requestedLimit: limit,
    discoveredProductCount: sitemap.urls.length,
    attemptedProductCount: urls.length,
    succeededProductCount: successfulProducts.length,
    excludedTestProductCount: sitemap.excludedTestProductUrlCount,
    sitemapTruncated: sitemap.truncated,
    products: successfulProducts,
    issues,
    provenance: {
      origin: MYHONOR_PUBLIC_ORIGIN,
      discovery: 'public-sitemap',
      extraction: 'schema.org/Product JSON-LD',
      robotsAllowedPaths: MYHONOR_ROBOTS_SCOPE,
    },
  }
}
