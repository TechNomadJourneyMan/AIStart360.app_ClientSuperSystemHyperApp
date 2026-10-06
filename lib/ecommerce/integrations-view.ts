/**
 * View model of the integration blocks of /client/dashboard-ecommerce, built
 * from GET /api/integrations/snapshot:
 *   • metrics — the materialised values of the integration-fed metrics
 *     (public.metrics through lib/metrics/company-metrics.ts, the single
 *     source the Metrics page, Point A and the dashboard heroes read);
 *   • providers — the per-provider 30-day summary computed by the same module
 *     that feeds those metrics (lib/integrations/signals.ts).
 * Nothing is invented: no connection → state 'none' and the blocks say
 * «нет подключения» with a link to Settings › Интеграции.
 *
 * Pure module (no React, no I/O).
 */

export const INTEGRATIONS_SETTINGS_HREF = '/settings?tab=integrations'

export const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  moysklad: 'МойСклад',
  kaspi: 'Kaspi Магазин',
  wildberries: 'Wildberries',
  ozon: 'Ozon',
  ga4: 'Google Analytics 4',
  yandex_metrika: 'Яндекс Метрика',
  shopify: 'Shopify',
  insales: 'InSales',
  tilda: 'Tilda',
  bitrix_shop: '1С-Битрикс',
  meta_ads: 'Meta Ads',
  yandex_direct: 'Яндекс Директ',
  google_ads: 'Google Ads',
}

const MARKETPLACES = new Set(['kaspi', 'wildberries', 'ozon', 'moysklad', 'shopify', 'insales', 'tilda', 'bitrix_shop'])
const ANALYTICS = new Set(['ga4', 'yandex_metrika'])

/** Metric ids fed by integrations («integration:…» sources in lib/metrics/descriptions.ts). */
export const ECOM_METRIC_IDS = {
  sessions: 'biz.marketing.posescheniy_sayta_mes',
  aov: 'biz.prodazhi.ecommerce_sredniy_chek',
  sku: 'biz.operatsii.kol_vo_sku',
  skuInStock: 'biz.produkt.aktivnykh_sku',
  returnsRate: 'biz.operatsii.brak_vozvraty',
} as const

export interface SnapshotConnection {
  provider: string
  status: string
  authKind: string
  accountLabel: string | null
  lastSyncAt: string | null
  lastError: string | null
}

interface Money { value: number; unit: string | null }

export interface SnapshotProvider {
  provider: string
  periodStart: string | null
  periodEnd: string | null
  fetchedAt: string | null
  totals: Partial<Record<string, Money>>
  snapshots: Partial<Record<string, { value: number; day: string }>>
  returnsRatePct: number | null
  averageOrder: Money | null
  filling: boolean
}

export interface SnapshotMetric {
  metricId: string
  value: number
  unit: string
  source: string | null
  computedAt: string | null
  provenance: unknown
}

export interface IntegrationsSnapshot {
  connections: SnapshotConnection[]
  providers: SnapshotProvider[]
  metrics: Record<string, SnapshotMetric>
  generatedAt: string
}

export interface MetricTile {
  value: number
  unit: string
  /** 'external' = from a connected integration; other sources (survey, document …) as stored. */
  source: string | null
  /** «Kaspi Магазин · 06.09 — 05.10» when the value came from an integration. */
  basis: string | null
}

export interface ProviderRow {
  provider: string
  label: string
  status: string
  file: boolean
  lastSyncAt: string | null
  lastError: string | null
  period: string | null
  orders: number | null
  ordersAmount: Money | null
  revenue: Money | null
  sales: number | null
  returns: number | null
  returnsRatePct: number | null
  averageOrder: Money | null
  payout: Money | null
  sessions: number | null
  users: number | null
  purchases: number | null
  sku: number | null
  skuInStock: number | null
  /** Connected, history still filling (no complete 30-day window yet). */
  filling: boolean
}

