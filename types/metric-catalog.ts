/**
 * Metric taxonomy and the enriched catalog item returned by
 * GET /api/v1/metrics/catalog (level 2 of Point A, the «Метрики» section).
 *
 * Categories are a presentation layer over the code registry
 * (lib/metrics/registry.ts); lib/metrics/taxonomy.ts maps every metric id to
 * exactly one category.
 */

export type MetricCategoryKey =
  | 'finance'        // Финансы
  | 'sales'          // Продажи
  | 'marketing'      // Маркетинг
  | 'customers'      // Клиенты
  | 'operations'     // Операции
  | 'team'           // Команда и HR
  | 'product'        // Продукт
  | 'automation'     // Автоматизация
  | 'ai_maturity'    // AI-зрелость
  | 'digital'        // Digital-зрелость
  | 'management'     // Управление
  | 'growth_goals'   // Цели роста (11 целей из Metrics.docx)
  | 'gri'            // GRI (индекс готовности к росту)

export interface MetricCategory {
  key: MetricCategoryKey
  label: string                  // Russian
  description: string
  subcategories?: Array<{ key: string; label: string }>
  /** Set when the category has no metrics yet and why (shown instead of an empty grid). */
  emptyReason?: string
}

/** Status of a metric against its target (or plausibility when no target). */
export type MetricStatus = 'on_track' | 'at_risk' | 'off_track' | 'no_target' | 'no_data'

export type MetricTrend = 'up' | 'down' | 'flat' | 'unknown'

export interface MetricBenchmark {
  value: number
  unit: string
  /** Where the benchmark comes from, shown to the user. */
  label: string                  // e.g. «Отраслевой ориентир (экспертная оценка)»
  kind: 'expert_estimate' | 'industry_report' | 'peer_group'
  /** Which side of the benchmark is good (from «≥» / «≤» in the source). Optional, added 2026-10. */
  direction?: 'higher_is_better' | 'lower_is_better'
}

export interface MetricTarget {
  value: number
  periodLabel: string            // '12m' | '3y' | …
  source: 'owner' | 'expert' | 'agent' | 'survey'
  direction: 'higher_is_better' | 'lower_is_better' | 'range'
}

/** Fields added to each catalog item (existing fields of the route are kept). */
export interface MetricCatalogEnrichment {
  category: MetricCategoryKey
  categoryLabel: string
  /** Subcategory key, e.g. 'goal_01' (labels: MetricCategory.subcategories / subcategoryLabel). */
  subcategory: string | null
  /** Russian label of the subcategory, e.g. «1. Привлечь новых клиентов». Optional, added 2026-10. */
  subcategoryLabel?: string | null
  description: string | null     // what the metric measures (never a sample «current state»)
  calculationMethod: string | null
  target: MetricTarget | null
  benchmark: MetricBenchmark | null
  /** Previous distinct value from metric_value_history, if any. */
  previousValue: number | null
  delta: number | null           // value − previousValue
  deltaPct: number | null        // delta / |previousValue| × 100
  trend: MetricTrend
  status: MetricStatus
  period: string | null          // human label of the value period, e.g. «2025», «Q3 2026», null when undated
  lastUpdated: string | null     // ISO; computed_at of the latest row
  provenanceType: 'FACT' | 'CALCULATED' | null
  /** 'flag' = value is 1/0 (render «Да / Нет»); 'number' otherwise. Optional, added 2026-10. */
  valueKind?: 'number' | 'flag'
}
