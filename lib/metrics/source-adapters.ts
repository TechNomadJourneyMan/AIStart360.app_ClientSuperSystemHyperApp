// ============================================================
// lib/metrics/source-adapters.ts
// Pure functions that try to resolve a single MetricSource
// against a pre-fetched ResolverContext. Each adapter returns
// a SourceAttempt — never throws.
// ============================================================

import type { MetricSource } from './descriptions'
import {
  isMetricsTableRow,
  metricsTableCell,
  metricsTableColumnLabel,
  readMetricsTable,
} from '@/lib/survey/metrics-table'
import type {
  ParsedDataShape,
  ResolverContext,
  SourceAttempt,
} from './types'

type ParsedField = NonNullable<NonNullable<ParsedDataShape['fields']>[number]>

// ─── Numeric coercion ────────────────────────────────────────

/**
 * Robustly coerce a survey/document/manual value to a number.
 *
 * Handles the messy formatted strings owners type into the survey:
 *   "84 200 000"  → 84200000   (thin-space / regular-space grouping)
 *   "84 200 000 ₸" → 84200000  (currency suffix/prefix)
 *   "₸84.2М" / "84,2 млн" → 84200000  (abbreviated millions)
 *   "120 тыс" / "120K" → 120000  (abbreviated thousands)
 *
 * Percentage strings ("+15%", "±15%", "-10%") deliberately return
 * `null` — a percentage change is NOT an absolute value and must never
 * be mistaken for revenue/margin. Use `parsePercentChange` for those.
 */
export function coerceNumeric(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'boolean') return raw ? 1 : 0
  if (typeof raw === 'string') {
    let s = raw.trim()
    if (s === '') return null
    // A bare percentage is a relative figure, not an absolute value.
    if (/%/.test(s)) return null

    // Detect a scale suffix (млн/млрд/тыс or a trailing b/m/k/Cyrillic
    // м/к after the digits) before stripping non-numeric chars.
    let multiplier = 1
    if (/(млрд|billion|\d\s*bn?(?![\p{L}\d])|\d\s*млд)/iu.test(s)) multiplier = 1_000_000_000
    else if (/(млн|million|\d\s*m(?![\p{L}\d])|\d\s*м(?![\p{L}\d]))/iu.test(s)) multiplier = 1_000_000
    else if (/(тыс|thousand|\d\s*k(?![\p{L}\d])|\d\s*к(?![\p{L}\d]))/iu.test(s)) multiplier = 1_000

    // Strip currency, spaces, scale words and any remaining letters;
    // normalise decimal comma.
    const cleaned = s
      .replace(/\s|₸|kzt|тг|тенге/gi, '')
      .replace(/,/g, '.')
      .replace(/[^\d.+-]/g, '')
    if (cleaned === '' || cleaned === '-' || cleaned === '+') return null
    const n = Number(cleaned)
    if (!Number.isFinite(n)) return null
    return n * multiplier
  }
  return null
}

/**
 * Parse a percentage-change string into a signed number of percent.
 *   "+15%" → 15 · "-10%" → -10 · "±15%" → 15 · "15" → 15
 * Returns null when no numeric component is present.
 * Used for fields like `s9n_change_vs_2023` so a revenue YoY delta can
 * be derived even when the prior-year absolute revenue was not entered.
 */
export function parsePercentChange(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string') {
    const m = raw.replace(',', '.').match(/-?\d+(?:\.\d+)?/)
    if (!m) return null
    const n = Number(m[0])
    return Number.isFinite(n) ? n : null
  }
  return null
}

// ─── Survey adapter ──────────────────────────────────────────

/**
 * Unwrap the Supabase JSONB `{ value: ... }` envelope if it survived
 * into the resolver context. `gatherResolverContext` normally unwraps
 * this already, but callers that build `surveyAnswers` differently may
 * not — so we defend here to keep the adapter robust.
 */
function unwrapAnswer(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'value' in (raw as Record<string, unknown>)
  ) {
    return (raw as Record<string, unknown>).value
  }
  return raw
}

/** Undefined / null / blank string / empty array — "not answered", never a zero. */
function isUnanswered(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

/** Choice values and free-text answers that mean «no / none». */
const NEGATIVE_ANSWERS = new Set([
  'none', 'no', 'false', '0', '-', '—', 'нет', 'отсутствует', 'не используем', 'не используется', 'никакой', 'никакие',
])

function isNegativeAnswer(value: unknown, extra: readonly string[] = []): boolean {
  if (value === false || value === 0) return true
  if (typeof value !== 'string') return false
  const v = value.trim().toLowerCase()
  return NEGATIVE_ANSWERS.has(v) || extra.some((x) => x.toLowerCase() === v)
}

/** Items of a multi-select (array) or a list typed as text («SEO, SMM; Telegram»). */
function listItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((x) => (typeof x === 'string' ? x.trim() : x == null ? '' : String(x))).filter((x) => x !== '')
  }
  if (typeof value === 'string') return value.split(/[,;\n]+/).map((x) => x.trim()).filter((x) => x !== '')
  return []
}

