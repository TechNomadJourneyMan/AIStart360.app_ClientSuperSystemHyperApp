'use client'

import { useQuery } from '@tanstack/react-query'
import type { MetricSummary, MetricDefinition } from '@/types/metrics'
import {
  catalogItemToDefinition,
  normalizeCatalogItem,
  type CatalogApiData,
} from '@/components/metrics/catalog-model'

export interface MetricsFilters {
  period?: string | null
  product?: string | null
  manager?: string | null
  /** Restrict to these metric ids (GET /api/v1/metrics?keys=a,b). */
  keys?: ReadonlyArray<string> | null
}

export function buildMetricsQuery(filters?: MetricsFilters): string {
  if (!filters) return ''
  const qs = new URLSearchParams()
  if (filters.period) qs.set('period', filters.period)
  if (filters.product) qs.set('product', filters.product)
  if (filters.manager) qs.set('manager', filters.manager)
  if (filters.keys && filters.keys.length > 0) qs.set('keys', filters.keys.join(','))
  const s = qs.toString()
  return s ? `?${s}` : ''
}

/** Envelope of GET /api/v1/metrics: { source: 'db' | 'empty', data: MetricSummary[] }. */
export interface MetricsEnvelope {
  source?: 'db' | 'empty' | 'error' | string
  data?: unknown
}

/** Pure envelope → list mapping (exported for tests and GrowthSnapshotHero). */
export function metricsFromEnvelope(json: MetricsEnvelope | null | undefined): MetricSummary[] {
  if (!json || !Array.isArray(json.data)) return []
  return (json.data as MetricSummary[]).filter((m) => m && typeof m.id === 'string')
}

async function fetchMetrics(filters?: MetricsFilters): Promise<MetricSummary[]> {
  const res = await fetch(`/api/v1/metrics${buildMetricsQuery(filters)}`, { credentials: 'include' })
  // 401 → honest empty list (the hero renders «нет данных»), never a crash.
  if (res.status === 401) return []
  if (!res.ok) throw new Error('Не удалось загрузить метрики')
  const json = (await res.json().catch(() => null)) as MetricsEnvelope | null
  return metricsFromEnvelope(json)
}

async function fetchCatalog(): Promise<MetricDefinition[]> {
  // The catalog is paginated (max 200 per page) and returns
  // { ok, data: { total, counts, items } } — not a bare array.
  const res = await fetch('/api/v1/metrics/catalog?includeValues=false&pageSize=200', { credentials: 'include' })
  if (!res.ok) throw new Error('Не удалось загрузить каталог метрик')
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: CatalogApiData } | null
  const items = json?.ok && Array.isArray(json.data?.items) ? json.data!.items : []
  return items.map((raw) => catalogItemToDefinition(normalizeCatalogItem(raw)))
}

/** Convert a catalog definition to a MetricSummary with placeholder values */
function catalogToSummary(def: MetricDefinition): MetricSummary {
  return {
    id: def.id,
    label: def.label,
    displayValue: '—',
    rawValue: 0,
    unit: def.unit,
    unitPosition: def.unitPosition,
    trend: 0,
    trendAbs: 0,
    trendDirection: 'flat',
    trendLabel: def.description,
    icon: def.icon,
    color: def.color,
    goalCategory: null,
    isDefault: def.isDefault,
    isRemovable: def.isRemovable,
  }
}

export function useMetrics(filters?: MetricsFilters) {
  return useQuery({
    queryKey: [
      'metrics',
      filters?.period ?? null,
      filters?.product ?? null,
      filters?.manager ?? null,
      filters?.keys?.join(',') ?? null,
    ],
    queryFn: () => fetchMetrics(filters),
    staleTime: 5 * 60_000,
  })
}

export function useMetricsCatalog() {
  return useQuery({
    queryKey: ['metrics-catalog'],
    queryFn: fetchCatalog,
    staleTime: 30 * 60_000,
  })
}

/**
 * Returns MetricSummary for ALL visibleIds.
 * Live API data takes priority; catalog fallback for non-default metrics.
 */
export function useAllVisibleMetrics(visibleIds: string[]) {
  const { data: live = [], isLoading: liveLoading } = useMetrics()
  const { data: catalog = [], isLoading: catLoading } = useMetricsCatalog()

  const liveMap = new Map(live.map((m) => [m.id, m]))
  const catMap = new Map(catalog.map((d) => [d.id, d]))

  const metrics: MetricSummary[] = visibleIds.map((id) => {
    if (liveMap.has(id)) return liveMap.get(id)!
    const def = catMap.get(id)
    if (def) return catalogToSummary(def)
    // Unknown ID — minimal fallback
    return {
      id,
      label: id,
      displayValue: '—',
      rawValue: 0,
      unit: '',
      unitPosition: 'after' as const,
      trend: 0,
      trendAbs: 0,
      trendDirection: 'flat' as const,
      trendLabel: '',
      icon: 'bar_chart',
      color: '#bcc7de',
      goalCategory: null,
      isDefault: false,
      isRemovable: true,
    }
  })

  return { data: metrics, isLoading: liveLoading || catLoading }
}
