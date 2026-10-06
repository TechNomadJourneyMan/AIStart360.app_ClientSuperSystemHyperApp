// MetricZonesGrid classification + the «Метрики» catalog model.
// Zones come from the catalog `status`; a value without a target is never
// «Зелёная зона», a missing value is always «нет данных».

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { classifyMetric, groupByZone } from '@/components/point-a/v2/metric-zones'
import {
  applyClientFilters,
  buildProvenanceChain,
  countByCategory,
  DEFAULT_CLIENT_FILTERS,
  deltaTone,
  extractCategoryCounts,
  normalizeCatalogItem,
  sourceBucket,
  subcategoryChips,
  targetProgress,
  type CatalogItem,
  type RawCatalogItem,
} from '@/components/metrics/catalog-model'
import { MetricCatalogCard } from '@/components/metrics/MetricCatalogCard'
import { lossPillLabel } from '@/components/point-a/v2/PointAQuickPills'
import { heroDeltaTone, HERO_METRIC_IDS } from '@/components/point-a/v2/KeyMetricsHero'
import { metricsFromEnvelope, buildMetricsQuery } from '@/hooks/useMetrics'

function raw(patch: Partial<RawCatalogItem> & { id: string }): RawCatalogItem {
  return {
    label: patch.id,
    namespace: 'biz',
    department: 'Финансы',
    goalNumber: null,
    unit: '₸',
    formula: null,
    sources: [{ type: 'survey', key: 's9n_revenue_2024', label: 'Выручка 2024' }],
    value: 100,
    confidence: 0.8,
    source: 'survey',
    computedAt: '2026-10-01T00:00:00Z',
    fresh: false,
    ...patch,
  }
}

const item = (patch: Partial<RawCatalogItem> & { id: string }): CatalogItem => normalizeCatalogItem(raw(patch))

// ─── Zone classification ────────────────────────────────────────────────────

describe('MetricZonesGrid — classifyMetric', () => {
  it('maps catalog status to zones', () => {
    expect(classifyMetric({ status: 'on_track', value: 1 })).toEqual({ zone: 'green', reason: null })
    expect(classifyMetric({ status: 'at_risk', value: 1 })).toEqual({ zone: 'yellow', reason: null })
    expect(classifyMetric({ status: 'off_track', value: 1 })).toEqual({ zone: 'red', reason: null })
  })

  it('a value without a target is neutral «нет цели», never green', () => {
    expect(classifyMetric({ status: 'no_target', value: 42 })).toEqual({ zone: 'neutral', reason: 'no_target' })
    // Old API without `status` at all.
    expect(classifyMetric({ value: 42 })).toEqual({ zone: 'neutral', reason: 'no_target' })
  })

  it('a missing value is «нет данных» whatever the status says', () => {
    expect(classifyMetric({ status: 'no_data', value: null })).toEqual({ zone: 'neutral', reason: 'no_data' })
    expect(classifyMetric({ status: 'on_track', value: null })).toEqual({ zone: 'neutral', reason: 'no_data' })
    expect(classifyMetric({ value: '' })).toEqual({ zone: 'neutral', reason: 'no_data' })
  })

  it('groups items and orders red/yellow by progress (worst first)', () => {
    const target = { value: 100, periodLabel: '12m', source: 'owner' as const, direction: 'higher_is_better' as const }
    const groups = groupByZone([
      item({ id: 'a', status: 'off_track', value: 70, target }),
      item({ id: 'b', status: 'off_track', value: 40, target }),
      item({ id: 'c', status: 'at_risk', value: 90, target }),
      item({ id: 'd', status: 'on_track', value: 120, target }),
      item({ id: 'e', status: 'no_target', value: 5 }),
      item({ id: 'f', value: null }),
    ])
    expect(groups.red.map((i) => i.id)).toEqual(['b', 'a'])
    expect(groups.yellow.map((i) => i.id)).toEqual(['c'])
    expect(groups.green.map((i) => i.id)).toEqual(['d'])
    expect(groups.noTarget.map((i) => i.id)).toEqual(['e'])
    expect(groups.noData.map((i) => i.id)).toEqual(['f'])
  })
})

// ─── Catalog model ──────────────────────────────────────────────────────────

