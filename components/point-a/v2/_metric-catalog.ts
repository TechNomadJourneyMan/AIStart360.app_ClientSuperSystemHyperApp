/**
 * Shared access to `GET /api/v1/metrics/catalog?includeValues=true` for the
 * /point-a widgets.
 *
 * `MetricZonesGrid` (the three zone cards) and `PointAMetricDrillDown` (the
 * modal host) must read the SAME react-query entry: the grid renders a row,
 * the host resolves the id the row opened. Sharing the key here keeps the
 * modal free of a second network round-trip.
 */

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
  namespace: string
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
  // Optional fields the API may or may not include — read defensively.
  status?: 'red' | 'yellow' | 'green' | string | null
  target?: number | null
}

interface CatalogResponse {
  ok: boolean
  data?: {
    total: number
    page: number
    pageSize: number
    items: CatalogItem[]
  }
  error?: string
}

/** react-query key shared by the zones grid and the drill-down host. */
export const POINT_A_CATALOG_KEY = ['metrics', 'catalog', 'zones'] as const

export async function fetchPointACatalog(): Promise<CatalogItem[]> {
  const res = await fetch(
    '/api/v1/metrics/catalog?includeValues=true&pageSize=200&sort=label_asc',
    { credentials: 'include' },
  )
  if (!res.ok) {
    throw new Error(`Не удалось загрузить каталог метрик (${res.status})`)
  }
  const json = (await res.json()) as CatalogResponse
  if (!json.ok || !json.data) {
    throw new Error(json.error ?? 'Каталог метрик недоступен')
  }
  return json.data.items
}

/**
 * Build the provenance block the drill-down modal renders ("откуда взято
 * значение"). Mirrors the mapping used by `components/metrics/MetricsLiveCatalog`.
 */
export function buildProvenance(item: CatalogItem) {
  const considered = item.sources.map((s) => ({
    type: s.type,
    label:
      s.type === 'survey'
        ? `Анкета: ${s.key ?? ''}`
        : s.type === 'document'
        ? `Документ (${s.doc_type ?? '—'}) поле ${s.field ?? '—'}`
        : s.type === 'prisma'
        ? 'БД'
        : s.type === 'external'
        ? `Внешний: ${s.system ?? '—'}`
        : s.type,
    status: (item.source === s.type ? 'hit' : 'miss') as 'hit' | 'miss' | 'error',
    confidence: item.source === s.type ? item.confidence ?? undefined : undefined,
  }))
  const picked = considered.find((c) => c.status === 'hit')
  return {
    picked: picked ? { type: picked.type, label: picked.label } : null,
    considered,
    computedAt: item.computedAt ?? undefined,
  }
}
