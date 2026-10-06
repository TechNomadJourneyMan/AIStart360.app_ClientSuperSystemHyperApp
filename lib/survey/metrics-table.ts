/**
 * lib/survey/metrics-table.ts — read the step-8 «Ключевые метрики» table.
 *
 * Step8MetricsForm stores `s8n_metrics_table` as an array of rows
 * `{ metric_name, y2023, y2024, y2025, plan_2026, fact_2026, completion_pct }`
 * pre-filled with 12 standard metrics (Сумма продаж, Средний чек, CAC, LTV …).
 * The owner may rename or add rows, so rows are matched by a normalised name
 * against a list of aliases.
 *
 * The form writes 0 for an empty cell (`Number(x) || 0`), so 0 is read as
 * «not filled» — the table cannot express a real zero.
 */

export type MetricsTableRow =
  | 'sales_count'
  | 'sales_amount'
  | 'avg_check'
  | 'new_sales_count'
  | 'new_sales_amount'
  | 'new_avg_check'
  | 'repeat_count'
  | 'repeat_amount'
  | 'cpl'
  | 'cac'
  | 'ltv'
  | 'ltv_cac'

export type MetricsTableColumn = 'y2023' | 'y2024' | 'y2025' | 'plan_2026' | 'fact_2026'

export type MetricsTableColumnPick = MetricsTableColumn | 'latest' | 'latest_full_year'

/** Normalised row names (lower-case, «ё»→«е», no punctuation, single spaces). */
const ROW_ALIASES: Readonly<Record<MetricsTableRow, readonly string[]>> = {
  sales_count: ['количество продаж', 'кол во продаж', 'число продаж'],
  sales_amount: ['сумма продаж', 'выручка', 'объем продаж'],
  avg_check: ['средний чек', 'ср чек'],
  new_sales_count: ['кол во новых продаж', 'количество новых продаж', 'новые клиенты', 'кол во новых клиентов', 'количество новых клиентов'],
  new_sales_amount: ['сумма новых продаж'],
  new_avg_check: ['ср чек новых', 'средний чек новых'],
  repeat_count: ['кол во повторных', 'количество повторных', 'кол во повторных продаж', 'повторные клиенты'],
  repeat_amount: ['сумма повторных', 'сумма повторных продаж'],
  cpl: ['cpl', 'стоимость лида'],
  cac: ['cac', 'стоимость привлечения клиента', 'стоимость привлечения'],
  ltv: ['ltv'],
  ltv_cac: ['ltv cac', 'ltv к cac', 'ltv на cac'],
}

export const METRICS_TABLE_ROWS = Object.keys(ROW_ALIASES) as MetricsTableRow[]

export function isMetricsTableRow(v: string): v is MetricsTableRow {
  return v in ROW_ALIASES
}

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim()
}

const ROW_BY_NAME: ReadonlyMap<string, MetricsTableRow> = (() => {
  const m = new Map<string, MetricsTableRow>()
  for (const [row, names] of Object.entries(ROW_ALIASES) as Array<[MetricsTableRow, readonly string[]]>) {
    for (const n of names) m.set(n, row)
  }
  return m
})()

function cell(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0 ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.replace(/[\s ]/g, '').replace(',', '.'))
    return Number.isFinite(n) && n !== 0 ? n : null
  }
  return null
}

const COLUMNS: readonly MetricsTableColumn[] = ['y2023', 'y2024', 'y2025', 'plan_2026', 'fact_2026']

export type MetricsTable = Partial<Record<MetricsTableRow, Partial<Record<MetricsTableColumn, number>>>>

/** Parse the stored answer (array of rows, or `{ value: [...] }`) into known rows. Unknown rows are ignored. */
export function readMetricsTable(raw: unknown): MetricsTable {
  const value =
    raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in (raw as Record<string, unknown>)
      ? (raw as { value: unknown }).value
      : raw
  const out: MetricsTable = {}
  if (!Array.isArray(value)) return out
  for (const r of value) {
    if (!r || typeof r !== 'object') continue
    const rec = r as Record<string, unknown>
    const name = typeof rec.metric_name === 'string' ? normaliseName(rec.metric_name) : ''
    const row = ROW_BY_NAME.get(name)
    if (!row || out[row]) continue // first matching row wins
    const cells: Partial<Record<MetricsTableColumn, number>> = {}
    for (const c of COLUMNS) {
      const v = cell(rec[c])
      if (v !== null) cells[c] = v
    }
    if (Object.keys(cells).length > 0) out[row] = cells
  }
  return out
}

export interface MetricsTableCell {
  value: number
  column: MetricsTableColumn
}

/**
 * One cell of a row. 'latest' = newest filled fact (Факт 2026 → 2025 → 2024 → 2023);
 * 'latest_full_year' skips the partial-year «Факт 2026» (use it for sums and
 * counts, which are not comparable across a partial year). «План 2026» is a
 * target and is only returned when asked for explicitly.
 */
export function metricsTableCell(
  table: MetricsTable,
  row: MetricsTableRow,
  column: MetricsTableColumnPick = 'latest',
): MetricsTableCell | null {
  const cells = table[row]
  if (!cells) return null
  const order: readonly MetricsTableColumn[] =
    column === 'latest' ? ['fact_2026', 'y2025', 'y2024', 'y2023']
    : column === 'latest_full_year' ? ['y2025', 'y2024', 'y2023']
    : [column]
  for (const c of order) {
    const v = cells[c]
    if (typeof v === 'number') return { value: v, column: c }
  }
  return null
}

/** Human label of a table column, e.g. «2025», «факт 2026». */
export function metricsTableColumnLabel(column: MetricsTableColumn): string {
  switch (column) {
    case 'y2023': return '2023'
    case 'y2024': return '2024'
    case 'y2025': return '2025'
    case 'plan_2026': return 'план 2026'
    case 'fact_2026': return 'факт 2026'
  }
}
