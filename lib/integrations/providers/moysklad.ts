/**
 * МойСклад JSON API 1.2 adapter — «не проверено вживую» until tested with a
 * seller token.
 *
 * Official documentation (read 2026-10-06; the dev.moysklad.ru SPA renders the
 * markdown of the official repository github.com/moysklad/api-remap-1.2-doc):
 *   auth, gzip, errors, rate-limit headers  https://dev.moysklad.ru/doc/api/remap/1.2/#/general
 *                                           (md/_general.md: «Authorization: Bearer <Access-Token>»,
 *                                           «Сервер апи поддерживает только кодировку gzip … 415»,
 *                                           X-Lognex-Retry-After «время до сброса ограничения в миллисекундах»)
 *   limits                                  https://dev.moysklad.ru/doc/api/remap/1.2/#/restrictions
 *                                           (md/_restrictions.md: ≤5 parallel requests per user,
 *                                           token users 15 requests / 3 s from 2026-09-01, report/stock/all weighs 5)
 *   orders / sales per day                  https://dev.moysklad.ru/doc/api/remap/1.2/#/reports/report-sales-orders
 *                                           (md/reports/_report_sales_orders.md: GET /report/orders/plotseries,
 *                                           /report/sales/plotseries, momentFrom, momentTo, interval=day;
 *                                           series[].date / quantity / sum; right viewDashboard)
 *   customer returns                        md/documents/_sales_return.md: GET /entity/salesreturn,
 *                                           filter moment >= / <=, applicable, «sum — в копейках», limit ≤ 1000
 *   catalogue / stock size                  md/dictionaries/_product.md (GET /entity/product, meta.size),
 *                                           md/reports/_report_stock.md (GET /report/stock/all, filter=stockMode=positiveOnly)
 *   account currency                        md/dictionaries/_currency.md (GET /entity/currency, filter default=true, isoCode)
 *   date-time format, MSK                   md/_general.md «Формат даты и времени»: «ГГГГ-ММ-ДД ЧЧ:мм:сс», MSK
 *
 * Money: МойСклад documents state sums «в копейках» (demand.sum, salesreturn.sum,
 * profit report costs). The plotseries «sum» has no unit in its table; it is read
 * in the same minor units (÷ 100) — to be confirmed in the live check.
 */
import { COUNT_UNIT, roundFact, type FactInput } from '../facts'
import { num, requestJson, type HttpContext } from '../http'
import { advanceCursor, MSK_OFFSET_MIN, dayOf, maxDaysFor, planDays, type DayCursor } from '../period'
import type { AdapterContext, ProviderAdapter, SyncResult } from './types'

export const MOYSKLAD_BASE_URL = 'https://api.moysklad.ru/api/remap/1.2'
const LABEL = 'МойСклад'
const MAX_DAYS_PER_RUN = 35
const PAGE = 1000

interface Cursor extends DayCursor {
  currency?: string
  snapshot_day?: string
}

interface MetaList<T> {
  meta?: { size?: number; limit?: number; offset?: number }
  rows?: T[]
}

interface PlotSeries {
  series?: Array<{ date?: string; quantity?: number; sum?: number }>
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Accept-Encoding': 'gzip',
    Accept: 'application/json;charset=utf-8',
  }
}

function http(ctx: AdapterContext): HttpContext {
  return { fetch: ctx.fetch, budget: ctx.budget, secrets: ctx.secrets }
}

const retryAfter = (h: Headers): number | null => {
  const v = num(h.get('x-lognex-retry-after'))
  return v === null ? null : Math.min(Math.max(v, 0), 60_000)
}

async function get<T>(token: string, ctx: AdapterContext, path: string): Promise<T> {
  const res = await requestJson<T>(http(ctx), { url: `${MOYSKLAD_BASE_URL}${path}`, headers: headers(token), label: LABEL, retryAfter })
  return res.data
}

async function accountCurrency(token: string, ctx: AdapterContext): Promise<string | null> {
  const data = await get<MetaList<{ isoCode?: string }>>(token, ctx, `/entity/currency?filter=${encodeURIComponent('default=true')}`)
  const iso = data.rows?.[0]?.isoCode
  return typeof iso === 'string' && /^[A-Z]{3}$/.test(iso) ? iso : null
}

function moment(day: string, end: boolean): string {
  return `${day} ${end ? '23:59:59' : '00:00:00'}`
}

async function plot(token: string, ctx: AdapterContext, kind: 'orders' | 'sales', from: string, to: string): Promise<Map<string, { quantity: number; sum: number }>> {
  const q = `momentFrom=${encodeURIComponent(moment(from, false))}&momentTo=${encodeURIComponent(moment(to, true))}&interval=day`
  const data = await get<PlotSeries>(token, ctx, `/report/${kind}/plotseries?${q}`)
  const out = new Map<string, { quantity: number; sum: number }>()
  for (const p of data.series ?? []) {
    const day = typeof p.date === 'string' ? p.date.slice(0, 10) : ''
    const quantity = num(p.quantity)
    const sum = num(p.sum)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || quantity === null || sum === null) continue
    const prev = out.get(day) ?? { quantity: 0, sum: 0 }
    out.set(day, { quantity: prev.quantity + quantity, sum: prev.sum + sum })
  }
  return out
}

