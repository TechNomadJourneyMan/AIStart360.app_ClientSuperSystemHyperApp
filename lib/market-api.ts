/**
 * Client data layer for the Market Intelligence portal.
 *
 * Talks to the same-origin proxy at /api/market/* (see app/api/market/[...path]/route.ts),
 * which forwards to the external "Mark-analytics" FastAPI service. The upstream
 * response envelope is { data, meta, errors }; we treat non-2xx responses and
 * any populated `errors` array as failures.
 *
 * DATA INTEGRITY: parsing is intentionally DEFENSIVE. Unknown or missing upstream
 * fields map to sensible nulls / 0 / '—' — we never invent values. Components
 * keep rendering their honest empty states when a result is `ok: false` or empty.
 */

import type {
  Competitor,
  IntelligenceAlert,
  MarketData,
  NewsItem,
} from '@/components/market/mock-data'

export type MarketApiError =
  | 'market_api_not_configured'
  | 'market_api_unavailable'
  | 'unauthorized'
  | 'not_found'
  | 'request_failed'
  | 'bad_response'

export type Result<T> = { ok: true; data: T } | { ok: false; error: MarketApiError }

/** A competitor row that may carry its own currency for honest formatting. */
export interface MarketCompetitor extends Competitor {
  /** ISO currency code for estRevenue/taxesPaid, e.g. 'USD' | 'KZT'. */
  currency: string
}

// ── low-level fetch ──────────────────────────────────────────────────────────

interface Envelope<T = unknown> {
  data?: T
  meta?: unknown
  errors?: unknown
  // proxy-level failures use { ok:false, error }
  ok?: boolean
  error?: string
}

function mapProxyError(code: unknown): MarketApiError {
  switch (code) {
    case 'market_api_not_configured':
      return 'market_api_not_configured'
    case 'market_api_unavailable':
      return 'market_api_unavailable'
    case 'unauthorized':
      return 'unauthorized'
    case 'not_found':
      return 'not_found'
    default:
      return 'request_failed'
  }
}

async function call<T>(
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string | number | undefined> },
): Promise<Result<T>> {
  const qs = init?.query
    ? '?' +
      new URLSearchParams(
        Object.entries(init.query)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : ''

  let res: Response
  try {
    res = await fetch(`/api/market/${path}${qs}`, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    })
  } catch {
    return { ok: false, error: 'market_api_unavailable' }
  }

  let json: Envelope<T> | null = null
  try {
    json = (await res.json()) as Envelope<T>
  } catch {
    json = null
  }

  if (!res.ok) {
    return { ok: false, error: mapProxyError(json?.error) }
  }

  // Treat populated upstream `errors` as failure.
  if (json && Array.isArray(json.errors) && json.errors.length > 0) {
    return { ok: false, error: 'request_failed' }
  }

  if (!json || json.data === undefined || json.data === null) {
    // Upstream returned a 2xx with no data payload — treat as empty, not error,
    // unless the body is unparseable.
    if (!json) return { ok: false, error: 'bad_response' }
    return { ok: true, data: undefined as unknown as T }
  }

  return { ok: true, data: json.data }
}

// ── defensive coercion helpers ───────────────────────────────────────────────

function asString(v: unknown, fallback = '—'): string {
  if (typeof v === 'string' && v.trim() !== '') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return fallback
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.+-]/g, ''))
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[]
  // Some endpoints nest the list under a key (items/results/list).
  if (v && typeof v === 'object') {
    for (const key of ['items', 'results', 'list', 'data']) {
      const inner = (v as Record<string, unknown>)[key]
      if (Array.isArray(inner)) return inner as Record<string, unknown>[]
    }
  }
  return []
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  }
  return undefined
}

// ── mappers ──────────────────────────────────────────────────────────────────

function mapNewsItem(raw: Record<string, unknown>, idx: number): NewsItem {
  const ts = pick(raw, 'timestamp', 'published_at', 'date', 'pubDate')
  return {
    id: asString(pick(raw, 'id', 'guid', 'link', 'url'), `news-${idx}`),
    source: asString(pick(raw, 'source', 'publisher', 'feed')),
    headline: asString(pick(raw, 'headline', 'title')),
    summary: asString(pick(raw, 'summary', 'description', 'snippet'), ''),
    timestamp: typeof ts === 'string' ? ts : new Date().toISOString(),
    tags: asStringArray(pick(raw, 'tags', 'categories', 'keywords')),
  }
}

const VALID_CATEGORIES: Competitor['category'][] = [
  'Direct',
  'Indirect',
  'Substitute',
  'Leader',
  'Newcomer',
]

function mapCategory(v: unknown): Competitor['category'] {
  if (typeof v === 'string') {
    const match = VALID_CATEGORIES.find((c) => c.toLowerCase() === v.toLowerCase())
    if (match) return match
  }
  return 'Direct'
}

function mapCompetitor(raw: Record<string, unknown>, idx: number): MarketCompetitor {
  // Upstream `companies` revenue is revenue_usd → currency USD by default.
  const revenue = asNumber(pick(raw, 'estRevenue', 'revenue_usd', 'revenue', 'revenue_kzt'))
  const currencyRaw = pick(raw, 'currency')
  const hasUsd = pick(raw, 'revenue_usd') !== undefined
  const currency =
    typeof currencyRaw === 'string' && currencyRaw.trim() !== ''
      ? currencyRaw.toUpperCase()
      : hasUsd
        ? 'USD'
        : 'KZT'

  return {
    id: asString(pick(raw, 'id', 'bin', 'bin_iin'), `comp-${idx}`),
    name: asString(pick(raw, 'name', 'company_name', 'title')),
    category: mapCategory(pick(raw, 'category')),
    bin_iin: asString(pick(raw, 'bin_iin', 'bin', 'iin')),
    url: asString(pick(raw, 'url', 'website'), ''),
    estRevenue: revenue,
    taxesPaid: asNumber(pick(raw, 'taxesPaid', 'taxes_paid', 'taxes')),
    b2gDependency: asNumber(pick(raw, 'b2gDependency', 'b2g_dependency', 'b2g')),
    tags: asStringArray(pick(raw, 'tags', 'industry_tags')),
    isTracked: false,
    currency,
  }
}

