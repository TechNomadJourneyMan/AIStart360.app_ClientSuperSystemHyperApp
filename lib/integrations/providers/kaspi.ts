/**
 * Kaspi Магазин API adapter (orders) — «не проверено вживую» until tested with
 * a seller token.
 *
 * Official documentation (Kaspi Гид для партнёров, read 2026-10-06):
 *   token                https://guide.kaspi.kz/partner/ru/shop/api/general/q3196
 *                        («Получить токен авторизации может только руководитель компании …
 *                        Настройки → Токен API → Сформировать»)
 *   list of orders       https://guide.kaspi.kz/partner/ru/shop/api/orders/q3201
 *                        GET https://kaspi.kz/shop/api/v2/orders
 *                        Content-Type: application/vnd.api+json, X-Auth-Token: <token>
 *                        page[number] (from 0), page[size] (max 100),
 *                        filter[orders][state] NEW | SIGN_REQUIRED | PICKUP | DELIVERY | KASPI_DELIVERY | ARCHIVE,
 *                        filter[orders][creationDate][$ge] / [$le] (milliseconds),
 *                        response data[].attributes: totalPrice («Общая сумма заказа в теңге»),
 *                        status APPROVED_BY_BANK | ACCEPTED_BY_MERCHANT | COMPLETED | CANCELLED |
 *                        CANCELLING | KASPI_DELIVERY_RETURN_REQUESTED | RETURNED, creationDate (ms);
 *                        meta.pageCount, meta.totalCount
 *   response codes       https://guide.kaspi.kz/partner/ru/shop/api/general/q3198
 *                        («статус-код ответа будет 200. Другой статус значит, что в запросе есть ошибка»)
 *
 * The guide documents no rate limit and no maximum creationDate range; the
 * adapter keeps a window of 7 days and a budget of 60 requests per run.
 * Days are counted in Asia/Almaty (UTC+5) — creationDate is an epoch value.
 */
import { COUNT_UNIT, roundFact, type FactInput } from '../facts'
import { num, requestJson } from '../http'
import { ALMATY_OFFSET_MIN, advanceCursor, dayOfMs, dayStartMs, addDays, maxDaysFor, planDays, type DayCursor } from '../period'
import type { AdapterContext, ProviderAdapter, SyncResult } from './types'

export const KASPI_BASE_URL = 'https://kaspi.kz/shop/api/v2'
const LABEL = 'Kaspi Магазин'
const PAGE_SIZE = 100
const MAX_DAYS_PER_RUN = 7
/** Every order is in exactly one state; together they cover all orders. */
export const KASPI_STATES = ['NEW', 'SIGN_REQUIRED', 'PICKUP', 'DELIVERY', 'KASPI_DELIVERY', 'ARCHIVE'] as const

const CANCELLED = new Set(['CANCELLED', 'CANCELLING'])
const RETURNED = new Set(['RETURNED', 'KASPI_DELIVERY_RETURN_REQUESTED'])

interface OrdersPage {
  data?: Array<{ id?: string; attributes?: { totalPrice?: number; status?: string; creationDate?: number } }>
  meta?: { pageCount?: number; totalCount?: number }
}

function headers(token: string): Record<string, string> {
  return { 'Content-Type': 'application/vnd.api+json', 'X-Auth-Token': token }
}

function ordersUrl(state: string, fromMs: number, toMs: number, page: number, size: number): string {
  const p = new URLSearchParams()
  p.set('page[number]', String(page))
  p.set('page[size]', String(size))
  p.set('filter[orders][state]', state)
  p.set('filter[orders][creationDate][$ge]', String(fromMs))
  p.set('filter[orders][creationDate][$le]', String(toMs))
  return `${KASPI_BASE_URL}/orders?${p.toString()}`
}

async function page(token: string, ctx: AdapterContext, url: string): Promise<OrdersPage> {
  const res = await requestJson<OrdersPage>({ fetch: ctx.fetch, budget: ctx.budget, secrets: ctx.secrets }, { url, headers: headers(token), label: LABEL })
  return res.data
}

