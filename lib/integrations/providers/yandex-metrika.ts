/**
 * Яндекс Метрика Reports API adapter — «не проверено вживую» until tested with
 * a client's counter.
 *
 * Official documentation (read 2026-10-06, markdown versions listed in
 * https://yandex.ru/dev/metrika/ru/llms.txt):
 *   auth                 https://yandex.ru/dev/metrika/ru/intro/authorization
 *                        «Токен необходимо передавать для каждого метода в HTTP-заголовке Authorization»:
 *                        Authorization: OAuth <token>; token via
 *                        https://oauth.yandex.ru/authorize?response_type=token&client_id=<application_id>
 *   table report         https://yandex.ru/dev/metrika/ru/stat/openapi/data_1
 *                        GET https://api-metrika.yandex.net/stat/v1/data — ids (required), metrics,
 *                        dimensions, date1 / date2 (YYYY-MM-DD), limit, offset, accuracy;
 *                        response data[].dimensions[].name, data[].metrics[], total_rows
 *   sampling             https://yandex.ru/dev/metrika/ru/stat/sampling («full — возвращает все данные»)
 *   metrics              https://yandex.ru/dev/metrika/ru/stat/metrics/visits/basic (ym:s:visits, ym:s:users),
 *                        https://yandex.ru/dev/metrika/ru/stat/metrics/visits/ecommerce (ym:s:ecommercePurchases)
 *   date dimension       https://yandex.ru/dev/metrika/ru/stat/attributes/visitsbehavior_/date_time (ym:s:date)
 *   quotas               https://yandex.ru/dev/metrika/ru/intro/quotas (3 parallel requests per user,
 *                        200 requests / 5 min to /stat/v1/data, 5000 / day; 429 when exceeded)
 *
 * Revenue is NOT fetched: the currency parameter of Metrika accepts RUB / USD /
 * EUR / YND only (https://yandex.ru/dev/metrika/ru/stat/param) — no tenge.
 */
import { COUNT_UNIT, roundFact, type FactInput } from '../facts'
import { num, requestJson } from '../http'
import { addDays, advanceCursor, dayOf, daysBetween, maxDaysFor, planDays, type DayCursor } from '../period'
import type { AdapterContext, ProviderAdapter, SyncResult } from './types'

export const METRIKA_API_BASE = 'https://api-metrika.yandex.net'
const LABEL = 'Яндекс Метрика'
const MAX_DAYS_PER_RUN = 35
const METRICS = ['ym:s:visits', 'ym:s:users', 'ym:s:ecommercePurchases'] as const

interface DataResponse {
  data?: Array<{ dimensions?: Array<{ name?: string }>; metrics?: number[] }>
  total_rows?: number
}

async function data(token: string, counterId: string, params: Record<string, string>, ctx: AdapterContext): Promise<DataResponse> {
  const q = new URLSearchParams({ ids: counterId, ...params })
  const res = await requestJson<DataResponse>(
    { fetch: ctx.fetch, budget: ctx.budget, secrets: ctx.secrets },
    { url: `${METRIKA_API_BASE}/stat/v1/data?${q.toString()}`, headers: { Authorization: `OAuth ${token}` }, label: LABEL },
  )
  return res.data
}

export const yandexMetrikaAdapter: ProviderAdapter = {
  key: 'yandex_metrika',
  maxDaysPerRun: MAX_DAYS_PER_RUN,
  requestBudget: 3,
  backfillIntervalMinutes: 5,
  refreshIntervalMinutes: 360,

  async test(secret, settings, ctx) {
    const day = addDays(dayOf(ctx.now), -1)
    await data(secret.token, settings.counter_id, { metrics: 'ym:s:visits', date1: day, date2: day }, ctx)
    return { accountLabel: `Метрика · счётчик ${settings.counter_id}` }
  },

  async sync(secret, settings, rawCursor, ctx): Promise<SyncResult> {
    const cursor = rawCursor as DayCursor
    const window = planDays(cursor, ctx.now, 0, maxDaysFor(rawCursor, MAX_DAYS_PER_RUN))
    if (!window) return { facts: [], cursor: { ...cursor }, caughtUp: true }
    const res = await data(secret.token, settings.counter_id, {
      metrics: METRICS.join(','),
      dimensions: 'ym:s:date',
      date1: window.from,
      date2: window.to,
      limit: '100',
      accuracy: 'full',
    }, ctx)
    const byDay = new Map<string, number[]>(daysBetween(window.from, window.to).map((d) => [d, [0, 0, 0]]))
    for (const row of res.data ?? []) {
      const day = row.dimensions?.[0]?.name ?? ''
      if (!byDay.has(day)) continue
      byDay.set(day, METRICS.map((_, i) => num(row.metrics?.[i]) ?? 0))
    }
    const facts: FactInput[] = []
    for (const [day, [visits, users, purchases]] of byDay) {
      const ref = `yandex_metrika:${settings.counter_id}:${day}`
      facts.push(
        { metricKey: 'sessions', periodStart: day, periodEnd: day, value: roundFact('sessions', visits), unit: COUNT_UNIT, sourceRef: ref },
        { metricKey: 'users', periodStart: day, periodEnd: day, value: roundFact('users', users), unit: COUNT_UNIT, sourceRef: ref },
        { metricKey: 'web_purchases', periodStart: day, periodEnd: day, value: roundFact('web_purchases', purchases), unit: COUNT_UNIT, sourceRef: ref },
      )
    }
    return { facts, cursor: advanceCursor({ ...cursor }, window) as Record<string, unknown>, caughtUp: window.refresh }
  },
}
