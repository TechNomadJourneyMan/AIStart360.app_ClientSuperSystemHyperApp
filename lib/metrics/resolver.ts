// ============================================================
// lib/metrics/resolver.ts
// Pure function that turns a metric id + ResolverContext into
// a MetricValue with full provenance. The DB-fetching cousin
// `gatherResolverContext()` lives in `materialize.ts` so the
// resolver itself remains trivially testable.
//
// Order of a metric's sources: manual > document > assessment >
// connected integration (external «integration:…») > survey (current
// wizard) > formula > survey (older-form key) > prisma > other external. A source that yields no number for this
// metric (free text, a range, a value in the wrong unit, outside
// the metric's plausible range) is a miss and never blocks the
// next one. Formula sources are evaluated after their inputs
// (lib/metrics/formulas.ts), in dependency order, cycles refused.
// ============================================================

import type { MetricSource, MetricSourceType } from './format'
import { getMetricById, getMetricRegistry } from './registry'
import { formulaInputIds, getBaseInput, getFormula, type FormulaDef } from './formulas'
import { tryResolveSource } from './source-adapters'
import type {
  FormulaInput,
  MetricEntry,
  MetricValue,
  ResolverContext,
  SourceAttempt,
} from './types'

// ─── Source priority ─────────────────────────────────────────

const SOURCE_PRIORITY: Record<MetricSourceType, number> = {
  manual:     100,
  document:   80,
  assessment: 75,
  survey:     70,
  formula:    65,
  prisma:     60,
  external:   40,
  missing:    0,
}

/** A key the current wizard no longer writes: below a calculation from current answers. */
const LEGACY_SURVEY_PRIORITY = 62

/**
 * A connected integration (external source «integration:…», migration 105) on
 * a metric whose system of record it is (visits from GA4 / Метрика, the online
 * average check from the shop / marketplace, SKU from МойСклад, returns from
 * the marketplace): measured data of the last 30 days beats the owner's
 * one-time survey estimate and a calculation from it, but stays below a
 * manual override, a document the owner uploaded and the GRI assessment.
 * Other external sources (1C, CRM … — no producer) keep the lowest priority.
 * Decision W7, docs/platform/06-integrations.md «Приоритет источников».
 */
const INTEGRATION_NATIVE_PRIORITY = 72

function priority(src: MetricSource): number {
  if (src.type === 'survey' && src.legacy) return LEGACY_SURVEY_PRIORITY
  if (src.type === 'external' && src.system?.startsWith('integration:')) return INTEGRATION_NATIVE_PRIORITY
  return SOURCE_PRIORITY[src.type] ?? 0
}

/**
 * Sanity bound per unit. Percent-type metrics (margins, shares, rates) can
 * never legitimately be in the millions — such a hit means a money field was
 * wired into a «%» metric's source list.
 */
export function isPlausibleForUnit(unit: string, numeric: number | null): boolean {
  if (numeric === null) return true
  if (!Number.isFinite(numeric)) return false
  switch (unit) {
    case '%': return Math.abs(numeric) <= 10_000
    case 'days': return numeric >= 0 && numeric <= 3_650
    case 'count': return numeric >= 0
    case 'из 10': return numeric >= 0 && numeric <= 10
    case 'мес': return numeric >= 0 && numeric <= 600
    case 'мин': return numeric >= 0 && numeric <= 100_000
    default: return true
  }
}

/** Unit bound + the metric's declared range (NPS −100..100, a share 0..100 …). */
export function isPlausibleFor(entry: Pick<MetricEntry, 'unit' | 'range'>, numeric: number | null): boolean {
  if (!isPlausibleForUnit(entry.unit, numeric)) return false
  if (numeric !== null && entry.range) return numeric >= entry.range[0] && numeric <= entry.range[1]
  return true
}

// ─── Confidence blending ─────────────────────────────────────