interface DayAgg { orders: number; ordersAmount: number; sales: number; revenue: number; returns: number; returnsAmount: number }

const empty = (): DayAgg => ({ orders: 0, ordersAmount: 0, sales: 0, revenue: 0, returns: 0, returnsAmount: 0 })

export const kaspiAdapter: ProviderAdapter = {
  key: 'kaspi',
  maxDaysPerRun: MAX_DAYS_PER_RUN,
  requestBudget: 60,
  backfillIntervalMinutes: 5,
  refreshIntervalMinutes: 120,

  async test(secret, _settings, ctx) {
    const to = ctx.now.getTime()
    await page(secret.token, ctx, ordersUrl('NEW', to - 86_400_000, to, 0, 1))
    return { accountLabel: 'Kaspi Магазин' }
  },

  async sync(secret, _settings, rawCursor, ctx): Promise<SyncResult> {
    const cursor = rawCursor as DayCursor
    const window = planDays(cursor, ctx.now, ALMATY_OFFSET_MIN, maxDaysFor(rawCursor, MAX_DAYS_PER_RUN))
    if (!window) return { facts: [], cursor: { ...cursor }, caughtUp: true }

    const fromMs = dayStartMs(window.from, ALMATY_OFFSET_MIN)
    const toMs = dayStartMs(addDays(window.to, 1), ALMATY_OFFSET_MIN) - 1
    const byDay = new Map<string, DayAgg>(window.days.map((d) => [d, empty()]))
    const seen = new Set<string>()

    for (const state of KASPI_STATES) {
      for (let p = 0; p < 1000; p++) {
        const res = await page(secret.token, ctx, ordersUrl(state, fromMs, toMs, p, PAGE_SIZE))
        for (const o of res.data ?? []) {
          const a = o.attributes ?? {}
          const created = num(a.creationDate)
          if (created === null) continue
          const key = String(o.id ?? `${state}:${created}:${a.totalPrice}`)
          if (seen.has(key)) continue
          seen.add(key)
          const agg = byDay.get(dayOfMs(created, ALMATY_OFFSET_MIN))
          if (!agg) continue
          const price = num(a.totalPrice) ?? 0
          const status = String(a.status ?? '')
          if (!CANCELLED.has(status)) {
            agg.orders += 1
            agg.ordersAmount += price
          }
          if (status === 'COMPLETED') {
            agg.sales += 1
            agg.revenue += price
          }
          if (RETURNED.has(status)) {
            agg.returns += 1
            agg.returnsAmount += price
          }
        }
        const pageCount = num(res.meta?.pageCount) ?? 0
        if (p + 1 >= pageCount || !(res.data ?? []).length) break
      }
    }

    const facts: FactInput[] = []
    for (const [day, a] of byDay) {
      const ref = `kaspi:${day}:orders`
      facts.push(
        { metricKey: 'orders_count', periodStart: day, periodEnd: day, value: a.orders, unit: COUNT_UNIT, sourceRef: ref },
        { metricKey: 'orders_amount', periodStart: day, periodEnd: day, value: roundFact('orders_amount', a.ordersAmount), unit: 'KZT', sourceRef: ref },
        { metricKey: 'sales_count', periodStart: day, periodEnd: day, value: a.sales, unit: COUNT_UNIT, sourceRef: ref },
        { metricKey: 'revenue', periodStart: day, periodEnd: day, value: roundFact('revenue', a.revenue), unit: 'KZT', sourceRef: ref },
        { metricKey: 'returns_count', periodStart: day, periodEnd: day, value: a.returns, unit: COUNT_UNIT, sourceRef: ref },
        { metricKey: 'returns_amount', periodStart: day, periodEnd: day, value: roundFact('returns_amount', a.returnsAmount), unit: 'KZT', sourceRef: ref },
      )
    }
    return { facts, cursor: advanceCursor({ ...cursor }, window) as Record<string, unknown>, caughtUp: window.refresh }
  },
}
