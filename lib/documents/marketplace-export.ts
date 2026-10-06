/**
 * lib/documents/marketplace-export.ts — facts from row-level marketplace and
 * accounting exports (W7): Kaspi orders export, Wildberries «Отчёт о
 * реализации», Ozon «Отчёт о реализации», МойСклад «Прибыльность» / «Остатки».
 *
 * These files are tables with one row per order / sale / return / product,
 * not «показатель ; значение» rows, so the table extractor finds nothing in
 * them. Here the header is recognised through MARKETPLACE_COLUMN_SYNONYMS and
 * the rows are aggregated deterministically:
 *
 *   orders_count            distinct order ids (or sale rows) that are neither
 *                           cancelled nor returns
 *   marketplace_revenue     sum of the amount column over sales
 *   marketplace_commission  sum of the commission column (as the report signs it)
 *   marketplace_payout      sum of the payout column
 *   returns_count           return rows / returned quantity
 *   defect_rate             returns ÷ sales × 100 («Брак / возвраты», %)
 *   buyout_rate             sales ÷ (sales + returns) × 100 («выкуп», %)
 *   avg_order_value         revenue ÷ orders (only when the amount is per order)
 *   sku_count / sku_in_stock distinct articles / with stock > 0
 *
 * Rows that are totals («Итого», «Всего») are skipped. Nothing is guessed: a
 * fact is produced only from the columns that are present. Money keeps the
 * file's currency unknown (the export has no currency column in most cases):
 * the unit is left null and the resolver decides by the metric's unit.
 */
import { detectDelimiter, parseAmount, parseCsvLine } from './extract-rows'
import type { FieldProvenance, ParsedDataField } from './extract'
import { MARKETPLACE_COLUMN_SYNONYMS, matchMarketplaceColumn, normalizeForMatch, type MarketplaceColumn } from './synonyms'
import type { StructuredText } from './text'

const MARKER = /^\[(Страница|Лист|Слайд|Документ)[^\]]*\]$/
const TOTAL_ROW = /^(итого|всего|total)\b/i
const HEADER_SCAN_LINES = 30
const MAX_ROWS = 200_000

const RETURN_RE = /возвра[тщ]|return/i
const SALE_RE = /продаж|реализац|sale/i
const CANCEL_RE = /отмен|cancel/i
const COMPLETED_RE = /выдан|заверш|доставлен|completed|выкуплен/i

/** Columns that only a marketplace / accounting export has (used for unclassified uploads). */
const SIGNATURE: readonly MarketplaceColumn[] = ['commission', 'payout', 'doc_type', 'returned_quantity', 'stock']
const MEASURES: readonly MarketplaceColumn[] = ['amount', 'quantity', 'stock', 'commission', 'payout', 'returned_quantity']

export interface ExportHeader {
  line: number
  delimiter: string
  /** Canonical column → index. Exact header matches win over contained ones. */
  columns: Partial<Record<MarketplaceColumn, number>>
  quote: string
}

/** Header of an export: ≥ 2 recognised columns, at least one of them a measure. */
export function detectExportHeader(lines: readonly string[]): ExportHeader | null {
  for (let i = 0; i < Math.min(lines.length, HEADER_SCAN_LINES); i++) {
    const raw = lines[i].trim()
    if (!raw || MARKER.test(raw)) continue
    const delimiter = detectDelimiter(raw)
    const cells = parseCsvLine(raw, delimiter)
    if (cells.length < 2) continue
    const columns: Partial<Record<MarketplaceColumn, number>> = {}
    const exact = new Set<MarketplaceColumn>()
    cells.forEach((cell, idx) => {
      const col = matchMarketplaceColumn(cell)
      if (!col) return
      const isExact = isExactSynonym(normalizeForMatch(cell), col)
      if (columns[col] === undefined || (isExact && !exact.has(col))) {
        columns[col] = idx
        if (isExact) exact.add(col)
      }
    })
    const found = Object.keys(columns) as MarketplaceColumn[]
    if (found.length >= 2 && found.some((c) => MEASURES.includes(c))) {
      return { line: i, delimiter, columns, quote: raw.slice(0, 200) }
    }
  }
  return null
}

