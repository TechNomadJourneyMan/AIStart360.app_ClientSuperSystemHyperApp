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
}

export const SORT_OPTIONS: ReadonlyArray<SortOption> = [
  { value: 'label_asc', label: 'По названию (А→Я)' },
  { value: 'label_desc', label: 'По названию (Я→А)' },
  { value: 'value_desc', label: 'По значению ↓' },
  { value: 'value_asc', label: 'По значению ↑' },
  { value: 'trend_up', label: 'Лучший тренд' },
  { value: 'trend_down', label: 'Худший тренд' },
  { value: 'confidence_desc', label: 'По уверенности' },
  { value: 'freshness_desc', label: 'Самые свежие' },
]

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
