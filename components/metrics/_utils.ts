// Shared types + constants for the /metrics catalog UI primitives.
// Kept in a plain .ts module (no JSX) so vitest can import these symbols
// without parsing the JSX-bearing component files — the project's tsconfig
// uses `jsx: "preserve"` which is incompatible with vite's import-analysis
// of .tsx files during unit tests.

export type SortMode =
  | 'label_asc'
  | 'label_desc'
  | 'value_desc'
  | 'value_asc'
  | 'trend_up'
  | 'trend_down'
  | 'confidence_desc'
  | 'freshness_desc'

export interface SortOption {
  value: SortMode
  label: string
  /**
   * Trend sorting needs a value history per metric, and nothing writes one yet
   * (`/api/v1/metrics/catalog` silently falls back to sorting by value —
   * see the TODO(phase3) branches in its `sortItems`). Rather than let the user
   * pick an option that quietly does something else, the option stays visible
   * but disabled with an explanation.
   */
  unavailable?: boolean
  unavailableNote?: string
}

export const SORT_OPTIONS: ReadonlyArray<SortOption> = [
  { value: 'label_asc', label: 'По названию (А→Я)' },
  { value: 'label_desc', label: 'По названию (Я→А)' },
  { value: 'value_desc', label: 'По значению ↓' },
  { value: 'value_asc', label: 'По значению ↑' },
  {
    value: 'trend_up',
    label: 'Лучший тренд',
    unavailable: true,
    unavailableNote: 'нужна история значений',
  },
  {
    value: 'trend_down',
    label: 'Худший тренд',
    unavailable: true,
    unavailableNote: 'нужна история значений',
  },
  { value: 'confidence_desc', label: 'По уверенности' },
  { value: 'freshness_desc', label: 'Самые свежие' },
]

/** Sort modes the catalog can actually honour today. */
export const USABLE_SORT_MODES: ReadonlyArray<SortMode> = SORT_OPTIONS.filter(
  (o) => !o.unavailable,
).map((o) => o.value)

export type Namespace = 'all' | 'biz' | 'kpi' | 'gri' | 'goal'

export interface NamespaceTab {
  value: Namespace
  label: string
}

export const NAMESPACE_TABS: ReadonlyArray<NamespaceTab> = [
  { value: 'all', label: 'Все' },
  { value: 'biz', label: 'Бизнес-метрики' },
  { value: 'kpi', label: 'KPI' },
  { value: 'gri', label: 'GRI' },
  { value: 'goal', label: 'Цели роста' },
]

export const DEPARTMENT_ALL_KEY = '__all__'

/** Default debounce delay (ms) applied to the metric search box input. */
export const METRIC_SEARCH_DEBOUNCE_MS = 300

/** Default Russian placeholder for the metric search box. */
export const METRIC_SEARCH_PLACEHOLDER = 'Поиск метрик…'

// ── Data-availability filter ────────────────────────────────────────────────
// On a page where a large share of the registry metrics has no resolved
// value, "показать только заполненные" / "показать пробелы" is the single most
// useful filter. Computed client-side from value + confidence.

export type DataFilter = 'all' | 'with_value' | 'without_value' | 'low_confidence'

export interface DataFilterOption {
  value: DataFilter
  label: string
}

export const DATA_FILTERS: ReadonlyArray<DataFilterOption> = [
  { value: 'all', label: 'Все' },
  { value: 'with_value', label: 'Есть значение' },
  { value: 'without_value', label: 'Нет значения' },
  { value: 'low_confidence', label: 'Низкая уверенность' },
]

/** Confidence below this is flagged as "verify me" in the UI. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5

/** Presentation mode of the catalog body. */
export type CatalogView = 'grid' | 'table'

/** Filter/sort state of the catalog, lifted so other blocks can drive it. */
export interface CatalogFilters {
  namespace: Namespace
  department: string | null
  search: string
  data: DataFilter
  sort: SortMode
  view: CatalogView
  page: number
}

export const DEFAULT_CATALOG_FILTERS: CatalogFilters = {
  namespace: 'all',
  department: null,
  search: '',
  data: 'all',
  sort: 'label_asc',
  view: 'grid',
  page: 1,
}

/** DOM id of the catalog section — used to scroll back to it from other blocks. */
export const CATALOG_ANCHOR_ID = 'metrics-catalog'

/**
 * "Обновлено N дней назад" for a metric's computed_at timestamp.
 * Returns null when there is no usable timestamp, so callers can stay silent
 * instead of printing a fake freshness claim.
 */
export function formatUpdatedRu(
  iso: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!iso) return null
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return null
  const diffMs = Math.max(0, now.getTime() - ts)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'обновлено только что'
  if (minutes < 60) return `обновлено ${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `обновлено ${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'обновлено вчера'
  if (days < 7) return `обновлено ${days} дн назад`
  return `обновлено ${new Date(ts).toLocaleDateString('ru-RU')}`
}

/** Russian label for a resolver source type. */
export function sourceLabelRu(source: string | null | undefined): string {
  switch (source) {
    case 'survey':   return 'Анкета'
    case 'document': return 'Документ'
    case 'prisma':   return 'CRM'
    case 'external': return 'Внешний'
    case 'manual':   return 'Вручную'
    case 'missing':  return 'Нет источника'
    default:         return '—'
  }
}

/** Russian label for a metric namespace. */
export function namespaceLabelRu(ns: string): string {
  return NAMESPACE_TABS.find((t) => t.value === ns)?.label ?? ns
}

/** Russian plural form: pluralRu(3, ['показатель','показателя','показателей']). */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100
  const tail = abs % 10
  if (abs > 10 && abs < 20) return forms[2]
  if (tail > 1 && tail < 5) return forms[1]
  if (tail === 1) return forms[0]
  return forms[2]
}