const exactSets = new Map<MarketplaceColumn, Set<string>>()
function isExactSynonym(norm: string, col: MarketplaceColumn): boolean {
  let set = exactSets.get(col)
  if (!set) {
    set = new Set(MARKETPLACE_COLUMN_SYNONYMS[col].map((s) => normalizeForMatch(s)))
    exactSets.set(col, set)
  }
  return set.has(norm)
}

export interface ExportAggregate {
  rows: number
  orders: number | null
  salesUnits: number | null
  returns: number | null
  revenue: number | null
  returnsAmount: number | null
  commission: number | null
  payout: number | null
  skuCount: number | null
  skuInStock: number | null
  /** The amount column holds the sum of an order (Kaspi-like), not a line price. */
  amountPerOrder: boolean
  periodFrom: string | null
  periodTo: string | null
}

function cell(cells: string[], idx: number | undefined): string {
  return idx === undefined ? '' : (cells[idx] ?? '').trim()
}

function number(cells: string[], idx: number | undefined): number | null {
  const v = cell(cells, idx)
  return v ? parseAmount(v) : null
}

function isoDate(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v) ?? null
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const r = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(v)
  return r ? `${r[3]}-${r[2].padStart(2, '0')}-${r[1].padStart(2, '0')}` : null
}

export function aggregateExport(lines: readonly string[], header: ExportHeader): ExportAggregate {
  const c = header.columns
  const orders = new Set<string>()
  const skus = new Set<string>()
  const skusInStock = new Set<string>()
  let rows = 0
  let orderRows = 0
  let salesUnits = 0
  let returnUnits = 0
  let revenue = 0
  let returnsAmount = 0
  let commission = 0
  let payout = 0
  let sawAmount = false
  let sawCommission = false
  let sawPayout = false
  let sawReturns = false
  let from: string | null = null
  let to: string | null = null

  for (let i = header.line + 1; i < lines.length && rows < MAX_ROWS; i++) {
    const raw = lines[i].trim()
    if (!raw || MARKER.test(raw)) continue
    const cells = parseCsvLine(raw, header.delimiter)
    const first = cells.find((x) => x.trim()) ?? ''
    if (TOTAL_ROW.test(first)) continue
    if (cells.filter((x) => x.trim()).length < 2) continue
    rows += 1

    const kind = cell(cells, c.doc_type)
    const status = cell(cells, c.status)
    const cancelled = CANCEL_RE.test(status)
    const isReturn = RETURN_RE.test(kind) || RETURN_RE.test(status)
    const qty = number(cells, c.quantity)
    const amount = number(cells, c.amount)
    const day = isoDate(cell(cells, c.date))
    if (day) {
      if (!from || day < from) from = day
      if (!to || day > to) to = day
    }

    const sku = cell(cells, c.sku)
    if (sku) skus.add(sku)
    const stock = number(cells, c.stock)
    if (sku && stock !== null && stock > 0) skusInStock.add(sku)

    const comm = number(cells, c.commission)
    if (comm !== null) { commission += comm; sawCommission = true }
    const pay = number(cells, c.payout)
    if (pay !== null) { payout += pay; sawPayout = true }

    const returned = number(cells, c.returned_quantity)
    if (returned !== null) {
      returnUnits += Math.abs(returned)
      sawReturns = true
      const ra = number(cells, c.returns_amount)
      if (ra !== null) returnsAmount += Math.abs(ra)
    }

    if (cancelled) continue
    if (isReturn) {
      returnUnits += Math.abs(qty ?? 1)
      sawReturns = true
      if (amount !== null) returnsAmount += Math.abs(amount)
      continue
    }
    // A row with a document type that is neither a sale nor a return (logistics, fines) is no sale.
    if (c.doc_type !== undefined && kind && !SALE_RE.test(kind)) continue
    const order = cell(cells, c.order_id)
    if (order) orders.add(order)
    else orderRows += 1
    // With a status column (Kaspi-like) only completed orders are sales; otherwise every row is.
    if (c.status !== undefined && status && !COMPLETED_RE.test(status)) continue
    salesUnits += qty !== null ? qty : 1
    if (amount !== null) { revenue += amount; sawAmount = true }
  }

  const transactional = c.doc_type !== undefined || c.status !== undefined || c.order_id !== undefined
  const ordersCount = c.order_id !== undefined ? orders.size + orderRows : transactional ? orderRows : null
  return {
    rows,
    orders: ordersCount,
    salesUnits: c.quantity !== undefined || transactional ? salesUnits : null,
    returns: sawReturns || c.doc_type !== undefined || c.status !== undefined ? returnUnits : null,
    revenue: sawAmount ? revenue : null,
    returnsAmount: sawReturns && returnsAmount > 0 ? returnsAmount : null,
    commission: sawCommission ? commission : null,
    payout: sawPayout ? payout : null,
    skuCount: c.sku !== undefined && skus.size ? skus.size : null,
    skuInStock: c.stock !== undefined && c.sku !== undefined ? skusInStock.size : null,
    amountPerOrder: c.order_id !== undefined && c.quantity === undefined,
    periodFrom: from,
    periodTo: to,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Fields of a marketplace export, or [] when the text is not one.
 * `requireSignature`: for unclassified uploads — only a header with a
 * marketplace-specific column counts.
 */
export function marketplaceExportFields(st: StructuredText, documentId: string, opts: { requireSignature?: boolean } = {}): ParsedDataField[] {
  let best: { header: ExportHeader; agg: ExportAggregate; lines: string[]; offset: number } | null = null
  for (const seg of st.segments) {
    const body = st.text.slice(seg.start, seg.end)
    const lines = body.split('\n')
    const header = detectExportHeader(lines)
    if (!header) continue
    if (opts.requireSignature && !SIGNATURE.some((s) => header.columns[s] !== undefined)) continue
    const agg = aggregateExport(lines, header)
    if (!best || agg.rows > best.agg.rows) {
      const offset = seg.start + lines.slice(0, header.line).reduce((n, l) => n + l.length + 1, 0)
      best = { header, agg, lines, offset }
    }
  }
  if (!best || best.agg.rows === 0) return []
  const { agg, header } = best
  const period = agg.periodFrom && agg.periodTo ? (agg.periodFrom === agg.periodTo ? agg.periodFrom : `${agg.periodFrom} — ${agg.periodTo}`) : null
  const provenance = (): FieldProvenance => ({
    document_id: documentId,
    method: 'table',
    quote: header.quote,
    quote_verified: true,
    offset: best?.offset ?? null,
    model: null,
    prompt_version: null,
  })
  const out: ParsedDataField[] = []
  const push = (key: string, label: string, value: number | null, unit: string | null, withPeriod = true) => {
    if (value === null || !Number.isFinite(value)) return
    out.push({
      key, label, value: round2(value), unit, period: withPeriod ? period : null,
      target_tab: 'Ключевые метрики', target_parameter: label,
      source: `агрегат выгрузки: ${agg.rows} строк`,
      confidence: 0.85,
      provenance: provenance(),
    })
  }
  push('orders_count', 'Количество заказов (по выгрузке)', agg.orders, 'шт')
  push('marketplace_revenue', 'Выручка по выгрузке', agg.revenue, null)
  push('marketplace_commission', 'Комиссия маркетплейса', agg.commission, null)
  push('marketplace_payout', 'К перечислению продавцу', agg.payout, null)
  push('returns_count', 'Количество возвратов', agg.returns, 'шт')
  const sales = agg.salesUnits
  if (sales !== null && agg.returns !== null && sales > 0) {
    push('defect_rate', 'Возвраты, % от продаж', (agg.returns / sales) * 100, '%', false)
    push('buyout_rate', 'Процент выкупа', (sales / (sales + agg.returns)) * 100, '%', false)
  }
  if (agg.amountPerOrder && agg.revenue !== null && agg.orders) push('avg_order_value', 'Средний чек заказа', agg.revenue / agg.orders, null, false)
  push('sku_count', 'Количество SKU', agg.skuCount, 'шт', false)
  if (agg.skuInStock !== null) push('sku_in_stock', 'SKU в наличии', agg.skuInStock, 'шт', false)
  return out
}