/**
 * Confidence of the picked source as is. (The old blend added a source-type
 * prior and lifted an OCR reading of 0.55 to 0.87 — the OCR cap of 0.7 was
 * lost on the way to public.metrics. The source order already decides which
 * value wins; confidence reports how sure that value is.)
 */
function blendConfidence(attempt: SourceAttempt): number {
  const base = attempt.confidence ?? 0
  return Math.round(Math.min(1, Math.max(0, base)) * 100) / 100
}

// ─── Session (memo + cycle guard) ────────────────────────────

interface Session {
  ctx: ResolverContext
  memo: Map<string, MetricValue>
  stack: Set<string>
}

function newSession(ctx: ResolverContext): Session {
  return { ctx, memo: new Map(), stack: new Set() }
}

function entryFor(id: string): MetricEntry | undefined {
  return getMetricById(id) ?? getBaseInput(id)
}

function sourceKeyOf(src: MetricSource | null): string | null {
  if (!src) return null
  return src.key ?? src.field ?? src.formula ?? src.section ?? src.system ?? (src.keys ? src.keys.join('+') : null)
}

function inputLabel(id: string): string {
  return entryFor(id)?.label ?? id
}

/** Where the owner can get a missing input: the first current survey question / document field of it. */
function whereToGet(entry: MetricEntry): string {
  const survey = entry.sources.find((s) => s.type === 'survey' && !s.legacy)
  if (survey) return `${entry.label} (анкета, шаг ${survey.step ?? '?'})`
  const doc = entry.sources.find((s) => s.type === 'document')
  if (doc) return `${entry.label} (документ)`
  return entry.label
}

function evaluateFormula(src: MetricSource, entry: MetricEntry, session: Session): SourceAttempt {
  const def: FormulaDef | undefined = getFormula(src.formula)
  if (!def) return { source: src, status: 'error', reason: `unknown formula "${src.formula}"` }
  let best: { missing: string[] } | null = null
  for (const variant of def.variants) {
    const values: Record<string, number> = {}
    const inputs: FormulaInput[] = []
    const missing: string[] = []
    let confidence = 1
    for (const [id] of variant.inputs) {
      const r = resolveWith(id, session)
      if (r.picked === null || r.numeric === null) {
        const e = entryFor(id)
        missing.push(e ? whereToGet(e) : id)
        continue
      }
      values[id] = r.numeric
      confidence = Math.min(confidence, r.confidence)
      inputs.push({
        metricId: id,
        label: inputLabel(id),
        value: r.numeric,
        unit: r.unit,
        source: r.picked.type,
        sourceKey: sourceKeyOf(r.picked),
      })
    }
    if (missing.length > 0) {
      if (!best || missing.length < best.missing.length) best = { missing }
      continue
    }
    const value = variant.compute(values)
    if (value === null || !Number.isFinite(value)) {
      return { source: src, status: 'miss', reason: `${def.text}: inputs give no meaningful value`, inputs }
    }
    const rounded = Math.abs(value) >= 100 ? Math.round(value * 100) / 100 : Math.round(value * 10_000) / 10_000
    return {
      source: src,
      status: 'hit',
      value: rounded,
      numeric: rounded,
      confidence: Math.round(confidence * 0.95 * 100) / 100,
      reason: [def.text, variant.note].filter(Boolean).join('; '),
      inputs,
    }
  }
  return { source: src, status: 'miss', reason: `нужно: ${(best?.missing ?? formulaInputIds(def).map(inputLabel)).join(', ')}` }
}

function unresolvedNeeds(entry: MetricEntry, attempts: SourceAttempt[]): string[] {
  const out: string[] = []
  for (const s of entry.sources) {
    if (s.type === 'survey' && !s.legacy && s.step) out.push(`анкета, шаг ${s.step}: ${s.label ?? s.key ?? ''}`.trim())
    else if (s.type === 'document' && s.field) out.push(`документ: ${s.field}`)
    else if (s.type === 'assessment') out.push(`пройти оценку GRI${s.note ? ` (${s.note})` : ''}`)
  }
  for (const a of attempts) {
    if (a.source.type === 'formula' && a.status === 'miss' && a.reason?.startsWith('нужно: ')) out.push(`расчёт — ${a.reason}`)
    if (a.source.type === 'missing' && a.reason) out.push(a.reason)
  }
  return Array.from(new Set(out)).slice(0, 6)
}

