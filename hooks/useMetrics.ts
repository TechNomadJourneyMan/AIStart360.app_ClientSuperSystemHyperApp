'use client'

import { useQuery } from '@tanstack/react-query'
import type { MetricSummary, MetricDefinition } from '@/types/metrics'

export interface MetricsFilters {
  period?: string | null
  product?: string | null
  manager?: string | null
}

function buildMetricsQuery(filters?: MetricsFilters): string {
  if (!filters) return ''
  const qs = new URLSearchParams()
  if (filters.period) qs.set('period', filters.period)
  if (filters.product) qs.set('product', filters.product)
  if (filters.manager) qs.set('manager', filters.manager)
  const s = qs.toString()
  return s ? `?${s}` : ''
}

async function fetchMetrics(filters?: MetricsFilters): Promise<MetricSummary[]> {
  const res = await fetch(`/api/v1/metrics${buildMetricsQuery(filters)}`)
  if (!res.ok) throw new Error('Failed to fetch metrics')
  const json = await res.json()
  return json.data as MetricSummary[]
}

async function fetchCatalog(): Promise<MetricDefinition[]> {
  const res = await fetch('/api/v1/metrics/catalog')
  if (!res.ok) throw new Error('Failed to fetch catalog')
  const json = await res.json()
  return json.data as MetricDefinition[]
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
    queryKey: ['metrics', filters?.period ?? null, filters?.product ?? null, filters?.manager ?? null],
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
