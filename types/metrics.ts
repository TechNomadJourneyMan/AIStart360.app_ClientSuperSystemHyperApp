// ============================================================
// Metrics Domain Types
// ============================================================

export type MetricCategory = 'financial' | 'operational' | 'customer' | 'custom'
export type DataLayer = 'fact' | 'forecast' | 'goal' | 'compare'
export type GoalTrajectory = 'on_track' | 'at_risk' | 'behind'
export type AnomalySeverity = 'info' | 'warning' | 'critical'

export const DEFAULT_METRIC_IDS = ['revenue', 'margin', 'clients', 'avg_check'] as const
export type DefaultMetricId = typeof DEFAULT_METRIC_IDS[number]

export const MAX_METRICS = 20

// Catalog definition — static, from server
export interface MetricDefinition {
  id: string
  label: string
  description: string
  category: MetricCategory
  icon: string
  unit: string
  unitPosition: 'before' | 'after'
  color: string
  isDefault: boolean
  isRemovable: boolean
}

// Summary card data — current value + trend
export interface MetricSummary {
  id: string
  label: string
  displayValue: string        // formatted: "₸84.2М"
  rawValue: number            // 84200000
  unit: string
  unitPosition: 'before' | 'after'
  trend: number               // percent: +12.4
  trendAbs: number            // absolute delta
  trendDirection: 'up' | 'down' | 'flat'
  trendLabel: string          // "vs прошлый квартал"
  icon: string
  color: string
  goalCategory: string | null
  isDefault: boolean
  isRemovable: boolean
  /** Registry id of the metric (lib/metrics/registry.ts). Added 2026-10. */
  metricKey?: string
  /** public.metrics.source of the value (survey / document / …). */
  source?: string | null
  confidence?: number | null
  computedAt?: string | null
}

// Time series point
export interface TimeseriesPoint {
  timestamp: string   // ISO 8601
  value: number
  label: string       // pre-formatted for XAxis
}

// Forecast point
export interface ForecastPoint {
  timestamp: string
  value: number
  label: string
  isForecast: true
  confidenceLow: number
  confidenceHigh: number
}

// Combined chart point (fact + optional forecast)
export interface ChartPoint {
  label: string
  timestamp: string
  value?: number
  forecastValue?: number
  confidenceLow?: number
  confidenceHigh?: number
  isForecast?: boolean
}

// Anomaly marker
export interface AnomalyPoint {
  timestamp: string
  label: string
  value: number
  severity: AnomalySeverity
  description: string
}

// Goal for a metric
export interface MetricGoal {
  goalId: string
  metricId: string
  targetValue: number
  targetUnit: string
  deadline: string | null
  progress: number              // 0-100
  trajectory: GoalTrajectory
  /**
   * Current value the progress is computed from (same unit as targetValue),
   * null when the company has no value yet — then progress is 0 and the UI
   * should say «нет фактического значения», not «отстаём». Added 2026-10.
   */
  actualValue?: number | null
}

// Breakdown item (drill-down)
export interface BreakdownItem {
  label: string
  value: number
  share: number   // 0-1
  trend: number   // % change
}

export interface MetricBreakdown {
  dimension: string
  items: BreakdownItem[]
}