describe('catalog model — normalisation', () => {
  it('fills safe defaults when the API has no enrichment yet', () => {
    const it = normalizeCatalogItem(raw({ id: 'biz.finansy.vyruchka_god' }))
    expect(it.category).toBe('finance')
    expect(it.status).toBe('no_target')
    expect(it.trend).toBe('unknown')
    expect(it.target).toBeNull()
    expect(it.lastUpdated).toBe('2026-10-01T00:00:00Z')
    const empty = normalizeCatalogItem(raw({ id: 'x', value: null }))
    expect(empty.status).toBe('no_data')
  })

  it('keeps API enrichment as-is', () => {
    const it = normalizeCatalogItem(
      raw({ id: 'x', category: 'automation', status: 'at_risk', delta: -5, deltaPct: -12.5, period: '2025', provenanceType: 'FACT' }),
    )
    expect(it.category).toBe('automation')
    expect(it.status).toBe('at_risk')
    expect(it.trend).toBe('down')
    expect(it.period).toBe('2025')
  })

  it('reads per-category counts from the response in any supported shape', () => {
    expect(extractCategoryCounts({ categoryCounts: { all: 10, finance: 3 } } as never)).toEqual({ all: 10, finance: 3 })
    expect(extractCategoryCounts({ counts: { all: 10, biz: 4, categories: { sales: 2 } } } as never)).toEqual({ sales: 2, all: 10 })
    expect(extractCategoryCounts({ counts: { all: 5, finance: 5 } } as never)).toEqual({ all: 5, finance: 5 })
    // Namespace-only counts (old API) → null, the UI counts the full list instead.
    expect(extractCategoryCounts({ counts: { all: 5, biz: 5, kpi: 0, gri: 0, goal: 0 } } as never)).toBeNull()
  })

  it('counts by category over the full list', () => {
    expect(countByCategory([item({ id: 'a' }), item({ id: 'b', namespace: 'gri', department: null })])).toEqual({
      all: 2,
      finance: 1,
      gri: 1,
    })
  })

  it('builds growth-goal subcategory chips with goal names', () => {
    const chips = subcategoryChips([
      item({ id: 'g1', namespace: 'goal', department: null, goalNumber: '01' }),
      item({ id: 'g2', namespace: 'goal', department: null, goalNumber: '01' }),
      item({ id: 'g3', namespace: 'goal', department: null, goalNumber: '09' }),
    ])
    expect(chips).toEqual([
      { key: 'goal_01', label: '1. Привлечь новых клиентов', count: 2 },
      { key: 'goal_09', label: '9. Снизить стоимость привлечения (CAC)', count: 1 },
    ])
  })

  it('matches API subcategories by key or by label (items may carry the label)', () => {
    const api = [
      { key: 'goal_01', label: '1. Привлечь новых клиентов' },
      { key: 'goal_10', label: '10. Повысить конверсию в продажи' },
      { key: 'goal_11', label: '11. Сделать так, чтобы выбрали вас, а не конкурента' },
    ]
    const items = [
      item({ id: 'a', namespace: 'goal', department: null, subcategory: '10. Повысить конверсию в продажи' }),
      item({ id: 'b', namespace: 'goal', department: null, subcategory: '1. Привлечь новых клиентов' }),
      item({ id: 'c', namespace: 'goal', department: null, subcategory: '1. Привлечь новых клиентов' }),
    ]
    expect(subcategoryChips(items, api)).toEqual([
      { key: '1. Привлечь новых клиентов', label: '1. Привлечь новых клиентов', count: 2 },
      { key: '10. Повысить конверсию в продажи', label: '10. Повысить конверсию в продажи', count: 1 },
    ])
    // Without API definitions: labels kept, numeric order (10 after 1).
    expect(subcategoryChips(items).map((c) => c.count)).toEqual([2, 1])
    // The chip value filters exactly.
    const filtered = applyClientFilters(items, { ...DEFAULT_CLIENT_FILTERS, subcategory: '1. Привлечь новых клиентов' })
    expect(filtered.map((i) => i.id)).toEqual(['b', 'c'])
  })

  it('applies status / source / confidence / period filters', () => {
    const list = [
      item({ id: 'a', status: 'off_track', source: 'document', confidence: 0.95, period: '2025' }),
      item({ id: 'b', status: 'on_track', source: 'survey', confidence: 0.6, period: null }),
      item({ id: 'c', value: null, source: null, confidence: null }),
    ]
    const f = DEFAULT_CLIENT_FILTERS
    expect(applyClientFilters(list, { ...f, statuses: ['off_track'] }).map((i) => i.id)).toEqual(['a'])
    expect(applyClientFilters(list, { ...f, sources: ['survey'] }).map((i) => i.id)).toEqual(['b'])
    expect(applyClientFilters(list, { ...f, minConfidence: 0.9 }).map((i) => i.id)).toEqual(['a'])
    expect(applyClientFilters(list, { ...f, period: '2025' }).map((i) => i.id)).toEqual(['a'])
    expect(applyClientFilters(list, { ...f, statuses: ['no_data'] }).map((i) => i.id)).toEqual(['c'])
  })

  it('maps metric sources to filter buckets', () => {
    expect(sourceBucket('survey')).toBe('survey')
    expect(sourceBucket('gri_assessment')).toBe('survey')
    expect(sourceBucket('document')).toBe('document')
    expect(sourceBucket('external')).toBe('integration')
    expect(sourceBucket('prisma')).toBe('integration')
    expect(sourceBucket('calculated')).toBe('calculated')
    expect(sourceBucket(null)).toBeNull()
  })

  it('colours deltas by direction (a falling CAC is good)', () => {
    expect(deltaTone(item({ id: 'rev', label: 'Выручка (год)', delta: 10, deltaPct: 5 }))).toBe('good')
    expect(deltaTone(item({ id: 'cac', label: 'CAC', delta: -10, deltaPct: -5 }))).toBe('good')
    expect(deltaTone(item({ id: 'cac2', label: 'CAC', delta: 10, deltaPct: 5 }))).toBe('bad')
    expect(deltaTone(item({ id: 'n', label: 'NPS' }))).toBe('neutral')
  })

  it('computes direction-aware target progress', () => {
    const higher = { value: 200, periodLabel: '12m', source: 'owner' as const, direction: 'higher_is_better' as const }
    const lower = { ...higher, value: 50, direction: 'lower_is_better' as const }
    expect(targetProgress(item({ id: 'a', value: 100, target: higher }))).toBe(0.5)
    expect(targetProgress(item({ id: 'b', value: 100, target: lower }))).toBe(0.5)
    expect(targetProgress(item({ id: 'c', value: null, target: higher }))).toBeNull()
  })

  it('builds the provenance chain source → raw → transformation → metric', () => {
    const chain = buildProvenanceChain(item({ id: 'a', provenanceType: 'FACT' }), (v, u) => `${v} ${u}`)
    expect(chain.map((s) => s.key)).toEqual(['source', 'raw', 'transform', 'metric'])
    expect(chain[0].body).toContain('Выручка 2024')
    expect(chain[0].body).toContain('s9n_revenue_2024')
    expect(chain[3].body).toContain('уверенность 80%')
    const none = buildProvenanceChain(item({ id: 'b', value: null }), (v) => String(v))
    expect(none).toHaveLength(1)
    expect(none[0].muted).toBe(true)
  })
})

