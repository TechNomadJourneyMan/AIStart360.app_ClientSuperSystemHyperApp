/**
 * Integration facts → signals → metrics (W7):
 *   • a flow signal needs a complete 30-day window (no partial sums), stale
 *     providers give nothing, providers are never summed (priority instead);
 *   • ₸ metrics take only KZT money; snapshots expire after 7 days;
 *   • the resolver: a connected integration beats the survey (and a formula
 *     from it) but stays below a document (and manual / assessment); the value
 *     lands in public.metrics with source 'external' and provenance.external
 *     {provider, period, fetched_at};
 *   • the dashboard summary uses the same window as the metric (identical numbers).
 */
import { describe, expect, it } from 'vitest'
import { buildIntegrationSignals, INTEGRATION_SYSTEMS, summarizeProviders, type FactLike } from '@/lib/integrations/signals'
import { addDays } from '@/lib/integrations/period'
import { resolveMetric } from '@/lib/metrics/resolver'
import { toMaterializedRow } from '@/lib/metrics/materialize'
import { companyMetricsFromValues } from '@/lib/metrics/company-metrics'
import type { ResolverContext } from '@/lib/metrics/types'
import { buildIntegrationsView, ECOM_METRIC_IDS } from '@/lib/ecommerce/integrations-view'

const NOW = new Date('2026-10-06T10:00:00Z')
const FETCHED = '2026-10-06T09:00:00.000Z'

function daily(provider: string, key: string, days: number, value: number | ((i: number) => number), unit = 'count', end = '2026-10-05'): FactLike[] {
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(end, -i)
    return { provider, metric_key: key, period_start: day, period_end: day, value: typeof value === 'function' ? value(i) : value, unit, fetched_at: FETCHED }
  })
}

function ctx(signals: Record<string, unknown>, extra: Partial<ResolverContext> = {}): ResolverContext {
  return { companyId: 'co', userId: 'u', surveyAnswers: {}, documents: [], externalSignals: signals, now: NOW, ...extra }
}

describe('integration signals', () => {
  it('sessions: GA4 first, Метрика as fallback; never summed; 30-day complete window only', () => {
    const facts = [...daily('ga4', 'sessions', 30, 100), ...daily('yandex_metrika', 'sessions', 30, 70)]
    const s = buildIntegrationSignals(facts, NOW)[INTEGRATION_SYSTEMS.sessions_month]
    expect(s).toMatchObject({ value: 3000, provider: 'ga4', period_start: '2026-09-06', period_end: '2026-10-05', days: 30, fetched_at: FETCHED })

    const gap = daily('ga4', 'sessions', 30, 100).filter((f) => f.period_start !== '2026-09-20')
    const fallback = buildIntegrationSignals([...gap, ...daily('yandex_metrika', 'sessions', 30, 70)], NOW)[INTEGRATION_SYSTEMS.sessions_month]
    expect(fallback).toMatchObject({ value: 2100, provider: 'yandex_metrika' })

    expect(buildIntegrationSignals(daily('ga4', 'sessions', 29, 100), NOW)[INTEGRATION_SYSTEMS.sessions_month]).toBeUndefined()
    // Stale: the newest day is 10 days old.
    expect(buildIntegrationSignals(daily('ga4', 'sessions', 30, 100, 'count', '2026-09-26'), NOW)[INTEGRATION_SYSTEMS.sessions_month]).toBeUndefined()
  })

  it('AOV only from KZT money; Wildberries (seller currency) never feeds it', () => {
    const wb = [...daily('wildberries', 'revenue', 30, 1000, 'seller_currency'), ...daily('wildberries', 'sales_count', 30, 2)]
    expect(buildIntegrationSignals(wb, NOW)[INTEGRATION_SYSTEMS.aov]).toBeUndefined()
    const kaspi = [...daily('kaspi', 'revenue', 30, 30000, 'KZT'), ...daily('kaspi', 'sales_count', 30, 3)]
    expect(buildIntegrationSignals([...wb, ...kaspi], NOW)[INTEGRATION_SYSTEMS.aov]).toMatchObject({ value: 10000, unit: 'KZT', provider: 'kaspi' })
  })

  it('returns rate and SKU snapshots', () => {
    const facts = [
      ...daily('wildberries', 'returns_count', 30, 1), ...daily('wildberries', 'sales_count', 30, 10),
      { provider: 'moysklad', metric_key: 'sku_count', period_start: '2026-10-06', period_end: '2026-10-06', value: 412, unit: 'count', fetched_at: FETCHED },
      { provider: 'moysklad', metric_key: 'sku_in_stock', period_start: '2026-09-20', period_end: '2026-09-20', value: 380, unit: 'count', fetched_at: FETCHED },
    ]
    const s = buildIntegrationSignals(facts, NOW)
    expect(s[INTEGRATION_SYSTEMS.returns_rate]).toMatchObject({ value: 10, unit: '%', provider: 'wildberries' })
    expect(s[INTEGRATION_SYSTEMS.sku_count]).toMatchObject({ value: 412, period_start: '2026-10-06' })
    expect(s[INTEGRATION_SYSTEMS.sku_in_stock]).toBeUndefined() // older than 7 days
  })
})

