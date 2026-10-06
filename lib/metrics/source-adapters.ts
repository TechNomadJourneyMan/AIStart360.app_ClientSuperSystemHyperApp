// ============================================================
// lib/metrics/source-adapters.ts
// Pure functions that try to resolve a single MetricSource
// against a pre-fetched ResolverContext. Each adapter returns
// a SourceAttempt — never throws.
//
// A hit always carries a finite `numeric`: an answer that is not
// a number for this metric (free text, a range, «8 из 10» on a
// money metric, a percentage for a ₸ metric, a value in $) is a
// MISS with the reason, so the next source gets its turn.
// Formula sources are evaluated by the resolver (they need the
// other metrics), see lib/metrics/resolver.ts.
// ============================================================

import type { MetricSource } from './format'
import {
  isMetricsTableRow,
  metricsTableCell,
  metricsTableColumnLabel,
  readMetricsTable,
} from '@/lib/survey/metrics-table'
import { METRIC_SYNONYMS, matchSynonym } from '@/lib/documents/synonyms'
import { docTypeMatches } from '@/lib/documents/doc-types'
import { coerceNumber, parseNumber, parseScale } from './numbers'
import {
  monthsOf,
  parsePeriodLabel,
  periodFactor,
  periodFromText,
  periodLength,
  periodRank,
  quarterToPeriod,
  type DetectedPeriod,
} from './period'
import type {
  AttemptDocument,
  AttemptPeriod,
  MetricEntry,
  ParsedDataShape,
  ResolverContext,
  ResolverDocument,
  SourceAttempt,
} from './types'

type ParsedField = NonNullable<NonNullable<ParsedDataShape['fields']>[number]>

/** What the adapters need to know about the metric being resolved. */
export type MetricShape = Pick<MetricEntry, 'id' | 'unit' | 'period' | 'range'>

const NO_SHAPE = (id: string): MetricShape => ({ id, unit: '' })

// ─── Numeric coercion ────────────────────────────────────────

/**
 * Coerce a survey/document/manual value to ONE number (lib/metrics/numbers.ts):
 *   "84 200 000" / "84 200 000 ₸" → 84200000 · "₸84.2М" / "84,2 млн" → 84200000
 *   "120 тыс" / "120K" → 120000
 * Free text, ranges («2–3 млн»), ratios («8 из 10») and several numbers → null
 * (never digits glued together). Percentage strings («+15%») → null: a
 * percentage is not an absolute value (use `parsePercentChange`).
 */
