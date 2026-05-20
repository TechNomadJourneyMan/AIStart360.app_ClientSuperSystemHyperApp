// ============================================================
// types/point-a-dashboard.ts
// Lightweight UI-side contracts for the new client dashboard
// widgets. Domain RFM / RetentionCurve / LossMap types live in
// `@/types/point-a-v3` — UI components import them directly.
//
// What stays here:
//   - PointAPeriod (URL filter chip values)
//   - TopTableRow / TopTableResponse (Top Sales Table)
// ============================================================

export type PointAPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year'

export interface PointAFilters {
  period: PointAPeriod
  product?: string | null
  manager?: string | null
}

// ─── Top Sales Table ───────────────────────────────────────────
export type TopTableRowKey =
  | 'sales_count'
  | 'sales_sum'
  | 'avg_check'
  | 'new_count'
  | 'new_sum'
  | 'avg_check_new'
  | 'repeat_count'
  | 'repeat_sum'

export interface TopTableRow {
  /** Engineering id, e.g. "sales_count". */
  key: TopTableRowKey
  /** Russian row label. */
  label_ru: string
  /** Unit hint for formatting. */
  unit: '₸' | 'count'
  plan_year: number | null
  fact_year: number | null
  plan_month: number | null
  fact_month: number | null
  pct_year: number | null
  pct_3y: number | null
}

export interface TopTableResponse {
  ok: true
  data: {
    rows: TopTableRow[]
    period: PointAPeriod
    product: string | null
    manager: string | null
    available_products: string[]
    available_managers: string[]
    computed_at: string
    /** When true, plan is the default / fact is all-zeros. */
    is_mock: boolean
  }
}
