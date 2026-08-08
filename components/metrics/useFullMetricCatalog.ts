'use client'

import { useQuery } from '@tanstack/react-query'

// ============================================================
// Shared catalog data for the /metrics screen.
//
// The registry is small (~130 entries today) and `/api/v1/metrics/catalog`
// resolves every value in one batch, so we pull the *whole* catalog once and
// do filtering / sorting / paging on the client. That removes three lies the
// server-paginated version told the user:
//   1. namespace tab counters were literal zeros for every inactive tab;
//   2. the department chip list was built from the current page only;
//   3. the "122 показателя" headline was a hardcoded string (the registry already held 126).
// It also makes an "есть значение / нет значения" filter possible at all.
// ============================================================

export interface CatalogItemSource {
  type: string
  key?: string
  field?: string
  doc_type?: string
  system?: string
}

export interface CatalogItem {
  id: string
  label: string
  namespace: 'biz' | 'kpi' | 'gri' | 'goal'
  department: string | null
  goalNumber: string | null
  unit: string
  formula: string | null
  sources: CatalogItemSource[]
  value: number | string | null
  confidence: number | null
  source: string | null
  computedAt: string | null
  fresh: boolean
}

interface CatalogPage {
  total: number
  page: number
  pageSize: number
  items: CatalogItem[]
}

interface CatalogResponse {
  ok: boolean
  data?: CatalogPage
  error?: string
}

/** Max page size accepted by /api/v1/metrics/catalog. */
const API_PAGE_SIZE = 200
/** Safety belt so a broken `total` can never spin the loop forever. */
const MAX_PAGES = 5

async function fetchCatalogPage(page: number): Promise<CatalogPage> {
  const params = new URLSearchParams({
    namespace: 'all',
    sort: 'label_asc',
    page: String(page),
    pageSize: String(API_PAGE_SIZE),
    includeValues: 'true',
  })
  const res = await fetch(`/api/v1/metrics/catalog?${params.toString()}`, {
    cache: 'no-store',
  })
  const json = (await res.json()) as CatalogResponse
  if (!json.ok || !json.data) throw new Error(json.error ?? 'Не удалось загрузить каталог метрик')
  return json.data
}

async function fetchWholeCatalog(): Promise<CatalogItem[]> {
  const first = await fetchCatalogPage(1)
  const items = [...first.items]
  let page = 2
  while (items.length < first.total && page <= MAX_PAGES) {
    const next = await fetchCatalogPage(page)
    if (next.items.length === 0) break
    items.push(...next.items)
    page += 1
  }
  return items
}

/**
 * The full metric catalog with resolved values.
 * Key stays under the `metrics-catalog` prefix so every existing
 * `invalidateQueries({ queryKey: ['metrics-catalog'] })` still refreshes it.
 */
export function useFullMetricCatalog() {
  return useQuery({
    queryKey: ['metrics-catalog', 'full'] as const,
    queryFn: fetchWholeCatalog,
    staleTime: 30_000,
    retry: 1,
  })
}
