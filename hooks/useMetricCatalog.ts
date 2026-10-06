'use client'

/**
 * React Query hooks over GET /api/v1/metrics/catalog (types/metric-catalog.ts).
 *
 *  • useMetricCatalog(query) — loads the WHOLE result set for a category /
 *    search / sort (all pages of 200), so client-side filters (status, source,
 *    confidence, period, subcategory) and per-category counts are exact, never
 *    page-local. The registry is ~130 metrics → normally a single request.
 *  • useCatalogItem(id) — one enriched item (drill-down opened from a place
 *    that only knows the metric id, e.g. the key-metrics hero).
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { MetricCategoryKey } from '@/types/metric-catalog'
import {
  extractCategoryCounts,
  normalizeCatalogItem,
  type CatalogApiData,
  type CatalogItem,
} from '@/components/metrics/catalog-model'
import type { SortMode } from '@/components/metrics/_utils'

const PAGE_SIZE = 200
const MAX_PAGES = 10

export interface MetricCatalogQuery {
  category: MetricCategoryKey | 'all'
  search: string
  sort: SortMode
}

export interface MetricCatalogResult {
  items: CatalogItem[]
  total: number
  /** Per-category totals from the API (search-aware), null if not exposed. */
  categoryCounts: Record<string, number> | null
  categories: CatalogApiData['categories'] | null
}

interface CatalogEnvelope {
  ok?: boolean
  data?: CatalogApiData
  error?: string
}

async function fetchPage(params: URLSearchParams, page: number): Promise<CatalogApiData> {
  const p = new URLSearchParams(params)
  p.set('page', String(page))
  const res = await fetch(`/api/v1/metrics/catalog?${p.toString()}`, { cache: 'no-store', credentials: 'include' })
  const json = (await res.json().catch(() => null)) as CatalogEnvelope | null
  if (!res.ok || !json?.ok || !json.data) {
    throw new Error(json?.error ?? `Не удалось загрузить каталог метрик (${res.status})`)
  }
  return json.data
}

export function catalogParams(q: MetricCatalogQuery): URLSearchParams {
  const p = new URLSearchParams()
  if (q.category !== 'all') p.set('category', q.category)
  if (q.search) p.set('search', q.search)
  p.set('sort', q.sort)
  p.set('pageSize', String(PAGE_SIZE))
  p.set('includeValues', 'true')
  return p
}

async function fetchCatalogAll(q: MetricCatalogQuery): Promise<MetricCatalogResult> {
  const params = catalogParams(q)
  const first = await fetchPage(params, 1)
  const total = typeof first.total === 'number' ? first.total : first.items.length
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PAGE_SIZE)))
  const rest =
    pages > 1
      ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchPage(params, i + 2)))
      : []
  const raw = [first, ...rest].flatMap((d) => (Array.isArray(d.items) ? d.items : []))
  return {
    items: raw.map(normalizeCatalogItem),
    total,
    categoryCounts: extractCategoryCounts(first),
    categories: Array.isArray(first.categories) ? first.categories : null,
  }
}

export function useMetricCatalog(q: MetricCatalogQuery) {
  return useQuery({
    queryKey: ['metrics-catalog', 'full', q.category, q.search, q.sort] as const,
    queryFn: () => fetchCatalogAll(q),
    staleTime: 30_000,
    retry: 1,
    placeholderData: keepPreviousData,
  })
}

async function fetchCatalogItem(id: string): Promise<CatalogItem | null> {
  const p = new URLSearchParams({ search: id, pageSize: '10', includeValues: 'true' })
  const data = await fetchPage(p, 1)
  const raw = (data.items ?? []).find((it) => it.id === id)
  return raw ? normalizeCatalogItem(raw) : null
}

export function useCatalogItem(id: string | null) {
  return useQuery({
    queryKey: ['metrics-catalog', 'item', id] as const,
    queryFn: () => fetchCatalogItem(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
    retry: 1,
  })
}
