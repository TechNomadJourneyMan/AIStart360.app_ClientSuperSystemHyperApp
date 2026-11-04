/**
 * Translate persisted documents.parsed_data into the compact inputs consumed
 * by Point A. This is deliberately read-only: uploaded tables never mutate
 * survey_answers. Row-level table data is authoritative for v3 metrics; scalar
 * extracted fields fill gaps in manually entered survey values.
 */

import type { AggregatorDocumentContext } from '@/lib/point-a/v3/aggregator-v3'
import { coerceNumeric } from '@/lib/metrics/source-adapters'

export interface PointADocumentInput {
  id: string
  docType: string
  parsedData: unknown
  periodYear?: number | null
  uploadedAt?: string | null
}

interface ParsedField {
  key?: unknown
  label?: unknown
  value?: unknown
  metric_id?: unknown
  confidence?: unknown
}

interface ParsedSalesRow {
  client_id?: unknown
  amount?: unknown
  occurred_at?: unknown
}

interface ParsedClientRow {
  client_id?: unknown
  total_spent_kzt?: unknown
  purchase_count?: unknown
  last_purchase_date?: unknown
  first_purchase_date?: unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizedProbe(field: ParsedField): string {
  return [field.key, field.label, field.metric_id]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
}

function firstFieldNumber(
  documents: PointADocumentInput[],
  aliases: RegExp[],
): number | null {
  for (const doc of documents) {
    const payload = record(doc.parsedData)
    const fields = Array.isArray(payload?.fields)
      ? payload.fields as ParsedField[]
      : []
    const sorted = [...fields].sort((a, b) => {
      const ac = typeof a.confidence === 'number' ? a.confidence : 0
      const bc = typeof b.confidence === 'number' ? b.confidence : 0
      return bc - ac
    })
    for (const field of sorted) {
      const probe = normalizedProbe(field)
      if (!aliases.some((alias) => alias.test(probe))) continue
      const numeric = coerceNumeric(field.value)
      if (numeric !== null) return numeric
    }
  }
  return null
}

function firstArray(
  documents: PointADocumentInput[],
  keys: string[],
): unknown[] {
  for (const doc of documents) {
    const payload = record(doc.parsedData)
    if (!payload) continue
    for (const key of keys) {
      if (Array.isArray(payload[key]) && payload[key].length > 0) {
        return payload[key] as unknown[]
      }
    }
  }
  return []
}

function finiteOrNull(value: unknown): number | null {
  const numeric = coerceNumeric(value)
  return numeric !== null && Number.isFinite(numeric) ? numeric : null
}

function setIfMissing(
  target: Record<string, unknown>,
  key: string,
  value: number | boolean | null | undefined,
): void {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return
  const current = target[key]
  const missing =
    current === undefined ||
    current === null ||
    (typeof current === 'string' && current.trim() === '')
  if (missing) target[key] = value
}

export function buildPointADocumentContext(
  documents: PointADocumentInput[],
): AggregatorDocumentContext {
  // Inputs normally arrive newest-first from gatherResolverContext. Preserve
  // that order so a newer report wins instead of summing overlapping periods.
  const salesRows = firstArray(documents, ['raw_rows', 'rows']) as ParsedSalesRow[]
  const validSales = salesRows
    .map((row, index) => ({
      clientId: typeof row.client_id === 'string' && row.client_id
        ? row.client_id
        : `row-${index}`,
      amount: finiteOrNull(row.amount),
      occurredAt: typeof row.occurred_at === 'string' ? row.occurred_at : '',
      index,
    }))
    .filter((row): row is typeof row & { amount: number } => row.amount !== null)
    .sort((a, b) => {
      const at = Date.parse(a.occurredAt)
      const bt = Date.parse(b.occurredAt)
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt
      return a.index - b.index
    })

  const seenClients = new Set<string>()
  let revenueFromNew = 0
  let revenueFromRepeat = 0
  let repeatPurchases = 0
  for (const row of validSales) {
    if (seenClients.has(row.clientId)) {
      repeatPurchases += 1
      revenueFromRepeat += row.amount
    } else {
      seenClients.add(row.clientId)
      revenueFromNew += row.amount
    }
  }

  const clientRows = firstArray(
    documents,
    ['client_rows', 'clients'],
  ) as ParsedClientRow[]
  const validClients = clientRows.filter((row) =>
    typeof row.client_id === 'string' && row.client_id.length > 0
  )
  const activeCutoff = Date.now() - 365 * 24 * 60 * 60 * 1000
  const activeClients = validClients.filter((row) => {
    const parsed = typeof row.last_purchase_date === 'string'
      ? Date.parse(row.last_purchase_date)
      : Number.NaN
    return Number.isFinite(parsed) && parsed >= activeCutoff
  }).length
  const purchases = validClients
    .map((row) => finiteOrNull(row.purchase_count))
    .filter((value): value is number => value !== null)

  const revenueFromRows = validSales.length > 0
    ? validSales.reduce((sum, row) => sum + row.amount, 0)
    : null

  return {
    sales_count: validSales.length > 0
      ? validSales.length
      : firstFieldNumber(documents, [
          /\bsales_count\b/, /\bdeals_count\b/, /\btransactions_count\b/,
          /количеств\w*\s+(продаж|сделок)/,
        ]),
    revenue_total: revenueFromRows ?? firstFieldNumber(documents, [
      /\brevenue(_total)?\b/, /\bgross_revenue\b/, /выручк/,
    ]),
    new_clients_count: validSales.length > 0
      ? seenClients.size
      : firstFieldNumber(documents, [/\bnew_clients(_count)?\b/, /нов\w*\s+клиент/]),
    revenue_from_new: validSales.length > 0 ? revenueFromNew : firstFieldNumber(
      documents,
      [/\brevenue_from_new\b/, /выручк\w*\s+.*нов\w*\s+клиент/],
    ),
    repeat_purchases_count: validSales.length > 0
      ? repeatPurchases
      : firstFieldNumber(documents, [
          /\brepeat_(purchases|clients)(_count)?\b/, /повторн\w*\s+(покуп|клиент)/,
        ]),
    revenue_from_repeat: validSales.length > 0 ? revenueFromRepeat : firstFieldNumber(
      documents,
      [/\brevenue_from_repeat\b/, /выручк\w*\s+.*повтор/],
    ),
    total_clients: validClients.length > 0
      ? validClients.length
      : firstFieldNumber(documents, [/\b(total_)?clients(_count)?\b/, /всего\s+клиент/]),
    active_last_12mo: validClients.length > 0
      ? activeClients
      : firstFieldNumber(documents, [/\bactive_clients(_count)?\b/, /активн\w*\s+клиент/]),
    avg_purchases_per_client: purchases.length > 0
      ? purchases.reduce((sum, value) => sum + value, 0) / purchases.length
      : firstFieldNumber(documents, [
          /\bavg_purchases_per_client\b/, /средн\w*\s+.*покуп\w*\s+.*клиент/,
        ]),
    marketing_budget: firstFieldNumber(documents, [
      /\bmarketing_(budget|total_spend)\b/, /маркетинг\w*\s+(бюджет|расход)/,
    ]),
    leads_count: firstFieldNumber(documents, [/\bleads_count\b/, /количеств\w*\s+лид/]),
    cogs: firstFieldNumber(documents, [/\bcogs\b/, /\bcost_of_goods\b/, /себестоим/]),
    payroll: firstFieldNumber(documents, [/\bpayroll\b/, /\bstaff_costs\b/, /\bфот\b/, /зарплат/]),
    ebitda: firstFieldNumber(documents, [/\bebitda\b/]),
    net_profit: firstFieldNumber(documents, [/\bnet_profit\b/, /чист\w*\s+прибыл/]),
    depreciation: firstFieldNumber(documents, [/\bdepreciation\b/, /амортизац/]),
    taxes: firstFieldNumber(documents, [/\btaxes?\b/, /налог/]),
    interest: firstFieldNumber(documents, [/\binterest(_expense)?\b/, /процент\w*\s+.*кредит/]),
    fixed_costs: firstFieldNumber(documents, [/\bfixed_costs\b/, /постоянн\w*\s+расход/]),
    variable_costs: firstFieldNumber(documents, [/\bvariable_costs\b/, /переменн\w*\s+расход/]),
  }
}

/**
 * Let manually entered survey values stand; use document metrics only for
 * unanswered fields. Point A v3 receives the document context separately and
 * therefore keeps table rows as the primary source for table-derived metrics.
 */
export function enrichSurveyAnswersWithDocuments(
  surveyAnswers: Record<string, unknown>,
  documents: AggregatorDocumentContext,
): Record<string, unknown> {
  const answers = { ...surveyAnswers }
  const avgCheck = documents.revenue_total !== null &&
    documents.revenue_total !== undefined &&
    documents.sales_count !== null &&
    documents.sales_count !== undefined &&
    documents.sales_count > 0
    ? documents.revenue_total / documents.sales_count
    : null
  const cac = documents.marketing_budget !== null &&
    documents.marketing_budget !== undefined &&
    documents.new_clients_count !== null &&
    documents.new_clients_count !== undefined &&
    documents.new_clients_count > 0
    ? documents.marketing_budget / documents.new_clients_count
    : null

  setIfMissing(answers, 's2_revenue_2025', documents.revenue_total)
  setIfMissing(answers, 's9n_revenue_2024', documents.revenue_total)
  setIfMissing(answers, 's3_deals_2025', documents.sales_count)
  setIfMissing(answers, 's2_new_clients_2025', documents.new_clients_count)
  setIfMissing(answers, 's2_repeat_clients_2025', documents.repeat_purchases_count)
  setIfMissing(answers, 's2_avg_check', avgCheck)
  setIfMissing(answers, 's2_cac', cac)
  setIfMissing(answers, 's9n_net_profit', documents.net_profit)
  setIfMissing(answers, 's9n_expense_cogs', documents.cogs)
  setIfMissing(answers, 's9n_expense_marketing', documents.marketing_budget)
  return answers
}

export function buildDocumentPromptContext(
  documents: PointADocumentInput[],
): string {
  const snippets: string[] = []
  for (const doc of documents.slice(0, 10)) {
    const payload = record(doc.parsedData)
    if (!payload) continue
    const summary = typeof payload.summary === 'string'
      ? payload.summary.slice(0, 600)
      : ''
    const fields = Array.isArray(payload.fields)
      ? (payload.fields as ParsedField[]).slice(0, 30).map((field) => ({
          key: typeof field.key === 'string' ? field.key : null,
          label: typeof field.label === 'string' ? field.label : null,
          value: field.value,
          metric_id: typeof field.metric_id === 'string' ? field.metric_id : null,
        }))
      : []
    snippets.push(JSON.stringify({
      document_id: doc.id,
      document_type: doc.docType,
      period_year: doc.periodYear ?? null,
      summary,
      fields,
    }).slice(0, 4000))
  }
  return snippets.join('\n').slice(0, 12000)
}
