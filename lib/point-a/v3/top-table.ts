// ============================================================
// lib/point-a/v3/top-table.ts
//
// Compute engine for the Point A "TOP SALES TABLE" — the
// 8-row × 6-column matrix at the top of the client dashboard.
//
// Rows  (TOP_TABLE_METRICS):
//   1. sales_count           — Количество продаж
//   2. sales_amount          — Сумма продаж
//   3. avg_check             — Средний чек
//   4. new_sales_count       — Количество новых продаж
//   5. new_sales_amount      — Сумма новых продаж
//   6. new_avg_check         — Средний чек новых продаж
//   7. repeat_sales_count    — Количество повторных продаж
//   8. repeat_sales_amount   — Сумма повторных продаж
//
// Columns:
//   plan_year   — План 2026 (год)
//   fact_year   — Факт 2026 (год)
//   plan_month  — План в месяц
//   fact_month  — Факт в месяц
//   pct_year    — % выполнения от плана на год
//   pct_3y      — % выполнения от плана на 3 года
//
// Data sources, in order of preference:
//   1. Raw sales rows extracted from documents (parsed_data.raw_rows
//      or parsed_data.rows). Each row carries client_id / manager_id /
//      product_id / amount / occurred_at, which lets us compute
//      new-vs-repeat splits + dimension filters.
//   2. Aggregate sales fields from parsed_data.fields[] when no raw
//      rows are present (degraded mode — new/repeat split returns null).
//   3. Materialized metrics resolver (biz.sales.*, biz.finance.vyruchka_god)
//      as a coarse-grained fallback.
//
// Plan source priority:
//   1. companies.target_revenue_12m_kzt / target_revenue_3y_kzt
//      (planSource = 'company')
//   2. parseGoals(s6_goal_12months, s6_goal_3years)
//      (planSource = 'survey')
//   3. None — every plan_* column is null
//      (planSource = 'default')
//
// The engine NEVER throws. UI calls always get a structured response,
// even when the company has zero documents and zero survey answers.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseGoals } from './parse-goals'
import { loadEcommerceAnalytics } from './ecommerce-orders-loader'

// ─── Public types ────────────────────────────────────────────

export type TopTablePeriod = 'day' | 'week' | 'month' | 'quarter' | 'year'

export type TopTableMetricKey =
  | 'sales_count'
  | 'sales_amount'
  | 'avg_check'
  | 'new_sales_count'
  | 'new_sales_amount'
  | 'new_avg_check'
  | 'repeat_sales_count'
  | 'repeat_sales_amount'

export interface TopTableRow {
  metric: TopTableMetricKey
  label: string
  planYear: number | null
  factYear: number | null
  planMonth: number | null
  factMonth: number | null
  pctYear: number | null
  pct3y: number | null
}

export type PlanSource = 'company' | 'survey' | 'default'

export interface TopTableResult {
  rows: TopTableRow[]
  asOf: string
  planSource: PlanSource
  /** 0..1 — what fraction of factYear cells are non-null. */
  dataCoverage: number
  /** Echo of the filter that was applied, for cache-key / debug. */
  filter: {
    period: TopTablePeriod
    year: number
    productId: string | null
    managerId: string | null
  }
}

export interface ComputeTopTableOptions {
  period: TopTablePeriod
  productId?: string
  managerId?: string
  /** Calendar year to anchor the table on. Defaults to current year. */
  year?: number
  /** Injected clock (tests). */
  now?: Date
}

// ─── Row labels (Russian, per spec) ──────────────────────────

export const ROW_LABELS: Record<TopTableMetricKey, string> = {
  sales_count: 'Количество продаж',
  sales_amount: 'Сумма продаж',
  avg_check: 'Средний чек',
  new_sales_count: 'Количество новых продаж',
  new_sales_amount: 'Сумма новых продаж',
  new_avg_check: 'Средний чек новых продаж',
  repeat_sales_count: 'Количество повторных продаж',
  repeat_sales_amount: 'Сумма повторных продаж',
}

export const TOP_TABLE_METRICS: TopTableMetricKey[] = [
  'sales_count',
  'sales_amount',
  'avg_check',
  'new_sales_count',
  'new_sales_amount',
  'new_avg_check',
  'repeat_sales_count',
  'repeat_sales_amount',
]

