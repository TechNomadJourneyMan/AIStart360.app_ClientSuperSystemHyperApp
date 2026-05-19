// ============================================================
// Pure helpers for MetricDrillDownModalV2
// Kept dependency-free so they can be unit-tested in node env.
// ============================================================

import type { Period } from '@/types/periods'
import type {
  TimeseriesPoint,
  ForecastPoint,
  ChartPoint,
  AnomalyPoint,
  AnomalySeverity,
} from '@/types/metrics'

// ─── Period chips (V2 uses a slightly different set than core PERIODS) ──────
export const V2_PERIOD_OPTIONS: ReadonlyArray<{ id: Period; label: string }> = [
  { id: '1M', label: '1М' },
  { id: '3M', label: '3М' },
  { id: '1Y', label: '1Г' },
  { id: '3Y', label: '3Г' },
  // '1W' acts as the "ALL" fallback for very short series in this layout.
  { id: '1W', label: '1Н' },
]

export const DEFAULT_DRILL_PERIOD: Period = '3M'

// ─── Layer toggles ──────────────────────────────────────────────────────────
export type DrillLayer = 'fact' | 'forecast' | 'goal' | 'anomalies'

export const DEFAULT_DRILL_LAYERS: ReadonlyArray<DrillLayer> = [
  'fact',
  'forecast',
  'goal',
  'anomalies',
]

export const DRILL_LAYER_LABELS: Record<DrillLayer, string> = {
  fact: 'Факт',
  forecast: 'Прогноз',
  goal: 'Цель',
  anomalies: 'Аномалии',
}

export function toggleDrillLayer(
  active: ReadonlyArray<DrillLayer>,
  layer: DrillLayer,
): DrillLayer[] {
  return active.includes(layer)
    ? active.filter((l) => l !== layer)
    : [...active, layer]
}

// ─── Anomaly severity → palette ─────────────────────────────────────────────
export const ANOMALY_COLORS: Record<AnomalySeverity, string> = {
  critical: '#ffb4ab',
  warning: '#ffbd60',
  info: '#6effc0',
}

export function severityColor(sev: AnomalySeverity): string {
  return ANOMALY_COLORS[sev] ?? ANOMALY_COLORS.info
}

// ─── Number formatting (mirrors Phase 6a MetricHealthCard rules) ────────────
// Russian conventions: млн / тыс, ru-RU number locale, 1 decimal max.
export function formatMetricNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return value
    value = parsed
  }
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) {
    return `${formatRu(value / 1_000_000_000)} млрд`
  }
  if (abs >= 1_000_000) {
    return `${formatRu(value / 1_000_000)} млн`
  }
  if (abs >= 1_000) {
    return `${formatRu(value / 1_000)} тыс`
  }
  return formatRu(value)
}

function formatRu(n: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(n)
}

// ─── Merge fact + forecast into single Recharts series ──────────────────────
export function mergeFactForecast(
  fact: ReadonlyArray<TimeseriesPoint>,
  forecast: ReadonlyArray<ForecastPoint>,
  includeForecast: boolean,
): ChartPoint[] {
  const map = new Map<string, ChartPoint>()
  for (const p of fact) {
    map.set(p.label, { label: p.label, timestamp: p.timestamp, value: p.value })
  }
  if (includeForecast) {
    for (const p of forecast) {
      const existing = map.get(p.label)
      if (existing) {
        existing.forecastValue = p.value
        existing.confidenceLow = p.confidenceLow
        existing.confidenceHigh = p.confidenceHigh
      } else {
        map.set(p.label, {
          label: p.label,
          timestamp: p.timestamp,
          forecastValue: p.value,
          confidenceLow: p.confidenceLow,
          confidenceHigh: p.confidenceHigh,
          isForecast: true,
        })
      }
    }
  }
  return Array.from(map.values())
}

// ─── Provenance helpers ─────────────────────────────────────────────────────
export interface DrillProvenance {
  picked: { type: string; label: string } | null
  considered: Array<{
    type: string
    label: string
    status: 'hit' | 'miss' | 'error'
    confidence?: number
    reason?: string
  }>
  computedAt?: string
}

export function isSourcePicked(
  src: { type: string; label: string },
  picked: DrillProvenance['picked'],
): boolean {
  return !!picked && picked.type === src.type && picked.label === src.label
}

// "12 мин назад" / "2 ч назад" / "вчера"
export function formatRelativeRu(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now.getTime() - t)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  const days = Math.floor(hr / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн назад`
  return new Date(iso).toLocaleDateString('ru-RU')
}

// ─── Filter anomalies to a recent window ────────────────────────────────────
export function filterRecentAnomalies(
  anomalies: ReadonlyArray<AnomalyPoint>,
  windowDays = 90,
  now: Date = new Date(),
): AnomalyPoint[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000
  return anomalies.filter((a) => new Date(a.timestamp).getTime() >= cutoff)
}

// ─── Empty timeseries detector ──────────────────────────────────────────────
export function isTimeseriesEmpty(
  pts: ReadonlyArray<TimeseriesPoint> | null | undefined,
): boolean {
  if (!pts || pts.length === 0) return true
  return pts.every((p) => p.value == null || Number.isNaN(p.value))
}

// ─── Trend formatting ───────────────────────────────────────────────────────
export function formatTrend(
  trend: { direction: 'up' | 'down' | 'flat'; deltaPct: number } | undefined,
): { sign: string; text: string; tone: 'pos' | 'neg' | 'neutral' } {
  if (!trend) return { sign: '', text: '—', tone: 'neutral' }
  const sign = trend.direction === 'up' ? '+' : trend.direction === 'down' ? '−' : ''
  const abs = Math.abs(trend.deltaPct).toFixed(1)
  return {
    sign,
    text: `${sign}${abs}%`,
    tone: trend.direction === 'up' ? 'pos' : trend.direction === 'down' ? 'neg' : 'neutral',
  }
}