async function salesReturns(token: string, ctx: AdapterContext, from: string, to: string): Promise<Map<string, { count: number; sum: number }>> {
  const filter = `moment>=${moment(from, false)};moment<=${moment(to, true)};applicable=true`
  const out = new Map<string, { count: number; sum: number }>()
  for (let offset = 0; offset < 100_000; offset += PAGE) {
    const data = await get<MetaList<{ moment?: string; sum?: number }>>(
      token, ctx, `/entity/salesreturn?filter=${encodeURIComponent(filter)}&limit=${PAGE}&offset=${offset}`,
    )
    for (const r of data.rows ?? []) {
      const day = typeof r.moment === 'string' ? r.moment.slice(0, 10) : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      const prev = out.get(day) ?? { count: 0, sum: 0 }
      out.set(day, { count: prev.count + 1, sum: prev.sum + (num(r.sum) ?? 0) })
    }
    const size = num(data.meta?.size) ?? 0
    if (offset + PAGE >= size || !(data.rows ?? []).length) break
  }
  return out
}

async function metaSize(token: string, ctx: AdapterContext, path: string): Promise<number | null> {
  const data = await get<MetaList<unknown>>(token, ctx, path)
  const n = num(data.meta?.size)
  return n !== null && n >= 0 ? n : null
}

const kopecks = (v: number) => v / 100

export const moyskladAdapter: ProviderAdapter = {
  key: 'moysklad',
  // Token users: 15 requests / 3 s (restrictions, from 2026-09-01); one run stays far below.
  maxDaysPerRun: MAX_DAYS_PER_RUN,
  requestBudget: 30,
  backfillIntervalMinutes: 5,
  refreshIntervalMinutes: 180,

  async test(secret, _settings, ctx) {
    const currency = await accountCurrency(secret.token, ctx)
    return { accountLabel: currency ? `МойСклад · валюта учёта ${currency}` : 'МойСклад' }
  },

  async sync(secret, _settings, rawCursor, ctx): Promise<SyncResult> {
    const cursor = rawCursor as Cursor
    const facts: FactInput[] = []
    const token = secret.token
    const currency = cursor.currency ?? (await accountCurrency(token, ctx)) ?? 'account_currency'
    const today = dayOf(ctx.now, MSK_OFFSET_MIN)
    let next: Cursor = { ...cursor, currency }

    const window = planDays(cursor, ctx.now, MSK_OFFSET_MIN, maxDaysFor(rawCursor, MAX_DAYS_PER_RUN))
    if (window) {
      const [orders, sales, returns] = [
        await plot(token, ctx, 'orders', window.from, window.to),
        await plot(token, ctx, 'sales', window.from, window.to),
        await salesReturns(token, ctx, window.from, window.to),
      ]
      for (const day of window.days) {
        const o = orders.get(day) ?? { quantity: 0, sum: 0 }
        const s = sales.get(day) ?? { quantity: 0, sum: 0 }
        const r = returns.get(day) ?? { count: 0, sum: 0 }
        const ref = `moysklad:${day}`
        facts.push(
          { metricKey: 'orders_count', periodStart: day, periodEnd: day, value: roundFact('orders_count', o.quantity), unit: COUNT_UNIT, sourceRef: `${ref}:orders/plotseries` },
          { metricKey: 'orders_amount', periodStart: day, periodEnd: day, value: roundFact('orders_amount', kopecks(o.sum)), unit: currency, sourceRef: `${ref}:orders/plotseries` },
          { metricKey: 'sales_count', periodStart: day, periodEnd: day, value: roundFact('sales_count', s.quantity), unit: COUNT_UNIT, sourceRef: `${ref}:sales/plotseries` },
          { metricKey: 'revenue', periodStart: day, periodEnd: day, value: roundFact('revenue', kopecks(s.sum)), unit: currency, sourceRef: `${ref}:sales/plotseries` },
          { metricKey: 'returns_count', periodStart: day, periodEnd: day, value: r.count, unit: COUNT_UNIT, sourceRef: `${ref}:salesreturn` },
          { metricKey: 'returns_amount', periodStart: day, periodEnd: day, value: roundFact('returns_amount', kopecks(r.sum)), unit: currency, sourceRef: `${ref}:salesreturn` },
        )
      }
      next = advanceCursor(next, window)
    }

    if (cursor.snapshot_day !== today) {
      const [skuCount, inStock] = [
        await metaSize(token, ctx, '/entity/product?limit=1'),
        await metaSize(token, ctx, `/report/stock/all?limit=1&filter=${encodeURIComponent('stockMode=positiveOnly')}`),
      ]
      if (skuCount !== null) facts.push({ metricKey: 'sku_count', periodStart: today, periodEnd: today, value: skuCount, unit: COUNT_UNIT, sourceRef: 'moysklad:entity/product' })
      if (inStock !== null) facts.push({ metricKey: 'sku_in_stock', periodStart: today, periodEnd: today, value: inStock, unit: COUNT_UNIT, sourceRef: 'moysklad:report/stock/all' })
      next = { ...next, snapshot_day: today }
    }

    return {
      facts,
      cursor: next as Record<string, unknown>,
      caughtUp: !window || window.refresh,
      accountLabel: currency !== 'account_currency' ? `МойСклад · валюта учёта ${currency}` : undefined,
    }
  },
}
