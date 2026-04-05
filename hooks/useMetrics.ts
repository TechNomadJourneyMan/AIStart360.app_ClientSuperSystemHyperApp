'use client'

import { useQuery } from '@tanstack/react-query'
import type { MetricSummary, MetricDefinition } from '@/types/metrics'

async function fetchMetrics(): Promise<MetricSummary[]> {
  const res = await fetch('/api/v1/metrics')
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

export function useMetrics() {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
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