// ─── Raw row shape we accept from parsed_data ────────────────

export interface SalesRow {
  /** Stable sale/order identifier. Prevents collisions for same-time purchases. */
  sale_id?: string
  /** Stable identifier for the buyer — used for new-vs-repeat detection. */
  client_id: string
  /** Optional CRM-style manager assignment. */
  manager_id?: string | null
  /** Optional product / service the sale was for. */
  product_id?: string | null
  /** Sale value in ₸ (KZT). Engine assumes upstream already converted. */
  amount: number
  /** ISO date / datetime of the sale. Falls back to YYYY-MM-DD parse. */
  occurred_at: string
}

interface SalesAggregate {
  count: number
  amount: number
  newCount: number
  newAmount: number
  repeatCount: number
  repeatAmount: number
}

interface ResolvedPlan {
  planYearTotalKzt: number | null
  plan3yTotalKzt: number | null
  source: PlanSource
}

// ─── Helpers ─────────────────────────────────────────────────

function emptyRows(): TopTableRow[] {
  return TOP_TABLE_METRICS.map((m) => ({
    metric: m,
    label: ROW_LABELS[m],
    planYear: null,
    factYear: null,
    planMonth: null,
    factMonth: null,
    pctYear: null,
    pct3y: null,
  }))
}

function emptyAggregate(): SalesAggregate {
  return { count: 0, amount: 0, newCount: 0, newAmount: 0, repeatCount: 0, repeatAmount: 0 }
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function safeDiv(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
  return num / den
}

/** Percentage of plan attained. Returns null when plan is missing / zero. */
function pctOfPlan(fact: number | null, plan: number | null): number | null {
  if (fact === null || plan === null || plan === 0) return null
  return Math.round((fact / plan) * 1000) / 10 // one decimal
}

function parseDate(s: string): Date | null {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d
}

/**
 * Bucket a sales row into "this year", "this period", or "neither".
 * The period bucket honors the requested granularity (day/week/month/quarter/year).
 */
function bucketRow(
  row: SalesRow,
  period: TopTablePeriod,
  anchor: Date,
): { inYear: boolean; inPeriod: boolean } {
  const d = parseDate(row.occurred_at)
  if (!d) return { inYear: false, inPeriod: false }

  const anchorYear = anchor.getUTCFullYear()
  const inYear = d.getUTCFullYear() === anchorYear
  if (!inYear) return { inYear: false, inPeriod: false }

  switch (period) {
    case 'year':
      return { inYear, inPeriod: true }
    case 'quarter': {
      const q = (m: number) => Math.floor(m / 3)
      return { inYear, inPeriod: q(d.getUTCMonth()) === q(anchor.getUTCMonth()) }
    }
    case 'month':
      return { inYear, inPeriod: d.getUTCMonth() === anchor.getUTCMonth() }
    case 'week': {
      const ms = 24 * 60 * 60 * 1000
      const diffDays = Math.floor((anchor.getTime() - d.getTime()) / ms)
      return { inYear, inPeriod: diffDays >= 0 && diffDays < 7 }
    }
    case 'day':
      return {
        inYear,
        inPeriod:
          d.getUTCFullYear() === anchor.getUTCFullYear() &&
          d.getUTCMonth() === anchor.getUTCMonth() &&
          d.getUTCDate() === anchor.getUTCDate(),
      }
  }
}

/**
 * Detect first-purchase clients within the FULL history (across all
 * loaded documents) — not just the anchor year. A client whose first
 * row globally falls in the current bucket counts as "new".
 *
 * Pure function over a pre-sorted history.
 */
export function classifyNewVsRepeat(rows: SalesRow[]): Map<string, 'new' | 'repeat'> {
  // Sort ascending by occurred_at. Stable order ⇒ first occurrence wins.
  const sorted = [...rows].sort((a, b) => {
    const da = parseDate(a.occurred_at)?.getTime() ?? 0
    const db = parseDate(b.occurred_at)?.getTime() ?? 0
    return da - db
  })
  const seen = new Set<string>()
  const classification = new Map<string, 'new' | 'repeat'>()
  for (const r of sorted) {
    const key = rowKey(r)
    if (seen.has(r.client_id)) {
      classification.set(key, 'repeat')
    } else {
      classification.set(key, 'new')
      seen.add(r.client_id)
    }
  }
  return classification
}

function rowKey(r: SalesRow): string {
  return r.sale_id ?? `${r.client_id}|${r.occurred_at}|${r.amount}`
}

/**
 * Aggregate a list of (already filtered for year/period) rows
 * into the eight metrics. The `newRepeat` map is computed across
 * the FULL history so cross-period repeat detection works.
 */
export function aggregateRows(
  rows: SalesRow[],
  newRepeat: Map<string, 'new' | 'repeat'>,
): SalesAggregate {
  const agg = emptyAggregate()
  for (const r of rows) {
    agg.count += 1
    agg.amount += r.amount
    const cls = newRepeat.get(rowKey(r))
    if (cls === 'new') {
      agg.newCount += 1
      agg.newAmount += r.amount
    } else if (cls === 'repeat') {
      agg.repeatCount += 1
      agg.repeatAmount += r.amount
    }
  }
  return agg
}

/** Apply product / manager filters to a row set. */
function applyDimensions(
  rows: SalesRow[],
  productId?: string | null,
  managerId?: string | null,
): SalesRow[] {
  return rows.filter((r) => {
    if (productId && (r.product_id ?? null) !== productId) return false
    if (managerId && (r.manager_id ?? null) !== managerId) return false
    return true
  })
}

// ─── Document → raw rows extraction ──────────────────────────

interface DocumentLike {
  doc_type: string | null
  parsed_data: unknown
}

/**
 * Pull raw sales rows out of parsed_data on a single document.
 * Accepts two shapes:
 *   parsed_data.raw_rows: SalesRow[]   (preferred)
 *   parsed_data.rows:     SalesRow[]   (legacy alias)
 *
 * Documents whose doc_type doesn't smell like sales data are skipped
 * (we still allow crm_export, pl_report, financial_report — owners
 * sometimes mislabel sales reports as "P&L").
 */
const SALES_DOC_TYPES = new Set([
  'sales_report',
  'crm_export',
  'pl_report',
  'financial_report',
  'patient_base', // medical vertical: visits double as sales rows
])

export function extractRawRows(doc: DocumentLike): SalesRow[] {
  if (!doc.parsed_data || typeof doc.parsed_data !== 'object') return []
  if (doc.doc_type && !SALES_DOC_TYPES.has(doc.doc_type)) return []

  const pd = doc.parsed_data as Record<string, unknown>
  const candidate = (pd.raw_rows ?? pd.rows) as unknown
  if (!Array.isArray(candidate)) return []

  const out: SalesRow[] = []
  for (const item of candidate) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const clientId = o.client_id ?? o.clientId ?? o.customer_id
    const amount = o.amount ?? o.sum ?? o.total ?? o.value
    const occurredAt = o.occurred_at ?? o.date ?? o.occurredAt ?? o.created_at
    if (typeof clientId !== 'string' || !clientId) continue
    if (!isFiniteNumber(amount)) continue
    if (typeof occurredAt !== 'string' || !occurredAt) continue
    out.push({
      client_id: clientId,
      manager_id: (o.manager_id as string | null | undefined) ?? (o.managerId as string | null | undefined) ?? null,
      product_id: (o.product_id as string | null | undefined) ?? (o.productId as string | null | undefined) ?? null,
      amount,
      occurred_at: occurredAt,
    })
  }
  return out
}

