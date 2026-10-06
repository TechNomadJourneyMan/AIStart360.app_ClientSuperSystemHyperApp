/**
 * Contract tests of the live adapters (lib/integrations/providers/*) against
 * sample responses taken from the providers' official documentation (shapes
 * and field names copied from the docs cited in each adapter; values
 * paraphrased, no real customer data). Every request goes to a recording fake
 * fetch: the test checks the documented URL, auth header and parameters, the
 * mapping into facts, pagination and error classification.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { IntegrationError } from '@/lib/integrations/http'
import { moyskladAdapter } from '@/lib/integrations/providers/moysklad'
import { kaspiAdapter } from '@/lib/integrations/providers/kaspi'
import { wildberriesAdapter } from '@/lib/integrations/providers/wildberries'
import { ga4Adapter, GA4_SCOPE, GOOGLE_TOKEN_URL } from '@/lib/integrations/providers/ga4'
import { yandexMetrikaAdapter } from '@/lib/integrations/providers/yandex-metrika'
import { shopifyAdapter } from '@/lib/integrations/providers/shopify'
import type { FactInput } from '@/lib/integrations/facts'

interface Call { url: string; method: string; headers: Record<string, string>; body: string | undefined }

function fakeFetch(route: (url: URL, call: Call) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers: { ...(init?.headers as Record<string, string>) }, body: init?.body as string | undefined }
    calls.push(call)
    const r = route(new URL(call.url), call)
    return new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers })
  }) as unknown as typeof fetch
  return { fetch: fetchImpl, calls }
}

const NOW = new Date('2026-10-06T10:00:00Z')
const ctx = (f: typeof fetch, remaining = 100) => ({ fetch: f, now: NOW, budget: { remaining }, secrets: [] as string[] })
const fact = (facts: FactInput[], key: string, day: string) => facts.find((f) => f.metricKey === key && f.periodStart === day)

describe('МойСклад adapter (JSON API 1.2)', () => {
  const routes = (url: URL) => {
    const p = url.pathname.replace('/api/remap/1.2', '')
    if (p === '/entity/currency') return { body: { meta: { size: 1, limit: 1000, offset: 0 }, rows: [{ name: 'тенге', isoCode: 'KZT', default: true }] } }
    if (p === '/report/orders/plotseries') return { body: { meta: { type: 'ordersplotseries' }, series: [{ date: '2026-09-06 00:00:00', quantity: 3, sum: 60000 }, { date: '2026-10-05 00:00:00', quantity: 2, sum: 20000 }] } }
    if (p === '/report/sales/plotseries') return { body: { meta: { type: 'salesplotseries' }, series: [{ date: '2026-09-06 00:00:00', quantity: 3, sum: 90000 }] } }
    if (p === '/entity/salesreturn') return { body: { meta: { size: 1, limit: 1000, offset: 0 }, rows: [{ moment: '2026-09-06 14:39:00.000', sum: 30000, applicable: true }] } }
    if (p === '/entity/product') return { body: { meta: { size: 412, limit: 1, offset: 0 }, rows: [{}] } }
    if (p === '/report/stock/all') return { body: { meta: { size: 380, limit: 1, offset: 0 }, rows: [{}] } }
    return { status: 404, body: { errors: [{ error: 'not found' }] } }
  }

  it('test: GET /entity/currency?filter=default=true with Bearer token and gzip', async () => {
    const f = fakeFetch(routes)
    const res = await moyskladAdapter.test({ token: 'ms-token-value-0001' }, {}, ctx(f.fetch))
    expect(res.accountLabel).toBe('МойСклад · валюта учёта KZT')
    expect(f.calls[0].url).toBe('https://api.moysklad.ru/api/remap/1.2/entity/currency?filter=default%3Dtrue')
    expect(f.calls[0].headers.Authorization).toBe('Bearer ms-token-value-0001')
    expect(f.calls[0].headers['Accept-Encoding']).toBe('gzip')
  })

  it('sync: plotseries per day (kopecks → tenge), returns by day, catalogue / stock snapshot, cursor', async () => {
    const f = fakeFetch(routes)
    const res = await moyskladAdapter.sync({ token: 'ms-token-value-0001' }, {}, {}, ctx(f.fetch))
    const orders = f.calls.find((c) => c.url.includes('/report/orders/plotseries'))!
    const q = new URL(orders.url).searchParams
    expect(q.get('momentFrom')).toBe('2026-09-01 00:00:00')
    expect(q.get('momentTo')).toBe('2026-10-05 23:59:59')
    expect(q.get('interval')).toBe('day')
    const returns = new URL(f.calls.find((c) => c.url.includes('/entity/salesreturn'))!.url).searchParams
    expect(returns.get('filter')).toBe('moment>=2026-09-01 00:00:00;moment<=2026-10-05 23:59:59;applicable=true')

    expect(fact(res.facts, 'orders_count', '2026-09-06')).toMatchObject({ value: 3, unit: 'count' })
    expect(fact(res.facts, 'orders_amount', '2026-09-06')).toMatchObject({ value: 600, unit: 'KZT' })
    expect(fact(res.facts, 'revenue', '2026-09-06')).toMatchObject({ value: 900, unit: 'KZT' })
    expect(fact(res.facts, 'returns_count', '2026-09-06')).toMatchObject({ value: 1 })
    expect(fact(res.facts, 'returns_amount', '2026-09-06')).toMatchObject({ value: 300 })
    // A day without sales is a written zero (the window is complete), not a gap.
    expect(fact(res.facts, 'revenue', '2026-09-07')).toMatchObject({ value: 0 })
    expect(res.facts.filter((x) => x.metricKey === 'orders_count')).toHaveLength(35)
    expect(fact(res.facts, 'sku_count', '2026-10-06')).toMatchObject({ value: 412 })
    expect(fact(res.facts, 'sku_in_stock', '2026-10-06')).toMatchObject({ value: 380 })
    expect(new URL(f.calls.find((c) => c.url.includes('/report/stock/all'))!.url).searchParams.get('filter')).toBe('stockMode=positiveOnly')
    expect(res.cursor).toMatchObject({ filled_to: '2026-10-05', currency: 'KZT', snapshot_day: '2026-10-06' })
  })

  it('429 carries X-Lognex-Retry-After; 401 is an auth error', async () => {
    const limited = fakeFetch(() => ({ status: 429, body: { errors: [{ error: 'Превышен лимит', code: 1049 }] }, headers: { 'X-Lognex-Retry-After': '2500' } }))
    const e1 = await moyskladAdapter.test({ token: 't'.repeat(20) }, {}, ctx(limited.fetch)).catch((e) => e)
    expect(e1).toBeInstanceOf(IntegrationError)
    expect(e1).toMatchObject({ kind: 'rate_limit', retryAfterMs: 2500 })
    const denied = fakeFetch(() => ({ status: 401, body: { errors: [{ error: 'Ошибка аутентификации', code: 1056 }] } }))
    await expect(moyskladAdapter.test({ token: 't'.repeat(20) }, {}, ctx(denied.fetch))).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('Kaspi Магазин adapter (orders API)', () => {
  // Shape of the documented response (guide.kaspi.kz …/orders/q3201): data[].attributes, meta.pageCount.
  const order = (id: string, status: string, totalPrice: number, creationDate: number) => ({
    type: 'orders', id,
    attributes: { code: `code-${id}`, totalPrice, deliveryMode: 'DELIVERY_PICKUP', paymentMode: 'PAY_WITH_CREDIT', signatureRequired: false, state: 'ARCHIVE', creationDate, status, deliveryCost: 1000, isImeiRequired: false },
    relationships: {}, links: { self: `/v2/orders/${id}` },
  })
  // 2026-10-03 12:00 Almaty = 07:00 UTC
  const day3 = Date.parse('2026-10-03T07:00:00Z')

  it('test: GET /v2/orders with X-Auth-Token and the documented filters', async () => {
    const f = fakeFetch(() => ({ body: { data: [], included: [], meta: { pageCount: 0, totalCount: 0 } } }))
    await kaspiAdapter.test({ token: 'kaspi-token-000000' }, {}, ctx(f.fetch))
    const c = f.calls[0]
    expect(c.url.startsWith('https://kaspi.kz/shop/api/v2/orders?')).toBe(true)
    expect(c.headers['X-Auth-Token']).toBe('kaspi-token-000000')
    expect(c.headers['Content-Type']).toBe('application/vnd.api+json')
    const q = new URL(c.url).searchParams
    expect(q.get('page[number]')).toBe('0')
    expect(q.get('filter[orders][state]')).toBe('NEW')
    expect(Number(q.get('filter[orders][creationDate][$le]')) - Number(q.get('filter[orders][creationDate][$ge]'))).toBe(86_400_000)
  })

  it('sync: every state, pages up to meta.pageCount, statuses → orders / sales / returns per Almaty day', async () => {
    const f = fakeFetch((url) => {
      const state = url.searchParams.get('filter[orders][state]')
      const page = Number(url.searchParams.get('page[number]'))
      if (state === 'ARCHIVE') {
        return page === 0
          ? { body: { data: [order('1', 'COMPLETED', 96045, day3), order('2', 'CANCELLED', 5000, day3)], meta: { pageCount: 2, totalCount: 3 } } }
          : { body: { data: [order('3', 'RETURNED', 12000, day3)], meta: { pageCount: 2, totalCount: 3 } } }
      }
      if (state === 'KASPI_DELIVERY') return { body: { data: [order('4', 'ACCEPTED_BY_MERCHANT', 20000, day3)], meta: { pageCount: 1, totalCount: 1 } } }
      return { body: { data: [], meta: { pageCount: 0, totalCount: 0 } } }
    })
    const res = await kaspiAdapter.sync({ token: 'kaspi-token-000000' }, {}, { filled_to: '2026-09-30' }, ctx(f.fetch))
    const states = new Set(f.calls.map((c) => new URL(c.url).searchParams.get('filter[orders][state]')))
    expect([...states].sort()).toEqual(['ARCHIVE', 'DELIVERY', 'KASPI_DELIVERY', 'NEW', 'PICKUP', 'SIGN_REQUIRED'])
    expect(f.calls.filter((c) => c.url.includes('ARCHIVE'))).toHaveLength(2)
    expect(f.calls.every((c) => new URL(c.url).searchParams.get('page[size]') === '100')).toBe(true)
    // window 2026-10-01 … 2026-10-05 (Almaty); orders: completed + returned + accepted (cancelled excluded)
    expect(fact(res.facts, 'orders_count', '2026-10-03')).toMatchObject({ value: 3 })
    expect(fact(res.facts, 'orders_amount', '2026-10-03')).toMatchObject({ value: 128045, unit: 'KZT' })
    expect(fact(res.facts, 'sales_count', '2026-10-03')).toMatchObject({ value: 1 })
    expect(fact(res.facts, 'revenue', '2026-10-03')).toMatchObject({ value: 96045, unit: 'KZT' })
    expect(fact(res.facts, 'returns_count', '2026-10-03')).toMatchObject({ value: 1 })
    expect(fact(res.facts, 'orders_count', '2026-10-01')).toMatchObject({ value: 0 })
    expect(res.cursor).toMatchObject({ filled_to: '2026-10-05' })
  })

  it('stops at the request budget instead of paging without bound', async () => {
    const f = fakeFetch(() => ({ body: { data: [order('x', 'COMPLETED', 1, day3)], meta: { pageCount: 999, totalCount: 99_900 } } }))
    await expect(kaspiAdapter.sync({ token: 'kaspi-token-000000' }, {}, { filled_to: '2026-09-30' }, ctx(f.fetch, 10))).rejects.toThrow('request budget exhausted')
    expect(f.calls).toHaveLength(10)
  })
})

describe('Wildberries adapter (statistics API)', () => {
  // Field names from 12-reports.yaml (OrdersItem / SalesItem examples).
  const routes = (url: URL) => {
    if (url.pathname === '/ping') return { body: { TS: '2026-10-06T13:00:00+03:00', Status: 'OK' } }
    if (url.pathname === '/api/v1/supplier/orders') {
      return { body: [
        { date: '2026-10-04T18:08:31', lastChangeDate: '2026-10-05T10:11:07', supplierArticle: '12345', nmId: 1234567, totalPrice: 1887, discountPercent: 18, finishedPrice: 1145, priceWithDisc: 1547, isCancel: false, srid: 'a1' },
        { date: '2026-10-04T19:00:00', lastChangeDate: '2026-10-05T10:11:07', supplierArticle: '12345', nmId: 1234567, totalPrice: 1887, priceWithDisc: 1547, isCancel: true, srid: 'a2' },
      ] }
    }
    if (url.pathname === '/api/v1/supplier/sales') {
      return { body: [
        { date: '2026-10-04T18:08:31', supplierArticle: '12345', priceWithDisc: 1547, forPay: 1284.01, finishedPrice: 1145, saleID: 'S9993700024', srid: 'a1' },
        { date: '2026-10-04T20:00:00', supplierArticle: '12345', priceWithDisc: -1547, forPay: -1284.01, saleID: 'R9993700025', srid: 'a3' },
      ] }
    }
    return { status: 404, body: { title: 'not found' } }
  }

  it('test: GET statistics-api /ping with the token in Authorization (no scheme)', async () => {
    const f = fakeFetch(routes)
    await wildberriesAdapter.test({ token: 'wb-token-0000000000' }, {}, ctx(f.fetch))
    expect(f.calls[0].url).toBe('https://statistics-api.wildberries.ru/ping')
    expect(f.calls[0].headers.Authorization).toBe('wb-token-0000000000')
  })

  it('sync: one day per run with flag=1; sales S… / returns R…; money in the seller currency', async () => {
    const f = fakeFetch(routes)
    const res = await wildberriesAdapter.sync({ token: 'wb-token-0000000000' }, {}, { filled_to: '2026-10-03' }, ctx(f.fetch))
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=2026-10-04&flag=1',
      'https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=2026-10-04&flag=1',
    ])
    expect(fact(res.facts, 'orders_count', '2026-10-04')).toMatchObject({ value: 1 })
    expect(fact(res.facts, 'orders_amount', '2026-10-04')).toMatchObject({ value: 1547, unit: 'seller_currency' })
    expect(fact(res.facts, 'sales_count', '2026-10-04')).toMatchObject({ value: 1 })
    expect(fact(res.facts, 'payout', '2026-10-04')).toMatchObject({ value: 1284.01 })
    expect(fact(res.facts, 'returns_count', '2026-10-04')).toMatchObject({ value: 1 })
    expect(fact(res.facts, 'returns_amount', '2026-10-04')).toMatchObject({ value: 1547 })
    expect(res.cursor).toMatchObject({ filled_to: '2026-10-04' })
    expect(res.facts.every((x) => x.unit !== 'KZT')).toBe(true)
  })

  it('401 problem+json → auth', async () => {
    const f = fakeFetch(() => ({ status: 401, body: { title: 'unauthorized', detail: 'token is malformed', status: 401 } }))
    await expect(wildberriesAdapter.test({ token: 'wb-token-0000000000' }, {}, ctx(f.fetch))).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('GA4 adapter (Data API, service account)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const sa = JSON.stringify({ type: 'service_account', client_email: 'reader@proj.iam.gserviceaccount.com', private_key: pem, private_key_id: 'kid1' })

  const routes = (url: URL) => {
    if (url.href === GOOGLE_TOKEN_URL) return { body: { access_token: 'ya29.test-access', token_type: 'Bearer', expires_in: 3600 } }
    if (url.pathname === '/v1beta/properties/123456789:runReport') {
      return { body: {
        dimensionHeaders: [{ name: 'date' }],
        metricHeaders: [{ name: 'sessions', type: 'TYPE_INTEGER' }, { name: 'activeUsers', type: 'TYPE_INTEGER' }, { name: 'ecommercePurchases', type: 'TYPE_INTEGER' }, { name: 'purchaseRevenue', type: 'TYPE_CURRENCY' }],
        rows: [{ dimensionValues: [{ value: '20261004' }], metricValues: [{ value: '120' }, { value: '100' }, { value: '3' }, { value: '45000.5' }] }],
        rowCount: 1,
        metadata: { currencyCode: 'KZT', timeZone: 'Asia/Almaty' },
        kind: 'analyticsData#runReport',
      } }
    }
    return { status: 404, body: { error: { message: 'not found' } } }
  }

  it('signs an RS256 assertion (iss / scope / aud / exp ≤ 1 h) and exchanges it with the jwt-bearer grant', async () => {
    const f = fakeFetch(routes)
    await ga4Adapter.test({ service_account_json: sa }, { property_id: '123456789' }, ctx(f.fetch))
    const tokenCall = f.calls[0]
    expect(tokenCall.url).toBe(GOOGLE_TOKEN_URL)
    const form = new URLSearchParams(tokenCall.body)
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    const [h, c, sig] = form.get('assertion')!.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid1' })
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
    expect(claims).toMatchObject({ iss: 'reader@proj.iam.gserviceaccount.com', scope: GA4_SCOPE, aud: GOOGLE_TOKEN_URL })
    expect(claims.exp - claims.iat).toBe(3600)
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true)
    expect(f.calls[1].headers.Authorization).toBe('Bearer ya29.test-access')
  })

  it('sync: runReport by date in KZT; days without rows are zeros', async () => {
    const f = fakeFetch(routes)
    const res = await ga4Adapter.sync({ service_account_json: sa }, { property_id: '123456789' }, { filled_to: '2026-09-28' }, ctx(f.fetch))
    const body = JSON.parse(f.calls[1].body!)
    expect(body).toMatchObject({ dateRanges: [{ startDate: '2026-09-29', endDate: '2026-10-05' }], dimensions: [{ name: 'date' }], currencyCode: 'KZT', keepEmptyRows: true })
    expect(body.metrics.map((m: { name: string }) => m.name)).toEqual(['sessions', 'activeUsers', 'ecommercePurchases', 'purchaseRevenue'])
    expect(fact(res.facts, 'sessions', '2026-10-04')).toMatchObject({ value: 120, unit: 'count' })
    expect(fact(res.facts, 'web_revenue', '2026-10-04')).toMatchObject({ value: 45000.5, unit: 'KZT' })
    expect(fact(res.facts, 'sessions', '2026-10-03')).toMatchObject({ value: 0 })
  })

  it('a rejected key (invalid_grant) is an auth error; a broken JSON is a config error', async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' } }))
    await expect(ga4Adapter.test({ service_account_json: sa }, { property_id: '123456789' }, ctx(f.fetch))).rejects.toMatchObject({ kind: 'auth' })
    await expect(ga4Adapter.test({ service_account_json: '{"type":"user"}' }, { property_id: '1' }, ctx(f.fetch))).rejects.toMatchObject({ kind: 'config' })
  })
})

describe('Яндекс Метрика adapter (Reports API)', () => {
  it('stat/v1/data with OAuth header, ids, ym:s:date, accuracy=full', async () => {
    const f = fakeFetch(() => ({ body: { data: [{ dimensions: [{ name: '2026-10-04' }], metrics: [120, 100, 3] }], total_rows: 1, totals: [120, 100, 3] } }))
    const res = await yandexMetrikaAdapter.sync({ token: 'y0_metrika_token_00' }, { counter_id: '44147844' }, { filled_to: '2026-09-30' }, ctx(f.fetch))
    const c = f.calls[0]
    expect(c.headers.Authorization).toBe('OAuth y0_metrika_token_00')
    const q = new URL(c.url).searchParams
    expect(new URL(c.url).origin + new URL(c.url).pathname).toBe('https://api-metrika.yandex.net/stat/v1/data')
    expect(q.get('ids')).toBe('44147844')
    expect(q.get('metrics')).toBe('ym:s:visits,ym:s:users,ym:s:ecommercePurchases')
    expect(q.get('dimensions')).toBe('ym:s:date')
    expect(q.get('accuracy')).toBe('full')
    expect(q.get('date1')).toBe('2026-10-01')
    expect(fact(res.facts, 'sessions', '2026-10-04')).toMatchObject({ value: 120 })
    expect(fact(res.facts, 'web_purchases', '2026-10-04')).toMatchObject({ value: 3 })
    expect(res.facts.some((x) => x.metricKey === 'web_revenue')).toBe(false)
  })

  it('429 → rate_limit', async () => {
    const f = fakeFetch(() => ({ status: 429, body: { errors: [{ error_type: 'quota_requests_by_uid', message: 'Quota exceeded' }], code: 429 } }))
    await expect(yandexMetrikaAdapter.test({ token: 'y0_metrika_token_00' }, { counter_id: '1' }, ctx(f.fetch))).rejects.toMatchObject({ kind: 'rate_limit' })
  })
})

describe('Shopify adapter (GraphQL Admin API 2026-10)', () => {
  it('ordersCount + bounded orders paging per UTC day, X-Shopify-Access-Token', async () => {
    const f = fakeFetch((_url, call) => {
      const body = JSON.parse(call.body ?? '{}')
      if (body.query.includes('ordersCount')) return { body: { data: { ordersCount: { count: 2, precision: 'EXACT' } } } }
      return { body: { data: { orders: { nodes: [{ totalPriceSet: { shopMoney: { amount: '1500.00', currencyCode: 'KZT' } } }, { totalPriceSet: { shopMoney: { amount: '500.50', currencyCode: 'KZT' } } }], pageInfo: { hasNextPage: false, endCursor: null } } } } }
    })
    const res = await shopifyAdapter.sync({ token: 'shpat_0123456789abcdef' }, { shop_domain: 'demo.myshopify.com' }, { filled_to: '2026-10-03' }, ctx(f.fetch))
    expect(f.calls[0].url).toBe('https://demo.myshopify.com/admin/api/2026-10/graphql.json')
    expect(f.calls[0].headers['X-Shopify-Access-Token']).toBe('shpat_0123456789abcdef')
    expect(JSON.parse(f.calls[0].body!).variables.q).toBe("created_at:>='2026-10-04T00:00:00Z' created_at:<'2026-10-05T00:00:00Z'")
    expect(fact(res.facts, 'orders_count', '2026-10-04')).toMatchObject({ value: 2 })
    expect(fact(res.facts, 'orders_amount', '2026-10-04')).toMatchObject({ value: 2000.5, unit: 'KZT' })
  })

  it('HTTP 200 with THROTTLED → rate_limit, ACCESS_DENIED → auth', async () => {
    const throttled = fakeFetch(() => ({ body: { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] } }))
    await expect(shopifyAdapter.test({ token: 'shpat_0123456789abcdef' }, { shop_domain: 'demo.myshopify.com' }, ctx(throttled.fetch))).rejects.toMatchObject({ kind: 'rate_limit' })
    const denied = fakeFetch(() => ({ body: { errors: [{ message: 'denied', extensions: { code: 'ACCESS_DENIED' } }] } }))
    await expect(shopifyAdapter.test({ token: 'shpat_0123456789abcdef' }, { shop_domain: 'demo.myshopify.com' }, ctx(denied.fetch))).rejects.toMatchObject({ kind: 'auth' })
  })
})