export function coerceNumeric(raw: unknown): number | null {
  return coerceNumber(raw)
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

/** Units on a 0..10 scale («8 из 10» → 8). */
function isTenScale(shape: MetricShape): boolean {
  return shape.unit === 'из 10'
}

/**
 * The number an answer / cell holds for `shape`, or a miss reason.
 * `percent` is honoured only for «%» metrics; a 10-scale metric accepts
 * «8 из 10»; a money metric refuses another currency.
 */
function numberFor(
  raw: unknown,
  shape: MetricShape,
): { value: number; period: DetectedPeriod['months'] | null; currency: string | null; percent: boolean } | { miss: string } {
  if (isTenScale(shape)) {
    const v = parseScale(raw, 10)
    return v === null ? { miss: `«${short(raw)}» is not a score on a 0–10 scale` } : { value: v, period: null, currency: null, percent: false }
  }
  const p = parseNumber(raw)
  if (!p) return { miss: `«${short(raw)}» is not a single number` }
  if (p.percent && shape.unit !== '%') return { miss: `«${short(raw)}» is a percentage, the metric is in «${shape.unit || 'number'}»` }
  if (shape.unit === '₸' && p.currency && p.currency !== '₸') return { miss: `value is in ${p.currency}, the metric is in ₸` }
  return { value: p.value, period: p.period ? monthsOf(p.period) : null, currency: p.currency, percent: p.percent }
}

function short(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? String(raw)
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

function periodInfo(
  sourceMonths: number | null,
  shape: MetricShape,
  basis: AttemptPeriod['basis'],
  detected?: DetectedPeriod | null,
): AttemptPeriod {
  const factor = periodFactor(sourceMonths, shape.period)
  return {
    source: sourceMonths ? periodLength(sourceMonths) : null,
    target: shape.period ?? null,
    factor,
    ...(detected ? { year: detected.year, quarter: detected.quarter, month: detected.months === 1 ? detected.endMonth : null } : {}),
    basis,
  }
}

function scaled(value: number, factor: number): number {
  const v = value * factor
  return Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 10_000) / 10_000
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

/** Sum of a numeric column over the rows of a table answer (optionally filtered by another column). */
function tableSum(value: unknown, column: string, match?: { column: string; pattern: string }): { sum: number; rows: number } | null {
  if (!Array.isArray(value)) return null
  let re: RegExp | null = null
  if (match) {
    try {
      re = new RegExp(match.pattern, 'iu')
    } catch {
      return null
    }
  }
  let sum = 0
  let rows = 0
  for (const r of value) {
    if (!r || typeof r !== 'object') continue
    const rec = r as Record<string, unknown>
    if (re && match && !re.test(String(rec[match.column] ?? ''))) continue
    const n = coerceNumber(rec[column])
    if (n === null || n === 0) continue // the table writes 0 for an empty cell
    sum += n
    rows += 1
  }
  return rows > 0 ? { sum, rows } : null
}

/**
 * Apply `source.coerce` to an answered value. Returns `{ numeric }` for a hit
 * or `{ miss }` when the answer cannot honestly be turned into a number for
 * this rule (an option outside the map, an empty table cell, free text …).
 */
function coerceSurveyAnswer(
  source: MetricSource,
  value: unknown,
  shape: MetricShape,
): { numeric: number; months: number | null; reason?: string } | { miss: string } {
  const rule = source.coerce
  const sourceMonths = source.period ? monthsOf(source.period) : null
  if (!rule) {
    const n = numberFor(value, shape)
    if ('miss' in n) return n
    return { numeric: n.value, months: n.period ?? sourceMonths, ...(n.period ? { reason: 'period stated in the answer' } : {}) }
  }
  switch (rule.kind) {
    case 'flag': {
      if (typeof value === 'boolean') return { numeric: value ? 1 : 0, months: null }
      if (isNegativeAnswer(value, rule.falseValues)) return { numeric: 0, months: null }
      return { numeric: 1, months: null }
    }
    case 'choice': {
      const v = typeof value === 'string' ? value.trim() : String(value)
      const mapped = rule.map[v]
      if (typeof mapped !== 'number') return { miss: `option "${v}" has no numeric meaning for this metric` }
      return { numeric: mapped, months: null }
    }
    case 'count_selected': {
      const items = listItems(value).filter((x) => !isNegativeAnswer(x, rule.exclude))
      return { numeric: items.length, months: null }
    }
    case 'table_cell': {
      if (!isMetricsTableRow(rule.row)) return { miss: `unknown metrics-table row "${rule.row}"` }
      const hit = metricsTableCell(readMetricsTable(value), rule.row, rule.column ?? 'latest')
      if (!hit) return { miss: `metrics table row "${rule.row}" is empty` }
      return { numeric: hit.value, months: sourceMonths, reason: `metrics table ${rule.row} / ${metricsTableColumnLabel(hit.column)}` }
    }
    case 'table_sum': {
      const hit = tableSum(value, rule.column, rule.match)
      if (!hit) return { miss: `no numeric "${rule.column}" in the table${rule.match ? ` (rows matching ${rule.match.pattern})` : ''}` }
      return { numeric: hit.sum, months: sourceMonths, reason: `sum of ${rule.column} over ${hit.rows} row(s)` }
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

/** Survey answers are self-reported: confidence 0.9, older-form keys 0.75. */
const SURVEY_CONFIDENCE = 0.9
const LEGACY_SURVEY_CONFIDENCE = 0.75

/**
 * Resolve a declared survey-sourced metric against the pre-fetched
 * `surveyAnswers` map. Maps `source.key` (the survey question_key) to
 * the owner's answer, coercing to a number (see `MetricSource.coerce`) and
 * rescaling a period-tagged value to the metric's period. Returns a `miss`
 * (never fabricates) when the answer is absent, empty or not a number.
 */
export function resolveSurveySource(
  source: MetricSource,
  ctx: ResolverContext,
  shape: MetricShape = NO_SHAPE(''),
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

  if (source.zeroIsEmpty && (value === 0 || value === '0')) {
    return { source, status: 'miss', reason: `survey key "${key}" is 0 — the form writes 0 for an empty field` }
  }

  const coerced = coerceSurveyAnswer(source, value, shape)
  if ('miss' in coerced) {
    return { source, status: 'miss', reason: coerced.miss, ...(source.legacy ? { legacy: true } : {}) }
  }

  const period = periodInfo(coerced.months, shape, coerced.reason === 'period stated in the answer' ? 'answer' : coerced.months ? 'source' : null)
  const numeric = scaled(coerced.numeric, period.factor)

  // Keep a short raw answer (option / yes-no) for provenance; a coerced table
  // or list is represented by its number, not the whole structure.
  const keepRaw = typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number'
  const reasons = [coerced.reason, period.factor !== 1 ? `${period.source} → ${period.target} ×${round4(period.factor)}` : null].filter(Boolean)
  return {
    source,
    status: 'hit',
    value: keepRaw ? value : numeric,
    numeric,
    confidence: source.legacy ? LEGACY_SURVEY_CONFIDENCE : SURVEY_CONFIDENCE,
    ...(reasons.length ? { reason: reasons.join('; ') } : {}),
    ...(period.source || period.factor !== 1 ? { period } : {}),
    ...(source.legacy ? { legacy: true } : {}),
  }
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

// ─── Document adapter ────────────────────────────────────────

const CANONICAL_KEYS = new Set(Object.keys(METRIC_SYNONYMS))

/**
 * Metric-dictionary key of a parsed field: its key when that already is a
 * dictionary key (table extraction writes canonical keys), else the synonym
 * match of its key, then of its label.
 */
export function fieldCanonicalKey(field: Pick<ParsedField, 'key' | 'label'>): string | null {
  const key = typeof field.key === 'string' ? field.key.trim() : ''
  if (key && CANONICAL_KEYS.has(key)) return key
  return (key ? matchSynonym(key) : null) ?? (field.label ? matchSynonym(field.label) : null)
}

function fieldMatchesSource(field: ParsedField, source: MetricSource, metricId: string): boolean {
  if (!field || typeof field !== 'object') return false
  // An explicit binding of the field to this metric (deterministic / AI binder).
  if (field.metric_id === metricId) return true
  if (!source.field) return false
  if (field.key === source.field) return true
  return fieldCanonicalKey(field) === source.field
}

/**
 * Derived facts of row-level documents: a client registry (client_rows) gives
 * the number of active clients (bought within the 12 months before the newest
 * purchase in the file) and the share of clients with 2+ purchases.
 */
export function derivedDocumentFields(doc: ResolverDocument): ParsedField[] {
  const rows = doc.parsedData?.client_rows
  if (!Array.isArray(rows) || rows.length === 0) return []
  const parsed = rows
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : null))
    .filter((r): r is Record<string, unknown> => r !== null)
  const lastDates = parsed
    .map((r) => Date.parse(String(r.last_purchase_date ?? '')))
    .filter((t) => Number.isFinite(t))
  const out: ParsedField[] = []
  if (lastDates.length > 0) {
    const end = Math.max(...lastDates)
    const yearAgo = end - 365 * 24 * 3600 * 1000
    const active = lastDates.filter((t) => t > yearAgo).length
    out.push({
      key: 'active_customers',
      label: 'Активные клиенты (покупка за 12 мес. до последней даты в базе)',
      value: active,
      confidence: 0.8,
      provenance: { document_id: doc.id, method: 'rows' },
    })
  }
  const counts = parsed.map((r) => coerceNumber(r.purchase_count)).filter((n): n is number => n !== null && n > 0)
  if (counts.length >= 10) {
    const repeat = counts.filter((n) => n >= 2).length
    out.push({
      key: 'repeat_rate',
      label: 'Доля клиентов с 2+ покупками (по клиентской базе)',
      value: Math.round((repeat / counts.length) * 1000) / 10,
      unit: '%',
      confidence: 0.8,
      provenance: { document_id: doc.id, method: 'rows' },
    })
  }
  return out
}

/** Period of a document value: field label → document metadata → file name → document text. */
function documentFieldPeriod(field: ParsedField, doc: ResolverDocument): { period: DetectedPeriod | null; basis: AttemptPeriod['basis'] } {
  const fromField = parsePeriodLabel(field.period ?? null)
  if (fromField) {
    // «2025» on a field of a quarterly document: the year names the document, not the span.
    const meta = quarterToPeriod(doc.periodYear, doc.periodQuarter)
    if (fromField.months === 12 && meta && meta.months !== 12 && meta.year === fromField.year && /^\s*\d{4}\s*$/.test(String(field.period))) {
      return { period: meta, basis: 'document' }
    }
    return { period: fromField, basis: 'field' }
  }
  const meta = quarterToPeriod(doc.periodYear, doc.periodQuarter)
  if (meta) return { period: meta, basis: 'document' }
  const fromName = parsePeriodLabel(doc.fileName ?? null)
  if (fromName && fromName.year !== null) return { period: fromName, basis: 'text' }
  const fromText = periodFromText(doc.parsedData?.summary ?? null) ?? periodFromText(doc.parsedData?.raw_text_preview ?? null)
  if (fromText) return { period: fromText, basis: 'text' }
  return { period: null, basis: null }
}

interface DocCandidate {
  doc: ResolverDocument
  field: ParsedField
  numeric: number
  unitConversion: string | null
  period: AttemptPeriod
  detected: DetectedPeriod | null
  confidence: number
}

/** Value of a document field in the metric's unit, or a miss reason. */
function documentNumber(field: ParsedField, shape: MetricShape): { value: number; conversion: string | null } | { miss: string } {
  const unit = typeof field.unit === 'string' ? field.unit.trim() : ''
  const statedPercent = unit === '%' || /%/.test(String(field.label ?? ''))
  if (isTenScale(shape)) {
    const v = parseScale(field.value, 10)
    return v === null ? { miss: 'not a 0–10 score' } : { value: v, conversion: null }
  }
  const p = parseNumber(field.value)
  if (!p) return { miss: `«${short(field.value)}» is not a single number` }
  const percent = p.percent || statedPercent
  if (shape.unit === '%') {
    if (percent) return { value: p.value, conversion: null }
    // A share written as a fraction (0.34) — percent metrics are stored in percent.
    if (Math.abs(p.value) <= 1 && p.value !== 0) {
      return { value: Math.round(p.value * 100 * 10_000) / 10_000, conversion: `доля ${p.value} → ${Math.round(p.value * 100 * 100) / 100}%` }
    }
    return { value: p.value, conversion: null }
  }
  if (percent) return { miss: `value is a percentage, the metric is in «${shape.unit || 'number'}»` }
  const currency = p.currency ?? (/^(\$|usd)$/i.test(unit) ? '$' : /^(€|eur)$/i.test(unit) ? '€' : /^(₽|руб\.?)$/i.test(unit) ? '₽' : null)
  if (shape.unit === '₸' && currency && currency !== '₸') return { miss: `value is in ${currency}, the metric is in ₸` }
  return { value: p.value, conversion: null }
}

function compareCandidates(a: DocCandidate, b: DocCandidate, ctx: ResolverContext): number {
  if (ctx.preferPeriodYear) {
    const am = a.detected?.year === ctx.preferPeriodYear ? 0 : 1
    const bm = b.detected?.year === ctx.preferPeriodYear ? 0 : 1
    if (am !== bm) return am - bm
  }
  // A value that covers exactly the metric's period beats a rescaled one.
  const an = a.period.factor === 1 ? 0 : 1
  const bn = b.period.factor === 1 ? 0 : 1
  if (an !== bn) return an - bn
  // Then the most recent period, then the more confident reading, then the newer upload.
  const ar = periodRank(a.detected)
  const br = periodRank(b.detected)
  if (ar !== br) return br - ar
  if (a.confidence !== b.confidence) return b.confidence - a.confidence
  return b.doc.uploadedAt.localeCompare(a.doc.uploadedAt)
}

export function resolveDocumentSource(
  source: MetricSource,
  ctx: ResolverContext,
  metricId: string,
  shape: MetricShape = NO_SHAPE(metricId),
): SourceAttempt {
  if (source.type !== 'document') {
    return { source, status: 'error', reason: 'wrong adapter' }
  }
  if (!ctx.documents.length) {
    return { source, status: 'miss', reason: 'no documents uploaded' }
  }

  const docs = ctx.documents.filter((d) => docTypeMatches(source.doc_type, d.docType))
  if (!docs.length) {
    return { source, status: 'miss', reason: `no documents of type "${source.doc_type}"` }
  }

  const candidates: DocCandidate[] = []
  const rejected: string[] = []
  for (const doc of docs) {
    const rawFields = doc.parsedData?.fields
    const fields = [...(Array.isArray(rawFields) ? rawFields : []), ...derivedDocumentFields(doc)]
    for (const field of fields) {
      if (!fieldMatchesSource(field, source, metricId)) continue
      const n = documentNumber(field, shape)
      if ('miss' in n) {
        rejected.push(`${doc.id}: ${n.miss}`)
        continue
      }
      const { period: detected, basis } = documentFieldPeriod(field, doc)
      const period = periodInfo(detected?.months ?? null, shape, basis, detected)
      // A rescaled value (quarter → year …) is an estimate: lower confidence.
      const base = typeof field.confidence === 'number' ? field.confidence : 0.7
      const confidence = Math.round(base * (period.factor === 1 ? 1 : 0.85) * 100) / 100
      candidates.push({
        doc,
        field,
        numeric: scaled(n.value, period.factor),
        unitConversion: n.conversion,
        period,
        detected,
        confidence,
      })
    }
  }

  if (!candidates.length) {
    const why = rejected.length ? ` (${rejected.slice(0, 2).join('; ')})` : ''
    return { source, status: 'miss', reason: `field "${source.field}" not found in parsed_data.fields${why}` }
  }

  candidates.sort((a, b) => compareCandidates(a, b, ctx))
  const best = candidates[0]
  const prov = best.field.provenance ?? {}
  const document: AttemptDocument = {
    document_id: best.doc.id,
    doc_type: best.doc.docType,
    field_key: best.field.key,
    field_label: best.field.label ?? null,
    unit: best.field.unit ?? null,
    unit_conversion: best.unitConversion,
    method: prov.method ?? null,
    quote: prov.quote ?? null,
    page: prov.page ?? null,
    sheet: prov.sheet ?? null,
    ...(prov.ocr ? { ocr: true, ocr_engine: prov.ocr_engine ?? null, ocr_page_confidence: prov.ocr_page_confidence ?? null } : {}),
    uploaded_at: best.doc.uploadedAt,
  }
  const notes = [
    `from document ${best.doc.id} (${best.doc.docType})`,
    best.period.factor !== 1 ? `${best.period.source} → ${best.period.target} ×${round4(best.period.factor)}` : null,
    best.unitConversion,
    prov.ocr ? `OCR (${prov.ocr_engine ?? 'engine unknown'})` : null,
    candidates.length > 1 ? `${candidates.length} candidate values, picked by period then recency` : null,
  ].filter(Boolean)
  return {
    source,
    status: 'hit',
    value: best.field.value as SourceAttempt['value'],
    numeric: best.numeric,
    confidence: best.confidence,
    reason: notes.join('; '),
    period: best.period,
    document,
  }
}

// ─── Assessment adapter (GRI section averages) ───────────────

export function resolveAssessmentSource(source: MetricSource, ctx: ResolverContext): SourceAttempt {
  if (source.type !== 'assessment') {
    return { source, status: 'error', reason: 'wrong adapter' }
  }
  const avgs = ctx.griSections
  if (!avgs || !source.section) {
    return { source, status: 'miss', reason: 'no GRI assessment' }
  }
  const raw = avgs[source.section]
  const score = typeof raw === 'number' ? raw : coerceNumber(raw)
  // 0 means «section not scored yet».
  if (score === null || !Number.isFinite(score) || score <= 0) {
    return { source, status: 'miss', reason: `GRI section "${source.section}" not scored` }
  }
  const value = Math.round(score * 100) / 100
  return {
    source,
    status: 'hit',
    value,
    numeric: value,
    confidence: 0.9,
    reason: `GRI assessment${ctx.griAssessedAt ? ` of ${ctx.griAssessedAt.slice(0, 10)}` : ''}, section ${source.section}`,
  }
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
  const numeric = coerceNumber(value)
  if (value === undefined || value === null || numeric === null) {
    return { source, status: 'miss', reason: `prisma key "${key}" not present` }
  }
  return { source, status: 'hit', value: value as SourceAttempt['value'], numeric, confidence: 0.95 }
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
  const numeric = coerceNumber(value)
  if (value === undefined || value === null || numeric === null) {
    return { source, status: 'miss', reason: `no signal for system "${source.system}"` }
  }
  return { source, status: 'hit', value: value as SourceAttempt['value'], numeric, confidence: 0.85 }
}

// ─── Manual adapter ──────────────────────────────────────────

export function resolveManualSource(
  source: MetricSource,
  ctx: ResolverContext,
  metricId: string,
  shape: MetricShape = NO_SHAPE(metricId),
): SourceAttempt {
  if (source.type !== 'manual') {
    return { source, status: 'error', reason: 'wrong adapter' }
  }
  const value = ctx.manualOverrides?.[metricId]
  if (value === undefined || value === null || value === '') {
    return { source, status: 'miss', reason: 'no manual override' }
  }
  const n = numberFor(value, shape)
  if ('miss' in n) return { source, status: 'miss', reason: n.miss }
  return { source, status: 'hit', value: value as SourceAttempt['value'], numeric: n.value, confidence: 1.0 }
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
  shape: MetricShape = NO_SHAPE(metricId),
): SourceAttempt {
  switch (source.type) {
    case 'survey':     return resolveSurveySource(source, ctx, shape)
    case 'document':   return resolveDocumentSource(source, ctx, metricId, shape)
    case 'prisma':     return resolvePrismaSource(source, ctx)
    case 'external':   return resolveExternalSource(source, ctx)
    case 'manual':     return resolveManualSource(source, ctx, metricId, shape)
    case 'assessment': return resolveAssessmentSource(source, ctx)
    case 'formula':    return { source, status: 'error', reason: 'formula sources are evaluated by the resolver' }
    case 'missing':    return resolveMissingSource(source)
    default:           return { source, status: 'error', reason: `unknown source type "${(source as MetricSource).type}"` }
  }
}