export interface IntegrationsView {
  /** 'none' — nothing connected; 'connected' — at least one active connection. */
  state: 'none' | 'connected'
  marketplaces: ProviderRow[]
  analytics: ProviderRow[]
  metrics: Partial<Record<keyof typeof ECOM_METRIC_IDS, MetricTile>>
}

function shortDate(day: string | null): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`
}

function externalBasis(provenance: unknown): string | null {
  const ext = (provenance as { external?: { provider?: unknown; period_start?: unknown; period_end?: unknown } } | null)?.external
  if (!ext || typeof ext.provider !== 'string') return null
  const label = PROVIDER_LABELS[ext.provider] ?? ext.provider
  const from = shortDate(typeof ext.period_start === 'string' ? ext.period_start : null)
  const to = shortDate(typeof ext.period_end === 'string' ? ext.period_end : null)
  if (from && to && from !== to) return `${label} · ${from} — ${to}`
  return from ? `${label} · на ${from}` : label
}

export function buildIntegrationsView(snapshot: IntegrationsSnapshot | null | undefined): IntegrationsView {
  const connections = (snapshot?.connections ?? []).filter((c) => c.status !== 'disconnected')
  const summaries = new Map((snapshot?.providers ?? []).map((p) => [p.provider, p]))

  const rows: ProviderRow[] = connections.map((c) => {
    const s = summaries.get(c.provider)
    const t = s?.totals ?? {}
    const from = shortDate(s?.periodStart ?? null)
    const to = shortDate(s?.periodEnd ?? null)
    return {
      provider: c.provider,
      label: PROVIDER_LABELS[c.provider] ?? c.provider,
      status: c.status,
      file: c.authKind === 'file',
      lastSyncAt: c.lastSyncAt,
      lastError: c.lastError,
      period: from && to ? `${from} — ${to}` : null,
      orders: t.orders_count?.value ?? null,
      ordersAmount: t.orders_amount ?? null,
      revenue: t.revenue ?? null,
      sales: t.sales_count?.value ?? null,
      returns: t.returns_count?.value ?? null,
      returnsRatePct: s?.returnsRatePct ?? null,
      averageOrder: s?.averageOrder ?? null,
      payout: t.payout ?? null,
      sessions: t.sessions?.value ?? null,
      users: t.users?.value ?? null,
      purchases: t.web_purchases?.value ?? null,
      sku: s?.snapshots.sku_count?.value ?? null,
      skuInStock: s?.snapshots.sku_in_stock?.value ?? null,
      filling: c.authKind !== 'file' && (!s || (!s.periodStart && Object.keys(s.snapshots).length === 0)),
    }
  })

  const metrics: IntegrationsView['metrics'] = {}
  for (const [key, id] of Object.entries(ECOM_METRIC_IDS) as Array<[keyof typeof ECOM_METRIC_IDS, string]>) {
    const m = snapshot?.metrics?.[id]
    if (!m || !Number.isFinite(m.value)) continue
    metrics[key] = { value: m.value, unit: m.unit, source: m.source, basis: m.source === 'external' ? externalBasis(m.provenance) : null }
  }

  return {
    state: rows.length ? 'connected' : 'none',
    marketplaces: rows.filter((r) => MARKETPLACES.has(r.provider)),
    analytics: rows.filter((r) => ANALYTICS.has(r.provider)),
    metrics,
  }
}

/** Money with its unit as the provider gave it (KZT → ₸; WB «валюта кабинета»). */
export function moneyLabel(m: Money | null, format: (n: number) => string): string | null {
  if (!m) return null
  if (m.unit === 'KZT' || m.unit === '₸') return format(m.value)
  const n = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(m.value)
  if (m.unit === 'seller_currency') return `${n} (в валюте кабинета)`
  if (m.unit && /^[A-Z]{3}$/.test(m.unit)) return `${n} ${m.unit}`
  return n
}