// ─── Catalog card ───────────────────────────────────────────────────────────

describe('MetricCatalogCard', () => {
  const NOW = new Date('2026-10-06T12:00:00Z')
  it('renders value, delta, target progress, labelled benchmark, status, source, period, provenance', () => {
    const it = item({
      id: 'biz.finansy.vyruchka_god',
      label: 'Выручка (год)',
      value: 84_200_000,
      status: 'at_risk',
      delta: 4_200_000,
      deltaPct: 5.25,
      target: { value: 110_000_000, periodLabel: '12m', source: 'owner', direction: 'higher_is_better' },
      benchmark: { value: 100_000_000, unit: '₸', label: 'Отраслевой ориентир (экспертная оценка)', kind: 'expert_estimate' },
      period: '2025',
      lastUpdated: '2026-10-06T11:00:00Z',
      provenanceType: 'FACT',
      source: 'document',
    })
    const out = renderToStaticMarkup(createElement(MetricCatalogCard, { item: it, onOpen: () => {}, now: NOW }))
    expect(out).toContain('84.2 млн ₸')
    expect(out).toContain('+5.3%')
    expect(out).toContain('data-delta-tone="good"')
    expect(out).toContain('Цель · 12 мес')
    expect(out).toContain('110.0 млн ₸')
    expect(out).toContain('aria-valuenow="77"')
    expect(out).toContain('Ориентир · экспертная оценка')
    expect(out).toContain('Риск')
    expect(out).toContain('Документ')
    expect(out).toContain('2025')
    expect(out).toContain('1 ч назад')
    expect(out).toContain('data-provenance="FACT"')
    expect(out).toContain('role="button"')
  })

  it('renders an honest empty card when there is no value', () => {
    const out = renderToStaticMarkup(createElement(MetricCatalogCard, { item: item({ id: 'x', value: null }), now: NOW }))
    expect(out).toContain('Нет данных')
    expect(out).toContain('заполните анкету или загрузите документ')
    expect(out).not.toContain('data-delta-tone')
  })
})

// ─── Small fixes ────────────────────────────────────────────────────────────

describe('quick pills / key metrics hero / metrics envelope', () => {
  it('loss pill shows the real count, never a fixed «5 Потерь»', () => {
    expect(lossPillLabel(null)).toBe('Карта потерь')
    expect(lossPillLabel(0)).toBe('Потерь нет')
    expect(lossPillLabel(1)).toBe('1 потеря')
    expect(lossPillLabel(3)).toBe('3 потери')
    expect(lossPillLabel(5)).toBe('5 потерь')
  })

  it('key metrics hero asks /api/v1/metrics for registry ids', () => {
    expect(HERO_METRIC_IDS).toHaveLength(6)
    expect(buildMetricsQuery({ keys: HERO_METRIC_IDS })).toContain('keys=biz.finansy.vyruchka_god%2C')
    expect(heroDeltaTone({ trendDirection: 'down', trend: -4 }, true)).toBe('good')
    expect(heroDeltaTone({ trendDirection: 'up', trend: 4 })).toBe('good')
    expect(heroDeltaTone({ trendDirection: 'flat', trend: 0 })).toBe('neutral')
  })

  it('reads the {source, data} envelope of /api/v1/metrics', () => {
    expect(metricsFromEnvelope({ source: 'empty', data: [] })).toEqual([])
    expect(metricsFromEnvelope(null)).toEqual([])
    const m = { id: 'biz.finansy.vyruchka_god', rawValue: 1 }
    expect(metricsFromEnvelope({ source: 'db', data: [m] })).toEqual([m])
  })
})
