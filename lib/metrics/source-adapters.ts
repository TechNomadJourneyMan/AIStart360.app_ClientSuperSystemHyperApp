// ============================================================
// lib/metrics/source-adapters.ts
// Pure functions that try to resolve a single MetricSource
// against a pre-fetched ResolverContext. Each adapter returns
// a SourceAttempt — never throws.
// ============================================================

import type { MetricSource } from './descriptions'
import type {
  ParsedDataShape,
  ResolverContext,
  SourceAttempt,
} from './types'

type ParsedField = NonNullable<NonNullable<ParsedDataShape['fields']>[number]>

// ─── Numeric coercion ────────────────────────────────────────

export function coerceNumeric(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'boolean') return raw ? 1 : 0
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/\s|₸|kzt|тг|тенге/gi, '').replace(',', '.')
    if (cleaned === '' || cleaned === '-') return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// ─── Survey adapter ──────────────────────────────────────────

export function resolveSurveySource(
  source: MetricSource,
  ctx: ResolverContext,
): SourceAttempt {
  if (source.type !== 'survey') {
    return { source, status: 'error', reason: 'wrong adapter' }
  }
  const key = source.key
  if (!key) {
    return { source, status: 'miss', reason: 'source.key missing' }
  }
  const value = ctx.surveyAnswers[key]
  if (value === undefined || value === null || value === '') {
    return { source, status: 'miss', reason: `survey key "${key}" not answered` }
  }
  return {
    source,
    status: 'hit',
    value,
    numeric: coerceNumeric(value),
    confidence: 0.9,
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
    const fields = doc.parsedData?.fields ?? []
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