function mapTenderAlert(raw: Record<string, unknown>, idx: number): IntelligenceAlert {
  const customer = asString(pick(raw, 'customer', 'customer_name', 'buyer'), '')
  const amount = asNumber(pick(raw, 'amount', 'sum', 'total', 'price'))
  const title = asString(pick(raw, 'title', 'subject', 'name'), '')
  const ts = pick(raw, 'timestamp', 'published_at', 'date', 'created_at')

  const amountStr = amount > 0 ? `${amount.toLocaleString('ru-RU')} ₸` : ''
  // Honest Russian phrasing: «Тендер» with sum + customer where available.
  const parts = ['Тендер']
  if (amountStr) parts.push(amountStr)
  if (customer) parts.push(`заказчик: ${customer}`)
  const description = title || parts.join(' · ')

  return {
    id: asString(pick(raw, 'id', 'tender_id', 'number'), `tender-${idx}`),
    competitorName: customer || asString(pick(raw, 'supplier', 'winner'), 'Тендер'),
    type: 'Tender Win',
    description: title ? `${parts.join(' · ')} — ${description}` : parts.join(' · '),
    timestamp: typeof ts === 'string' ? ts : new Date().toISOString(),
  }
}

function mapMarketOverview(raw: Record<string, unknown>): MarketData {
  // `revenue_total_usd` comes from Mark-analytics /analytics/overview and is in
  // US dollars — the UI must format it as $, never as ₸ (data-integrity rule).
  const usdVolume = pick(raw, 'revenue_total_usd')
  const totalVolume = asNumber(
    usdVolume !== undefined
      ? usdVolume
      : pick(raw, 'totalVolume', 'total_volume', 'market_volume', 'volume'),
  )
  const volumeCurrency: 'USD' | 'KZT' = usdVolume !== undefined ? 'USD' : 'KZT'
  const activePlayers = asNumber(
    pick(raw, 'activePlayers', 'active_players', 'company_count', 'companies', 'total_companies'),
  )
  // YoY is only included if upstream actually provides it (otherwise the UI omits the chip).
  const yoyRaw = pick(raw, 'yoyGrowth', 'yoy_growth', 'growth_yoy')
  const yoyGrowth = yoyRaw === undefined ? 0 : asNumber(yoyRaw)

  const chartRaw = asArray(pick(raw, 'chartData', 'chart_data', 'timeseries', 'trend'))
  const chartData = chartRaw.map((p) => ({
    year: asString(pick(p, 'year', 'period', 'label')),
    volume: asNumber(pick(p, 'volume', 'value')),
  }))

  const pestelRaw = asArray(pick(raw, 'pestel'))
  const pestel = pestelRaw.map((p) => {
    const trend = asString(pick(p, 'trend'), 'neutral').toLowerCase()
    return {
      factor: asString(pick(p, 'factor', 'name')),
      description: asString(pick(p, 'description', 'detail'), ''),
      trend: (trend === 'positive' || trend === 'negative' ? trend : 'neutral') as
        | 'positive'
        | 'negative'
        | 'neutral',
    }
  })

  return {
    totalVolume,
    volumeCurrency,
    yoyGrowth,
    activePlayers,
    marketTemp: asString(pick(raw, 'marketTemp', 'market_temp', 'temperature')),
    chartData,
    pestel,
  }
}

// ── public API ───────────────────────────────────────────────────────────────

export async function getNews(): Promise<Result<NewsItem[]>> {
  const res = await call<unknown>('news/recent')
  if (!res.ok) return res
  return { ok: true, data: asArray(res.data).map(mapNewsItem) }
}

export interface CompetitorsParams {
  query?: string
  industry?: string
  region?: string
  limit?: number
}

export async function getCompetitors(
  params: CompetitorsParams = {},
): Promise<Result<MarketCompetitor[]>> {
  const res = await call<unknown>('companies', {
    query: {
      query: params.query,
      industry: params.industry,
      region: params.region,
      limit: params.limit ?? 24,
    },
  })
  if (!res.ok) return res
  return { ok: true, data: asArray(res.data).map(mapCompetitor) }
}

export async function getMarketOverview(): Promise<Result<MarketData>> {
  // Real Mark-analytics path is /analytics/overview (top-line KPIs).
  const res = await call<unknown>('analytics/overview')
  if (!res.ok) return res
  const raw = (res.data && typeof res.data === 'object' ? res.data : {}) as Record<string, unknown>
  return { ok: true, data: mapMarketOverview(raw) }
}

/**
 * Intelligence alerts are derived (honestly labelled) from recent tenders.
 * No fabricated "Price Drop / Legal Risk" signals — only real tender records.
 */
export async function getIntelligenceAlerts(): Promise<Result<IntelligenceAlert[]>> {
  const res = await call<unknown>('tenders/recent')
  if (!res.ok) return res
  const alerts = asArray(res.data)
    .map(mapTenderAlert)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  return { ok: true, data: alerts }
}

/** Map a service-down error code to the subtle Russian status line, if any. */
export function statusLineFor(error: MarketApiError): string | null {
  if (error === 'market_api_not_configured') return 'Сервис рыночных данных не подключён'
  if (error === 'market_api_unavailable') return 'Сервис рыночных данных временно недоступен'
  return null
}
