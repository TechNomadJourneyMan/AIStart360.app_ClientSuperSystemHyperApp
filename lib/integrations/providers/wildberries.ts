/**
 * Wildberries statistics adapter — «не проверено вживую» until tested with a
 * seller token.
 *
 * Official documentation (dev.wildberries.ru returns an anti-bot page to the
 * sandbox, but the published OpenAPI files it renders are reachable; read
 * 2026-10-06):
 *   general, auth, ping   https://dev.wildberries.ru/openapi/api-information
 *                         spec https://dev.wildberries.ru/api/swagger/yaml/ru/01-general.yaml
 *                         securitySchemes.HeaderApiKey: apiKey in header «Authorization»;
 *                         GET https://statistics-api.wildberries.ru/ping → {"TS": …, "Status": "OK"}
 *                         («Валидность токена авторизации и URL запроса … категория токена и сервис»)
 *   orders / sales        https://dev.wildberries.ru/openapi/reports
 *                         spec https://dev.wildberries.ru/api/swagger/yaml/ru/12-reports.yaml
 *                         GET /api/v1/supplier/orders, GET /api/v1/supplier/sales on statistics-api;
 *                         dateFrom (RFC3339, Moscow time), flag=1 → «вся информация обо всех заказах
 *                         или продажах с датой, равной переданному параметру dateFrom»;
 *                         OrdersItem.isCancel, priceWithDisc; SalesItem.saleID «S… — продажа»,
 *                         «R… — возврат», priceWithDisc, forPay;
 *                         limits per seller account: orders 1 request/min, sales 1 request/min
 *                         (Базовый токен: 1 request per 3 h / 2 h); data kept 90 days.
 *
 * Money: the statistics reports carry no currency field (prices are in the
 * seller's currency) — amounts are stored with unit 'seller_currency' and never
 * feed a ₸ metric. One day per run (two requests, one per endpoint) because of
 * the per-minute limits.
 */
import { COUNT_UNIT, SELLER_CURRENCY, roundFact, type FactInput } from '../facts'
import { num, requestJson, retryAfterHeader } from '../http'
import { MSK_OFFSET_MIN, advanceCursor, planDays, type DayCursor } from '../period'
import type { AdapterContext, ProviderAdapter, SyncResult } from './types'

export const WB_STATISTICS_BASE_URL = 'https://statistics-api.wildberries.ru'
const LABEL = 'Wildberries'

interface OrderRow { date?: string; isCancel?: boolean; priceWithDisc?: number; srid?: string }
interface SaleRow { date?: string; saleID?: string; priceWithDisc?: number; forPay?: number; srid?: string }

// The 429 body is application/problem+json (title / detail, 12-reports.yaml
// components.responses.429). The spec files do not name a retry header, so
// only the standard Retry-After is honoured; otherwise the next run waits for
// backfillIntervalMinutes.
const retryAfter = (h: Headers): number | null => retryAfterHeader(h)

async function get<T>(token: string, ctx: AdapterContext, path: string): Promise<T> {
  const res = await requestJson<T>(
    { fetch: ctx.fetch, budget: ctx.budget, secrets: ctx.secrets },
    { url: `${WB_STATISTICS_BASE_URL}${path}`, headers: { Authorization: token }, label: LABEL, retryAfter },
  )
  return res.data
}

export const wildberriesAdapter: ProviderAdapter = {
  key: 'wildberries',
  maxDaysPerRun: 1,
  requestBudget: 3,
  // orders / sales: 1 request per minute each — the agent cron (15 min) is slower anyway.
  backfillIntervalMinutes: 2,
  refreshIntervalMinutes: 240,

  async test(secret, _settings, ctx) {
    const data = await get<{ Status?: string }>(secret.token, ctx, '/ping')
    if (data?.Status !== 'OK') return { accountLabel: 'Wildberries' }
    return { accountLabel: 'Wildberries · статистика' }
  },

  async sync(secret, _settings, rawCursor, ctx): Promise<SyncResult> {
    const cursor = rawCursor as DayCursor
    const window = planDays(cursor, ctx.now, MSK_OFFSET_MIN, 1)
    if (!window) return { facts: [], cursor: { ...cursor }, caughtUp: true }
    const day = window.from
    const q = `dateFrom=${encodeURIComponent(day)}&flag=1`
    const orders = (await get<OrderRow[] | null>(secret.token, ctx, `/api/v1/supplier/orders?${q}`)) ?? []
    const sales = (await get<SaleRow[] | null>(secret.token, ctx, `/api/v1/supplier/sales?${q}`)) ?? []

    let ordersCount = 0
    let ordersAmount = 0
    for (const o of Array.isArray(orders) ? orders : []) {
      if (typeof o.date === 'string' && o.date.slice(0, 10) !== day) continue
      if (o.isCancel === true) continue
      ordersCount += 1
      ordersAmount += num(o.priceWithDisc) ?? 0
    }
    let salesCount = 0
    let revenue = 0
    let payout = 0
    let returnsCount = 0
    let returnsAmount = 0
    for (const s of Array.isArray(sales) ? sales : []) {
      if (typeof s.date === 'string' && s.date.slice(0, 10) !== day) continue
      const id = String(s.saleID ?? '')
      const price = num(s.priceWithDisc) ?? 0
      if (id.startsWith('S')) {
        salesCount += 1
        revenue += price
        payout += num(s.forPay) ?? 0
      } else if (id.startsWith('R')) {
        returnsCount += 1
        returnsAmount += Math.abs(price)
      }
    }

    const ref = `wildberries:${day}`
    const facts: FactInput[] = [
      { metricKey: 'orders_count', periodStart: day, periodEnd: day, value: ordersCount, unit: COUNT_UNIT, sourceRef: `${ref}:supplier/orders` },
      { metricKey: 'orders_amount', periodStart: day, periodEnd: day, value: roundFact('orders_amount', ordersAmount), unit: SELLER_CURRENCY, sourceRef: `${ref}:supplier/orders` },
      { metricKey: 'sales_count', periodStart: day, periodEnd: day, value: salesCount, unit: COUNT_UNIT, sourceRef: `${ref}:supplier/sales` },
      { metricKey: 'revenue', periodStart: day, periodEnd: day, value: roundFact('revenue', revenue), unit: SELLER_CURRENCY, sourceRef: `${ref}:supplier/sales` },
      { metricKey: 'payout', periodStart: day, periodEnd: day, value: roundFact('payout', payout), unit: SELLER_CURRENCY, sourceRef: `${ref}:supplier/sales` },
      { metricKey: 'returns_count', periodStart: day, periodEnd: day, value: returnsCount, unit: COUNT_UNIT, sourceRef: `${ref}:supplier/sales` },
      { metricKey: 'returns_amount', periodStart: day, periodEnd: day, value: roundFact('returns_amount', returnsAmount), unit: SELLER_CURRENCY, sourceRef: `${ref}:supplier/sales` },
    ]
    return { facts, cursor: advanceCursor({ ...cursor }, window) as Record<string, unknown>, caughtUp: window.refresh }
  },
}
