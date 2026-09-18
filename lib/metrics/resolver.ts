// ============================================================
// lib/metrics/resolver.ts
// Pure function that turns a metric id + ResolverContext into
// a MetricValue with full provenance. The DB-fetching cousin
// `gatherResolverContext()` lives in `materialize.ts` so the
// resolver itself remains trivially testable.
// ============================================================

import type { MetricSource, MetricSourceType } from './descriptions'
import { getMetricById, getMetricRegistry } from './registry'
import { tryResolveSource, coerceNumeric } from './source-adapters'
import type {
  MetricEntry,
  MetricValue,
  ResolverContext,
  SourceAttempt,
} from './types'

// ─── Source priority ─────────────────────────────────────────
// Higher = picked sooner. Manual user overrides win; "missing"
// declarations always lose. Document beats survey when the
// number comes from a P&L (richer + period-tagged) but survey
// beats raw external feeds for self-reported strategic fields.

const SOURCE_PRIORITY: Record<MetricSourceType, number> = {
  manual:   100,
  document: 80,
  survey:   70,
  prisma:   60,
  external: 40,
  missing:  0,
}

/**
 * Sanity bound per unit. Percent-type metrics (margins, shares, rates) can
 * never legitimately be in the millions — such a hit means a money field was
 * wired into a «%» metric's source list.
 */
export function isPlausibleForUnit(unit: string, numeric: number | null): boolean {
  if (numeric === null || !Number.isFinite(numeric)) return true // non-numeric text answers pass through
  if (unit === '%') return Math.abs(numeric) <= 10_000
  if (unit === 'days') return Math.abs(numeric) <= 3_650
  return true
}

function priority(src: MetricSource): number {
  return SOURCE_PRIORITY[src.type] ?? 0
}

// ─── Confidence blending ─────────────────────────────────────

function blendConfidence(attempt: SourceAttempt): number {
  const base = attempt.confidence ?? 0
  // Slight prior from source type so equal-confidence document beats survey.
  const prior = priority(attempt.source) / 200
  const blended = Math.min(1, base * 0.85 + prior)
  return Math.round(blended * 100) / 100
}

// ─── Core resolver ───────────────────────────────────────────

export interface ResolveOptions {
  /** Override the registry lookup (test seam). */
  entry?: MetricEntry
}

export function resolveMetric(
  metricId: string,
  ctx: ResolverContext,
  opts: ResolveOptions = {},
): MetricValue {
  const entry = opts.entry ?? getMetricById(metricId)
  const computedAt = ctx.now.toISOString()

  if (!entry) {
    return {
      metricId,
      value: null,
      numeric: null,
      unit: '',
      confidence: 0,
      picked: null,
      considered: [],
      periodYear: ctx.preferPeriodYear ?? null,
      periodQuarter: ctx.preferPeriodQuarter ?? null,
      computedAt,
      notes: `unknown metric id "${metricId}"`,
    }
  }

  // Try every source, sorted by priority. We try them all so
  // the provenance log shows the full picture, not just first-hit.
  const sortedSources = [...entry.sources].sort((a, b) => priority(b) - priority(a))
  const rawAttempts: SourceAttempt[] = sortedSources.map((src) =>
    tryResolveSource(src, ctx, metricId),
  )

  // Unit plausibility gate: a «%» metric must not be fed an absolute money
  // figure (E2E bug: «Валовая маржа = 119.1 млн%» because a ₸ survey key was
  // listed among its sources and won). Implausible hits are downgraded to
  // misses so the provenance log still shows them.
  const attempts: SourceAttempt[] = rawAttempts.map((a) => {
    if (a.status !== 'hit') return a
    const n = a.numeric ?? coerceNumeric(a.value as MetricValue['value'])
    if (isPlausibleForUnit(entry.unit, n)) return a
    const reason = `value ${n} is implausible for unit "${entry.unit}"`
    return { ...a, status: 'miss' as const, reason }
  })

  const hits = attempts.filter((a) => a.status === 'hit')
  if (!hits.length) {
    return {
      metricId,
      value: null,
      numeric: null,
      unit: entry.unit,
      confidence: 0,
      picked: null,
      considered: attempts,
      periodYear: ctx.preferPeriodYear ?? null,
      periodQuarter: ctx.preferPeriodQuarter ?? null,
      computedAt,
      notes: 'no source resolved',
    }
  }

  // Among hits, the highest-priority source wins. Within the same
  // priority bucket the higher raw confidence wins.
  const picked = hits.reduce((best, cur) => {
    const bp = priority(best.source)
    const cp = priority(cur.source)
    if (cp > bp) return cur
    if (cp < bp) return best
    return (cur.confidence ?? 0) > (best.confidence ?? 0) ? cur : best
  })

  const rawValue = picked.value as MetricValue['value']

  return {
    metricId,
    value: rawValue ?? null,
    numeric: picked.numeric ?? coerceNumeric(rawValue),
    unit: entry.unit,
    confidence: blendConfidence(picked),
    picked: picked.source,
    considered: attempts,
    periodYear: ctx.preferPeriodYear ?? null,
    periodQuarter: ctx.preferPeriodQuarter ?? null,
    computedAt,
  }
}

// ─── Batch resolver ──────────────────────────────────────────

export function resolveAllMetrics(ctx: ResolverContext): MetricValue[] {
  return getMetricRegistry().map((entry) =>
    resolveMetric(entry.id, ctx, { entry }),
  )
}

export function resolveMetricsByNamespace(
  ctx: ResolverContext,
  namespace: MetricEntry['namespace'],
): MetricValue[] {
  return getMetricRegistry()
    .filter((e) => e.namespace === namespace)
    .map((entry) => resolveMetric(entry.id, ctx, { entry }))
}

// ─── Aggregations the UI cares about ─────────────────────────

export interface ResolverSummary {
  total: number
  resolved: number
  missing: number
  /** Resolved values keyed by namespace. */
  byNamespace: Record<string, number>
  /** Coverage as a 0..1 ratio. */
  coverage: number
  /** Top data gaps — metric ids the user could fix to improve coverage. */
  topGaps: Array<{ metricId: string; label: string; reason: string }>
}

export function summarize(values: MetricValue[]): ResolverSummary {
  const total = values.length
  const resolved = values.filter((v) => v.picked !== null).length
  const missing = total - resolved

  const byNamespace: Record<string, number> = {}
  for (const v of values) {
    if (v.picked === null) continue
    const ns = v.metricId.split('.')[0] ?? 'unknown'
    byNamespace[ns] = (byNamespace[ns] ?? 0) + 1
  }

  const gaps: ResolverSummary['topGaps'] = []
  for (const v of values) {
    if (v.picked !== null) continue
    const entry = getMetricById(v.metricId)
    if (!entry) continue
    // Prefer gaps that have at least one declared survey source — those
    // are the cheapest for the owner to close.
    const surveyMissing = v.considered.find((a) => a.source.type === 'survey' && a.status === 'miss')
    if (surveyMissing) {
      gaps.push({
        metricId: v.metricId,
        label: entry.label,
        reason: surveyMissing.reason ?? 'survey answer missing',
      })
    }
  }

  return {
    total,
    resolved,
    missing,
    byNamespace,
    coverage: total === 0 ? 0 : Math.round((resolved / total) * 100) / 100,
    topGaps: gaps.slice(0, 10),
  }
}