describe('integration signals in the resolver', () => {
  const facts = [...daily('ga4', 'sessions', 30, 100), ...daily('kaspi', 'revenue', 30, 30000, 'KZT'), ...daily('kaspi', 'sales_count', 30, 3)]
  const signals = buildIntegrationSignals(facts, NOW)

  it('visits per month: hit with provenance.external; source label external', () => {
    const v = resolveMetric(ECOM_METRIC_IDS.sessions, ctx(signals))
    expect(v.numeric).toBe(3000)
    expect(v.picked).toMatchObject({ type: 'external', system: 'integration:sessions_month' })
    const row = toMaterializedRow(v, 'co')
    expect(row.source).toBe('external')
    expect((row.provenance as { external: unknown }).external).toEqual({
      provider: 'ga4', period_start: '2026-09-06', period_end: '2026-10-05', fetched_at: FETCHED, days: 30, basis: 'визиты за 30 дней',
    })
  })

  it('beats the survey answer, loses to a document the owner uploaded', () => {
    const survey = { s3_product_count: 999 }
    const sku = [{ provider: 'moysklad', metric_key: 'sku_count', period_start: '2026-10-06', period_end: '2026-10-06', value: 412, unit: 'count', fetched_at: FETCHED }]
    const skuSignals = buildIntegrationSignals(sku, NOW)
    expect(resolveMetric(ECOM_METRIC_IDS.sku, ctx(skuSignals, { surveyAnswers: survey })).numeric).toBe(412)
    const doc = {
      id: 'd1', docType: 'inventory_csv', periodYear: null, periodQuarter: null, uploadedAt: '2026-10-01T00:00:00Z',
      parsedData: { fields: [{ key: 'sku_count', label: 'Количество SKU', value: 450 }] },
    }
    expect(resolveMetric(ECOM_METRIC_IDS.sku, ctx(skuSignals, { surveyAnswers: survey, documents: [doc] })).numeric).toBe(450)
  })

  it('a ₸ metric refuses a non-KZT signal', () => {
    const bad = { [INTEGRATION_SYSTEMS.aov]: { ...signals[INTEGRATION_SYSTEMS.aov], unit: 'RUB' } }
    const v = resolveMetric(ECOM_METRIC_IDS.aov, ctx(bad))
    expect(v.picked).toBeNull()
    expect(resolveMetric(ECOM_METRIC_IDS.aov, ctx(signals)).numeric).toBe(10000)
  })

  it('the dashboard view shows the same numbers as the materialised metrics', () => {
    const values = Object.values(ECOM_METRIC_IDS).map((id) => resolveMetric(id, ctx(signals)))
    const metrics = Object.fromEntries(companyMetricsFromValues(values, 'co'))
    const view = buildIntegrationsView({
      connections: [
        { provider: 'kaspi', status: 'connected', authKind: 'token', accountLabel: 'Kaspi Магазин', lastSyncAt: FETCHED, lastError: null },
        { provider: 'ga4', status: 'connected', authKind: 'token', accountLabel: null, lastSyncAt: FETCHED, lastError: null },
      ],
      providers: summarizeProviders(facts, NOW),
      metrics,
      generatedAt: NOW.toISOString(),
    })
    expect(view.state).toBe('connected')
    expect(view.metrics.sessions).toMatchObject({ value: 3000, source: 'external', basis: 'Google Analytics 4 · 06.09 — 05.10' })
    expect(view.metrics.aov?.value).toBe(10000)
    const kaspi = view.marketplaces.find((r) => r.provider === 'kaspi')!
    expect(kaspi.averageOrder).toEqual({ value: metrics[ECOM_METRIC_IDS.aov].value, unit: 'KZT' })
    expect(view.analytics.find((r) => r.provider === 'ga4')?.sessions).toBe(metrics[ECOM_METRIC_IDS.sessions].value)
  })

  it('no connection → state none', () => {
    expect(buildIntegrationsView(null)).toMatchObject({ state: 'none', marketplaces: [], analytics: [], metrics: {} })
  })
})