/**
 * Apply `source.coerce` to an answered value. Returns `{ numeric }` for a hit
 * or `{ miss }` when the answer cannot honestly be turned into a number for
 * this rule (an option outside the map, an empty table cell …).
 */
function coerceSurveyAnswer(
  source: MetricSource,
  value: unknown,
): { numeric: number | null; reason?: string } | { miss: string } {
  const rule = source.coerce
  if (!rule) return { numeric: coerceNumeric(value) }
  switch (rule.kind) {
    case 'flag': {
      if (typeof value === 'boolean') return { numeric: value ? 1 : 0 }
      if (isNegativeAnswer(value, rule.falseValues)) return { numeric: 0 }
      return { numeric: 1 }
    }
    case 'choice': {
      const v = typeof value === 'string' ? value.trim() : String(value)
      const mapped = rule.map[v]
      if (typeof mapped !== 'number') return { miss: `option "${v}" has no numeric meaning for this metric` }
      return { numeric: mapped }
    }
    case 'count_selected': {
      const items = listItems(value).filter((x) => !isNegativeAnswer(x, rule.exclude))
      return { numeric: items.length }
    }
    case 'table_cell': {
      if (!isMetricsTableRow(rule.row)) return { miss: `unknown metrics-table row "${rule.row}"` }
      const hit = metricsTableCell(readMetricsTable(value), rule.row, rule.column ?? 'latest')
      if (!hit) return { miss: `metrics table row "${rule.row}" is empty` }
      return { numeric: hit.value, reason: `metrics table ${rule.row} / ${metricsTableColumnLabel(hit.column)}` }
    }
  }
}

/**
 * Composite survey source: `source.keys` read together. Only
 * `coerce.kind = 'count_selected'` is supported — the number of keys whose
 * answer is a real value (not «нет», not in `exclude`). A miss when none of
 * the keys was answered at all.
 */
function resolveCompositeSurveySource(source: MetricSource, ctx: ResolverContext): SourceAttempt {
  const keys = source.keys ?? []
  if (source.coerce?.kind !== 'count_selected') {
    return { source, status: 'error', reason: 'composite survey source needs coerce.kind = "count_selected"' }
  }
  const exclude = source.coerce.exclude ?? []
  const answered: Record<string, unknown> = {}
  for (const k of keys) {
    const v = unwrapAnswer(ctx.surveyAnswers[k])
    if (!isUnanswered(v)) answered[k] = v
  }
  const answeredKeys = Object.keys(answered)
  if (answeredKeys.length === 0) {
    return { source, status: 'miss', reason: `none of ${keys.join(', ')} answered` }
  }
  const counted = answeredKeys.filter((k) => {
    const v = answered[k]
    if (typeof v === 'boolean') return v
    if (Array.isArray(v)) return listItems(v).some((x) => !isNegativeAnswer(x, exclude))
    return !isNegativeAnswer(v, exclude)
  })
  return {
    source,
    status: 'hit',
    value: counted.length,
    numeric: counted.length,
    confidence: 0.9,
    reason: `${counted.length} of ${answeredKeys.length} answered (${counted.join(', ') || '—'})`,
  }
}

/**
 * Resolve a declared survey-sourced metric against the pre-fetched
 * `surveyAnswers` map. Maps `source.key` (the survey question_key) to
 * the owner's answer, coercing to a number when possible (see
 * `MetricSource.coerce`). Returns a `miss` (never fabricates) when the
 * answer is absent or empty.
 */
export function resolveSurveySource(
  source: MetricSource,
  ctx: ResolverContext,
): SourceAttempt {
  if (source.type !== 'survey') {
    return { source, status: 'error', reason: 'wrong adapter' }
  }
  if (source.keys && source.keys.length > 0) {
    return resolveCompositeSurveySource(source, ctx)
  }
  const key = source.key
  if (!key) {
    return { source, status: 'miss', reason: 'source.key missing' }
  }
  const value = unwrapAnswer(ctx.surveyAnswers[key])

  // Treat undefined / null / empty-string / whitespace / empty-array as
  // "not answered" — missing means miss, never a fabricated zero.
  if (isUnanswered(value)) {
    return { source, status: 'miss', reason: `survey key "${key}" not answered` }
  }

  const coerced = coerceSurveyAnswer(source, value)
  if ('miss' in coerced) {
    return { source, status: 'miss', reason: coerced.miss }
  }

  // Keep a short raw answer (option / yes-no) for provenance; a coerced table
  // or list is represented by its number, not the whole structure.
  const keepRaw = !source.coerce || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number'
  return {
    source,
    status: 'hit',
    value: keepRaw ? value : coerced.numeric,
    numeric: coerced.numeric,
    confidence: 0.9,
    ...(coerced.reason ? { reason: coerced.reason } : {}),
  }
}

// ─── Document adapter ────────────────────────────────────────

