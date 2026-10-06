/**
 * Shopify GraphQL Admin API adapter (existing admin-created custom app token)
 * — «не проверено вживую» until tested with a store.
 *
 * Official documentation (read 2026-10-06):
 *   token / header       https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin
 *                        POST https://{shop}.myshopify.com/admin/api/2026-10/graphql.json,
 *                        header X-Shopify-Access-Token. «You can no longer create new admin-created
 *                        custom apps. Existing apps are unaffected and continue to work.»
 *   ordersCount          https://shopify.dev/docs/api/admin-graphql/latest/queries/ordersCount
 *                        args query (created_at filter), limit (null = no limit); returns count + precision
 *   orders               https://shopify.dev/docs/api/admin-graphql/latest/queries/orders
 *                        orders(first, after, query) { nodes / edges, pageInfo { hasNextPage endCursor } },
 *                        totalPriceSet { shopMoney { amount currencyCode } }
 *   errors / limits      https://shopify.dev/docs/api/admin-graphql (HTTP 200 with errors[].extensions.code:
 *                        THROTTLED «Similar to 429», ACCESS_DENIED «Similar to 401»),
 *                        https://shopify.dev/docs/api/usage/limits (leaky bucket, calculated query cost)
 *
 * New stores need the authorization code grant of a Shopify app the platform
 * does not have — that path is BLOCKED (docs/platform/06-integrations.md).
 * Days are UTC.
 */
import { COUNT_UNIT, roundFact, type FactInput } from '../facts'
import { IntegrationError, num, requestJson } from '../http'
import { addDays, advanceCursor, maxDaysFor, planDays, type DayCursor } from '../period'
import type { AdapterContext, ProviderAdapter, SyncResult } from './types'

export const SHOPIFY_API_VERSION = '2026-10'
const LABEL = 'Shopify'
const MAX_DAYS_PER_RUN = 7
const PAGE = 250
const MAX_PAGES_PER_DAY = 4

interface GqlResponse<T> {
  data?: T
  errors?: Array<{ message?: string; extensions?: { code?: string } }>
}

async function gql<T>(shop: string, token: string, query: string, variables: Record<string, unknown>, ctx: AdapterContext): Promise<T> {
  const res = await requestJson<GqlResponse<T>>(
    { fetch: ctx.fetch, budget: ctx.budget, secrets: ctx.secrets },
    {
      url: `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
      label: LABEL,
    },
  )
  const errors = res.data.errors ?? []
  if (errors.length) {
    const code = errors[0]?.extensions?.code ?? ''
    if (code === 'THROTTLED') throw new IntegrationError('rate_limit', `${LABEL}: превышен лимит запросов (THROTTLED)`, 200, 60_000)
    if (code === 'ACCESS_DENIED') throw new IntegrationError('auth', `${LABEL}: токен не принят (ACCESS_DENIED) — нужно переподключить`, 200)
    if (code === 'INTERNAL_SERVER_ERROR') throw new IntegrationError('transient', `${LABEL}: внутренняя ошибка Shopify`, 200)
    throw new IntegrationError('config', `${LABEL}: запрос отклонён${code ? ` (${code})` : ''}`, 200)
  }
  if (!res.data.data) throw new IntegrationError('permanent', `${LABEL}: пустой ответ`)
  return res.data.data
}

const SHOP_QUERY = 'query { shop { name currencyCode } }'
const COUNT_QUERY = 'query($q: String!) { ordersCount(query: $q, limit: null) { count precision } }'
const ORDERS_QUERY = `query($q: String!, $after: String) { orders(first: ${PAGE}, after: $after, query: $q) { nodes { totalPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage endCursor } } }`

function dayQuery(day: string): string {
  return `created_at:>='${day}T00:00:00Z' created_at:<'${addDays(day, 1)}T00:00:00Z'`
}

interface OrdersPage {
  orders?: { nodes?: Array<{ totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } } }>; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } }
}

export const shopifyAdapter: ProviderAdapter = {
  key: 'shopify',
  maxDaysPerRun: MAX_DAYS_PER_RUN,
  requestBudget: 40,
  backfillIntervalMinutes: 5,
  refreshIntervalMinutes: 180,

  async test(secret, settings, ctx) {
    const data = await gql<{ shop?: { name?: string } }>(settings.shop_domain, secret.token, SHOP_QUERY, {}, ctx)
    return { accountLabel: data.shop?.name ? `Shopify · ${data.shop.name}` : 'Shopify' }
  },

  async sync(secret, settings, rawCursor, ctx): Promise<SyncResult> {
    const cursor = rawCursor as DayCursor
    const window = planDays(cursor, ctx.now, 0, maxDaysFor(rawCursor, MAX_DAYS_PER_RUN))
    if (!window) return { facts: [], cursor: { ...cursor }, caughtUp: true }
    const shop = settings.shop_domain
    const facts: FactInput[] = []
    for (const day of window.days) {
      const q = dayQuery(day)
      const count = await gql<{ ordersCount?: { count?: number; precision?: string } }>(shop, secret.token, COUNT_QUERY, { q }, ctx)
      const n = num(count.ordersCount?.count)
      if (n === null) throw new IntegrationError('permanent', `${LABEL}: ordersCount без значения`)
      facts.push({ metricKey: 'orders_count', periodStart: day, periodEnd: day, value: n, unit: COUNT_UNIT, sourceRef: `shopify:${day}:ordersCount` })

      // Sum of orders: bounded paging; a day with more orders than the bound
      // gets no amount fact (never a partial sum).
      let amount = 0
      let currency: string | null = null
      let after: string | null = null
      let complete = n === 0
      for (let p = 0; p < MAX_PAGES_PER_DAY && !complete; p++) {
        const page: OrdersPage = await gql<OrdersPage>(shop, secret.token, ORDERS_QUERY, { q, after }, ctx)
        for (const node of page.orders?.nodes ?? []) {
          amount += num(node.totalPriceSet?.shopMoney?.amount) ?? 0
          currency ??= node.totalPriceSet?.shopMoney?.currencyCode ?? null
        }
        if (!page.orders?.pageInfo?.hasNextPage) complete = true
        after = page.orders?.pageInfo?.endCursor ?? null
        if (!after) complete = true
      }
      if (complete && (n === 0 || currency)) {
        facts.push({ metricKey: 'orders_amount', periodStart: day, periodEnd: day, value: roundFact('orders_amount', amount), unit: currency ?? 'shop_currency', sourceRef: `shopify:${day}:orders` })
      }
    }
    return { facts, cursor: advanceCursor({ ...cursor }, window) as Record<string, unknown>, caughtUp: window.refresh }
  },
}