// ─── Plan resolution ─────────────────────────────────────────

function resolvePlan(
  company: { target_revenue_12m_kzt: number | null; target_revenue_3y_kzt: number | null } | null,
  surveyAnswers: Record<string, unknown>,
): ResolvedPlan {
  const cTwelve = company?.target_revenue_12m_kzt
  const cThree = company?.target_revenue_3y_kzt
  if ((isFiniteNumber(cTwelve) && cTwelve > 0) || (isFiniteNumber(cThree) && cThree > 0)) {
    return {
      planYearTotalKzt: isFiniteNumber(cTwelve) && cTwelve > 0 ? cTwelve : null,
      plan3yTotalKzt: isFiniteNumber(cThree) && cThree > 0 ? cThree : null,
      source: 'company',
    }
  }

  const goal12 = surveyAnswers['s6_goal_12months']
  const goal3y = surveyAnswers['s6_goal_3years']
  const goal12Str = typeof goal12 === 'string' ? goal12 : null
  const goal3yStr = typeof goal3y === 'string' ? goal3y : null

  const parsed = parseGoals(goal12Str, goal3yStr)
  if (parsed.revenue_12m_kzt !== null || parsed.revenue_3y_kzt !== null) {
    return {
      planYearTotalKzt: parsed.revenue_12m_kzt,
      plan3yTotalKzt: parsed.revenue_3y_kzt,
      source: 'survey',
    }
  }

  return { planYearTotalKzt: null, plan3yTotalKzt: null, source: 'default' }
}