function fieldMatchesSource(
  field: ParsedField,
  source: MetricSource,
  metricId: string,
): boolean {
  if (!field) return false
  // Phase 2 binding: prefer explicit metric_id match.
  if (field.metric_id === metricId) return true
  // Fallback: exact key match on source.field.
  if (source.field && field.key === source.field) return true
  return false
}

export function resolveDocumentSource(
  source: MetricSource,
  ctx: ResolverContext,
  metricId: string,
): SourceAttempt {
  if (source.type !== 'document') {
    return { source, status: 'error', reason: 'wrong adapter' }
  }
  if (!ctx.documents.length) {
    return { source, status: 'miss', reason: 'no documents uploaded' }
  }

  // Candidate documents: those matching doc_type (when declared).
  const candidates = ctx.documents.filter((d) =>
    source.doc_type ? d.docType === source.doc_type : true,
  )

  if (!candidates.length) {
    return { source, status: 'miss', reason: `no documents of type "${source.doc_type}"` }
  }

  // Prefer the document closest to the requested period; otherwise newest.
  const sorted = [...candidates].sort((a, b) => {
    if (ctx.preferPeriodYear) {
      const aMatch = a.periodYear === ctx.preferPeriodYear ? 0 : 1
      const bMatch = b.periodYear === ctx.preferPeriodYear ? 0 : 1
      if (aMatch !== bMatch) return aMatch - bMatch
    }
    return b.uploadedAt.localeCompare(a.uploadedAt)
  })

  for (const doc of sorted) {
    const rawFields = doc.parsedData?.fields
    const fields = Array.isArray(rawFields) ? rawFields : []
    const match = fields.find((f) => fieldMatchesSource(f, source, metricId))
    if (match) {
      return {
        source,
        status: 'hit',
        value: match.value,
        numeric: coerceNumeric(match.value),
        confidence: typeof match.confidence === 'number' ? match.confidence : 0.7,
        reason: `from document ${doc.id} (${doc.docType})`,
      }
    }
  }

  return { source, status: 'miss', reason: `field "${source.field}" not found in parsed_data.fields` }
}

// ─── Prisma adapter (Phase 1 stub) ───────────────────────────

export function resolvePrismaSource(
  source: MetricSource,
  ctx: ResolverContext,
): SourceAttempt {
  if (source.type !== 'prisma') {
    return { source, status: 'error', reason: 'wrong adapter' }
  }
  const signals = ctx.prismaSignals
  if (!signals) {
    return { source, status: 'miss', reason: 'prisma signals not pre-fetched' }
  }
  const key = `${source.model ?? ''}.${source.field ?? ''}`
  const value = signals[key]
  if (value === undefined || value === null) {
    return { source, status: 'miss', reason: `prisma key "${key}" not present` }
  }
  return {
    source,
    status: 'hit',
    value,
    numeric: coerceNumeric(value),
    confidence: 0.95,
  }
}

// ─── External adapter (stub) ─────────────────────────────────

export function resolveExternalSource(
  source: MetricSource,
  ctx: ResolverContext,
): SourceAttempt {
  if (source.type !== 'external') {
    return { source, status: 'error', reason: 'wrong adapter' }
  }
  const signals = ctx.externalSignals
  if (!signals || !source.system) {
    return { source, status: 'miss', reason: `external system "${source.system}" not connected` }
  }
  const value = signals[source.system]
  if (value === undefined || value === null) {
    return { source, status: 'miss', reason: `no signal for system "${source.system}"` }
  }
  return {
    source,
    status: 'hit',
    value,
    numeric: coerceNumeric(value),
    confidence: 0.85,
  }
}

// ─── Manual adapter ──────────────────────────────────────────

export function resolveManualSource(
  source: MetricSource,
  ctx: ResolverContext,
  metricId: string,
): SourceAttempt {
  if (source.type !== 'manual') {
    return { source, status: 'error', reason: 'wrong adapter' }
  }
  const value = ctx.manualOverrides?.[metricId]
  if (value === undefined || value === null || value === '') {
    return { source, status: 'miss', reason: 'no manual override' }
  }
  return {
    source,
    status: 'hit',
    value,
    numeric: coerceNumeric(value),
    confidence: 1.0,
  }
}

// ─── Missing adapter ─────────────────────────────────────────

export function resolveMissingSource(source: MetricSource): SourceAttempt {
  return {
    source,
    status: 'miss',
    reason: source.note ?? 'source explicitly marked missing',
  }
}

// ─── Dispatch ────────────────────────────────────────────────

export function tryResolveSource(
  source: MetricSource,
  ctx: ResolverContext,
  metricId: string,
): SourceAttempt {
  switch (source.type) {
    case 'survey':   return resolveSurveySource(source, ctx)
    case 'document': return resolveDocumentSource(source, ctx, metricId)
    case 'prisma':   return resolvePrismaSource(source, ctx)
    case 'external': return resolveExternalSource(source, ctx)
    case 'manual':   return resolveManualSource(source, ctx, metricId)
    case 'missing':  return resolveMissingSource(source)
    default:         return { source, status: 'error', reason: `unknown source type "${(source as MetricSource).type}"` }
  }
}