function resolveWith(metricId: string, session: Session, explicit?: MetricEntry): MetricValue {
  const cached = session.memo.get(metricId)
  if (cached) return cached
  const { ctx } = session
  const computedAt = ctx.now.toISOString()
  const entry = explicit ?? entryFor(metricId)

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

  if (session.stack.has(metricId)) {
    return {
      metricId,
      value: null,
      numeric: null,
      unit: entry.unit,
      confidence: 0,
      picked: null,
      considered: [],
      periodYear: ctx.preferPeriodYear ?? null,
      periodQuarter: ctx.preferPeriodQuarter ?? null,
      computedAt,
      notes: 'formula cycle',
    }
  }
  session.stack.add(metricId)

  // Try every source, sorted by priority (stable: declaration order within a
  // priority). We try them all so the provenance log shows the full picture.
  const sorted = [...entry.sources].sort((a, b) => priority(b) - priority(a))
  const raw: SourceAttempt[] = sorted.map((src) =>
    src.type === 'formula' ? evaluateFormula(src, entry, session) : tryResolveSource(src, ctx, metricId, entry),
  )

  // A hit must be a finite number plausible for the metric (unit + range):
  // «Валовая маржа = 119.1 млн%» (a ₸ key wired into a % metric) or an NPS of
  // 810 is downgraded to a miss, which still shows in the provenance log.
  const attempts: SourceAttempt[] = raw.map((a) => {
    if (a.status !== 'hit') return a
    const n = typeof a.numeric === 'number' ? a.numeric : null
    if (n === null || !Number.isFinite(n)) return { ...a, status: 'miss' as const, reason: a.reason ?? 'no numeric value' }
    if (isPlausibleFor(entry, n)) return a
    return { ...a, status: 'miss' as const, reason: `value ${n} is implausible for unit "${entry.unit}"${entry.range ? ` (range ${entry.range[0]}..${entry.range[1]})` : ''}` }
  })

  session.stack.delete(metricId)

  const hits = attempts.filter((a) => a.status === 'hit')
  let result: MetricValue
  if (!hits.length) {
    result = {
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
      needs: unresolvedNeeds(entry, attempts),
    }
  } else {
    // Among hits, the highest-priority source wins. Within the same
    // priority bucket the higher raw confidence wins (declaration order on a tie).
    const picked = hits.reduce((best, cur) => {
      const bp = priority(best.source)
      const cp = priority(cur.source)
      if (cp > bp) return cur
      if (cp < bp) return best
      return (cur.confidence ?? 0) > (best.confidence ?? 0) ? cur : best
    })
    const rawValue = picked.value as MetricValue['value']
    result = {
      metricId,
      value: rawValue ?? null,
      numeric: picked.numeric as number,
      unit: entry.unit,
      confidence: blendConfidence(picked),
      picked: picked.source,
      considered: attempts,
      periodYear: ctx.preferPeriodYear ?? null,
      periodQuarter: ctx.preferPeriodQuarter ?? null,
      computedAt,
    }
  }
  session.memo.set(metricId, result)
  return result
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
  return resolveWith(metricId, newSession(ctx), opts.entry)
}

// ─── Batch resolver ──────────────────────────────────────────

export function resolveAllMetrics(ctx: ResolverContext): MetricValue[] {
  const session = newSession(ctx)
  return getMetricRegistry().map((entry) => resolveWith(entry.id, session, entry))
}

export function resolveMetricsByNamespace(
  ctx: ResolverContext,
  namespace: MetricEntry['namespace'],
): MetricValue[] {
  const session = newSession(ctx)
  return getMetricRegistry()
    .filter((e) => e.namespace === namespace)
    .map((entry) => resolveWith(entry.id, session, entry))
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