// ─── Row builder ─────────────────────────────────────────────

/**
 * Build the 8 TopTableRow values from the year + period aggregates
 * and the resolved plan totals. Plan-month is plan-year / 12 for
 * sales_amount; sales_count plans aren't on the spec so we leave null.
 *
 * Pure function — easy to unit-test.
 */
export function buildRows(
  yearAgg: SalesAggregate,
  periodAgg: SalesAggregate,
  plan: ResolvedPlan,
  hasRawData: boolean,
): TopTableRow[] {
  const planYearAmount = plan.planYearTotalKzt
  const planMonthAmount =
    isFiniteNumber(planYearAmount) ? Math.round(planYearAmount / 12) : null

  // For metrics without an explicit plan number we leave the plan
  // columns null — the spec only specifies a single revenue target
  // for the whole table. The UI shows "—" for these.
  function makeRow(
    metric: TopTableMetricKey,
    factYear: number,
    factPeriod: number,
    planYear: number | null,
    planMonth: number | null,
  ): TopTableRow {
    return {
      metric,
      label: ROW_LABELS[metric],
      planYear,
      factYear: hasRawData ? factYear : null,
      planMonth,
      factMonth: hasRawData ? factPeriod : null,
      pctYear: hasRawData ? pctOfPlan(factYear, planYear) : null,
      pct3y: hasRawData ? pctOfPlan(factYear, plan.plan3yTotalKzt) : null,
    }
  }

  // Avg check derivations are computed from counts/amounts.
  const yearAvgCheck = safeDiv(yearAgg.amount, yearAgg.count) ?? 0
  const periodAvgCheck = safeDiv(periodAgg.amount, periodAgg.count) ?? 0
  const yearNewAvgCheck = safeDiv(yearAgg.newAmount, yearAgg.newCount) ?? 0
  const periodNewAvgCheck = safeDiv(periodAgg.newAmount, periodAgg.newCount) ?? 0

  return [
    makeRow('sales_count', yearAgg.count, periodAgg.count, null, null),
    makeRow('sales_amount', yearAgg.amount, periodAgg.amount, planYearAmount, planMonthAmount),
    makeRow('avg_check', Math.round(yearAvgCheck), Math.round(periodAvgCheck), null, null),
    makeRow('new_sales_count', yearAgg.newCount, periodAgg.newCount, null, null),
    makeRow('new_sales_amount', yearAgg.newAmount, periodAgg.newAmount, null, null),
    makeRow('new_avg_check', Math.round(yearNewAvgCheck), Math.round(periodNewAvgCheck), null, null),
    makeRow('repeat_sales_count', yearAgg.repeatCount, periodAgg.repeatCount, null, null),
    makeRow('repeat_sales_amount', yearAgg.repeatAmount, periodAgg.repeatAmount, null, null),
  ]
}

// ─── Top-level engine ────────────────────────────────────────

/** Compute coverage as "non-null factYear cells / total cells". */
function computeCoverage(rows: TopTableRow[]): number {
  if (!rows.length) return 0
  const filled = rows.filter((r) => r.factYear !== null).length
  return Math.round((filled / rows.length) * 100) / 100
}

interface TopTableSeed {
  company: { target_revenue_12m_kzt: number | null; target_revenue_3y_kzt: number | null } | null
  surveyAnswers: Record<string, unknown>
  documents: DocumentLike[]
  /** Normalized order history takes precedence over uploaded snapshots. */
  salesRows?: SalesRow[]
  /** Optional product-allocated subset; classification still uses salesRows. */
  selectedSalesRows?: SalesRow[]
}

/**
 * Pure compute step. The DB-fetch + auth happen in the API route;
 * this function is unit-test friendly because it takes a pre-loaded
 * seed instead of a SupabaseClient.
 */
