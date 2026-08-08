// ============================================================
// Client-side reader for GET /api/v1/metrics/:id/value.
//
// The endpoint returns a real resolved value plus the full
// provenance log (which sources were tried, which one won, why
// the others missed). This module turns that payload into the
// shape `MetricExplainModal` renders — and NOTHING else. If the
// resolver found no source, `value` stays null and the caller
// must render an honest empty state; there is no fallback,
// no heuristic and no estimate anywhere in this file.
// ============================================================

import type { MetricSource } from '@/lib/metrics/format'
import type { ExplainSource } from './MetricExplainModal'

/** Stable registry id for annual revenue (lib/metrics/registry.ts). */
export const REVENUE_YEAR_METRIC_ID = 'biz.finansy.vyruchka_god'

/**
 * Survey keys declared as sources of an absolute-₸ metric that in fact hold a
 * RELATIVE value. `biz.finansy.vyruchka_god` lists `s9n_change_vs_2023`
 * («Изменение к 2023») alongside the two absolute revenue fields
 * (lib/metrics/descriptions.ts:80-82). All three sit in the same priority
 * bucket, so if both absolute fields are blank and only the delta is answered,
 * the resolver hands back e.g. `25` — a percent — and a naive UI would print
 * «25 ₸ / год». We refuse to render that as a level: no value is better than a
 * wrong one. The number is still listed under «откуда взяты данные» so the
 * owner can see what was found.
 */
const RELATIVE_SOURCE_KEYS = new Set(['s9n_change_vs_2023'])

interface RawSourceAttempt {
  source?: MetricSource
  status?: 'hit' | 'miss' | 'error'
  value?: unknown
  numeric?: number | null
  confidence?: number
  reason?: string
}

interface RawProvenance {
  picked?: MetricSource | null
  considered?: RawSourceAttempt[]
  notes?: string
  raw_value?: unknown
}

export interface MetricValuePayload {
  metricId: string
  label: string
  unit: string
  /** Null when no source produced a number. Never a guess. */
  value: number | null
  source: string
  confidence: number | null
  /** Period the value belongs to, straight from the payload. */
  periodYear: number | null
  periodQuarter: string | null
  /** Human name of the source the number was finally taken from. */
  pickedLabel: string | null
  /** Reporting year parsed out of the winning source's own label. */
  pickedYear: number | null
  computedAt: string | null
  fresh: boolean
  sources: ExplainSource[]
  /** Human list of the sources that would unlock the number. */
  missing: string[]
  notes?: string
}

// ─── Source labelling ─────────────────────────────────────────────────────────

/** Human «где именно» line for a declared source. */
export function sourceDetail(src: MetricSource): string {
  switch (src.type) {
    case 'survey':
      return `анкета · шаг ${src.step ?? '?'} · ${src.key ?? ''}`.trim()
    case 'document':
      return `документ ${src.doc_type ?? ''} · поле ${src.field ?? ''}`.trim()
    case 'prisma':
      return `база · ${src.model ?? ''}.${src.field ?? ''}`
    case 'external':
      return `интеграция ${src.system ?? ''}${src.note ? ` · ${src.note}` : ''}`
    case 'manual':
      return src.note ? `ручной ввод · ${src.note}` : 'ручной ввод'
    case 'missing':
      return src.note ?? 'источник не подключён'
  }
}

function sourceTitle(src: MetricSource): string {
  if (src.label) return src.label
  if (src.field) return src.field
  if (src.system) return src.system
  if (src.key) return src.key
  return 'источник'
}

/** What the user has to do to fill this source in. */
function missingHint(src: MetricSource): string | null {
  switch (src.type) {
    case 'survey':
      return `Ответ анкеты «${src.label ?? src.key}» (шаг ${src.step ?? '?'}) не заполнен`
    case 'document':
      return `Не загружен документ «${src.doc_type ?? 'отчёт'}» с полем «${src.field ?? ''}»`
    case 'external':
      return `Интеграция ${src.system ?? ''} не подключена`
    default:
      return null
  }
}

function sameSource(a: MetricSource | null | undefined, b: MetricSource | undefined): boolean {
  if (!a || !b) return false
  return (
    a.type === b.type &&
    a.key === b.key &&
    a.field === b.field &&
    a.doc_type === b.doc_type &&
    a.system === b.system &&
    a.step === b.step
  )
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Turn the raw `{ ok, data }` envelope into a `MetricValuePayload`.
 * Returns null when the response is not a well-formed success — the
 * caller must then show an error state, not an empty one.
 */
export function parseMetricValue(
  json: unknown,
  formatValue: (n: number) => string,
): MetricValuePayload | null {
  const env = json as { ok?: boolean; data?: Record<string, unknown> } | null
  if (!env?.ok || !env.data) return null
  const d = env.data

  const prov = (d.provenance ?? null) as RawProvenance | null
  const picked = prov?.picked ?? null
  const considered = Array.isArray(prov?.considered) ? prov!.considered! : []

  const sources: ExplainSource[] = considered
    .filter((a): a is RawSourceAttempt & { source: MetricSource } => Boolean(a?.source))
    .map((a) => ({
      type: a.source.type,
      label: sourceTitle(a.source),
      detail: sourceDetail(a.source),
      status: a.status ?? 'miss',
      picked: sameSource(picked, a.source),
      confidence: a.confidence,
      value:
        a.status === 'hit' && typeof a.numeric === 'number'
          ? formatValue(a.numeric)
          : a.status === 'hit' && a.value != null
            ? String(a.value)
            : undefined,
      reason: a.reason,
    }))

  const missing = considered
    .filter((a) => a.status !== 'hit' && a.source && a.source.type !== 'missing')
    .map((a) => missingHint(a.source as MetricSource))
    .filter((s): s is string => Boolean(s))

  const rawValue = d.value
  let value =
    typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null

  // Guard: the winning source is a relative field, not a level (see
  // RELATIVE_SOURCE_KEYS). Drop the number and say why.
  if (value !== null && picked?.key && RELATIVE_SOURCE_KEYS.has(picked.key)) {
    value = null
    missing.unshift(
      `Абсолютная выручка не заполнена — найдено только «${picked.label ?? picked.key}», это изменение в процентах, а не сумма`,
    )
  }

  const period = (d.period ?? null) as { year?: unknown; quarter?: unknown } | null

  // Reporting year, read off the source that actually won (labels are
  // «Выручка 2024» / «Выручка 2025 (₸)»). Never guessed.
  const pickedYearMatch = value !== null
    ? `${picked?.label ?? ''} ${picked?.key ?? ''}`.match(/(20\d{2})/)
    : null

  return {
    pickedLabel: value !== null && picked ? sourceTitle(picked) : null,
    pickedYear: pickedYearMatch ? Number(pickedYearMatch[1]) : null,
    metricId: String(d.metric_id ?? ''),
    label: String(d.label ?? ''),
    unit: String(d.unit ?? ''),
    value,
    source: String(d.source ?? 'resolver'),
    confidence:
      typeof d.confidence === 'number' && Number.isFinite(d.confidence)
        ? d.confidence
        : null,
    periodYear: typeof period?.year === 'number' ? period.year : null,
    periodQuarter: typeof period?.quarter === 'string' ? period.quarter : null,
    computedAt: typeof d.computed_at === 'string' ? d.computed_at : null,
    fresh: d.fresh === true,
    sources,
    missing,
    notes: typeof prov?.notes === 'string' ? prov.notes : undefined,
  }
}