export function computeTopTableFromSeed(
  seed: TopTableSeed,
  opts: ComputeTopTableOptions,
): TopTableResult {
  const now = opts.now ?? new Date()
  const anchorYear = opts.year ?? now.getUTCFullYear()
  const anchor = new Date(Date.UTC(anchorYear, now.getUTCMonth(), now.getUTCDate()))

  // 1. Prefer normalized ecommerce orders. Documents stay a fallback for
  // clients that have not connected a live source yet.
  let documentRows: SalesRow[] = []
  for (const doc of seed.documents) {
    documentRows = documentRows.concat(extractRawRows(doc))
  }
  const rawRows = seed.salesRows?.length ? seed.salesRows : documentRows

  // 2. Apply dimension filters BEFORE classification — a product filter
  //    shouldn't pretend a client is "new" just because their other-product
  //    purchases are excluded. But manager filter SHOULD also stay
  //    cross-row consistent: classification uses unfiltered history so
  //    the "new" label reflects company-wide first contact.
  const newRepeat = classifyNewVsRepeat(rawRows)

  const normalizedSelection =
    seed.salesRows?.length && seed.selectedSalesRows
      ? seed.selectedSalesRows
      : null
  const filtered = normalizedSelection && !opts.managerId
    ? normalizedSelection
    : applyDimensions(rawRows, opts.productId ?? null, opts.managerId ?? null)

  // 3. Bucket and aggregate.
  const yearRows: SalesRow[] = []
  const periodRows: SalesRow[] = []
  for (const r of filtered) {
    const b = bucketRow(r, opts.period, anchor)
    if (b.inYear) yearRows.push(r)
    if (b.inPeriod) periodRows.push(r)
  }
  const yearAgg = aggregateRows(yearRows, newRepeat)
  const periodAgg = aggregateRows(periodRows, newRepeat)

  // 4. Resolve plan.
  const plan = resolvePlan(seed.company, seed.surveyAnswers)

  // 5. Build rows.
  const rows = buildRows(yearAgg, periodAgg, plan, rawRows.length > 0)

  return {
    rows,
    asOf: now.toISOString(),
    planSource: plan.source,
    dataCoverage: computeCoverage(rows),
    filter: {
      period: opts.period,
      year: anchorYear,
      productId: opts.productId ?? null,
      managerId: opts.managerId ?? null,
    },
  }
}

// ─── DB-backed wrapper ───────────────────────────────────────

/**
 * High-level entry point used by the API route. Pulls survey answers,
 * documents, and company targets from Supabase and feeds them into
 * the pure compute step.
 *
 * Never throws — returns an empty TopTableResult on any DB error.
 */
export async function computeTopTable(
  supabase: SupabaseClient,
  userId: string,
  opts: ComputeTopTableOptions,
): Promise<TopTableResult> {
  const now = opts.now ?? new Date()

  // Locate the user's company. Spec assumes one-company-per-user.
  const { data: companyRow } = await supabase
    .from('companies')
    .select('id, target_revenue_12m_kzt, target_revenue_3y_kzt')
    .eq('user_id', userId)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()

  // Parallel fetch survey, documents and normalized ecommerce history.
  const [{ data: surveyData }, { data: docsData }, ecommerce] = await Promise.all([
    supabase
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', userId),
    supabase
      .from('documents')
      .select('id, doc_type, parsed_data, parse_status')
      .eq('user_id', userId)
      .in('parse_status', ['parsed', 'completed']),
    loadEcommerceAnalytics(supabase, userId, {
      productId: opts.productId ?? null,
    }),
  ])

  const surveyAnswers: Record<string, unknown> = {}
  for (const row of surveyData ?? []) {
    const ans = (row as { answer: unknown }).answer as { value?: unknown } | null
    const key = (row as { question_key: string }).question_key
    surveyAnswers[key] = ans && typeof ans === 'object' && 'value' in ans ? ans.value : ans
  }

  const documents: DocumentLike[] = (docsData ?? []).map((d) => ({
    doc_type: (d as { doc_type: string | null }).doc_type ?? null,
    parsed_data: (d as { parsed_data: unknown }).parsed_data ?? null,
  }))

  const company = companyRow
    ? {
        target_revenue_12m_kzt: (companyRow as Record<string, unknown>).target_revenue_12m_kzt as
          | number
          | null
          | undefined ?? null,
        target_revenue_3y_kzt: (companyRow as Record<string, unknown>).target_revenue_3y_kzt as
          | number
          | null
          | undefined ?? null,
      }
    : null

  // Postgres NUMERIC may arrive as a string via Supabase REST — coerce.
  if (company) {
    if (typeof company.target_revenue_12m_kzt === 'string') {
      const n = parseFloat(company.target_revenue_12m_kzt)
      company.target_revenue_12m_kzt = Number.isFinite(n) ? n : null
    }
    if (typeof company.target_revenue_3y_kzt === 'string') {
      const n = parseFloat(company.target_revenue_3y_kzt)
      company.target_revenue_3y_kzt = Number.isFinite(n) ? n : null
    }
  }

  return computeTopTableFromSeed(
    {
      company,
      surveyAnswers,
      documents,
      // A manager dimension is not part of the MyHonor order contract. If a
      // manager filter is explicitly requested, fall back to document rows
      // which can carry manager_id rather than returning misleading matches.
      ...(ecommerce.allSalesRows.length > 0 && !opts.managerId
        ? {
            salesRows: ecommerce.allSalesRows,
            selectedSalesRows: ecommerce.selectedSalesRows,
          }
        : {}),
    },
    { ...opts, now },
  )
}

// ─── Filter discovery (used by /filters route) ───────────────

export interface FilterOption {
  id: string
  name: string
}

export interface TopTableFilters {
  products: FilterOption[]
  managers: FilterOption[]
}

/**
 * Walk the documents that look like sales reports and surface the
 * distinct product / manager identifiers found in their raw rows.
 * Returns id-only entries when human-readable names aren't carried
 * by parsed_data (UI shows the id verbatim then).
 */
export function discoverFiltersFromSeed(seed: TopTableSeed): TopTableFilters {
  const products = new Map<string, string>()
  const managers = new Map<string, string>()

  // Also accept name dictionaries the parser may have produced.
  for (const doc of seed.documents) {
    if (!doc.parsed_data || typeof doc.parsed_data !== 'object') continue
    const pd = doc.parsed_data as Record<string, unknown>
    const productDict = pd.products as Array<{ id?: string; name?: string }> | undefined
    const managerDict = pd.managers as Array<{ id?: string; name?: string }> | undefined
    for (const p of productDict ?? []) {
      if (p?.id) products.set(p.id, p.name ?? p.id)
    }
    for (const m of managerDict ?? []) {
      if (m?.id) managers.set(m.id, m.name ?? m.id)
    }

    for (const row of extractRawRows(doc)) {
      if (row.product_id && !products.has(row.product_id)) {
        products.set(row.product_id, row.product_id)
      }
      if (row.manager_id && !managers.has(row.manager_id)) {
        managers.set(row.manager_id, row.manager_id)
      }
    }
  }

  return {
    products: Array.from(products.entries()).map(([id, name]) => ({ id, name })),
    managers: Array.from(managers.entries()).map(([id, name]) => ({ id, name })),
  }
}

export async function discoverFilters(
  supabase: SupabaseClient,
  userId: string,
): Promise<TopTableFilters> {
  const [{ data: docsData }, ecommerce] = await Promise.all([
    supabase
      .from('documents')
      .select('doc_type, parsed_data, parse_status')
      .eq('user_id', userId)
      .in('parse_status', ['parsed', 'completed']),
    loadEcommerceAnalytics(supabase, userId),
  ])

  const documents: DocumentLike[] = (docsData ?? []).map((d) => ({
    doc_type: (d as { doc_type: string | null }).doc_type ?? null,
    parsed_data: (d as { parsed_data: unknown }).parsed_data ?? null,
  }))

  const documentFilters = discoverFiltersFromSeed({
    company: null,
    surveyAnswers: {},
    documents,
  })
  const products = new Map(
    documentFilters.products.map((product) => [product.id, product.name]),
  )
  for (const product of ecommerce.products) {
    products.set(product.id, product.name)
  }
  return {
    products: Array.from(products.entries()).map(([id, name]) => ({ id, name })),
    managers: documentFilters.managers,
  }
}
