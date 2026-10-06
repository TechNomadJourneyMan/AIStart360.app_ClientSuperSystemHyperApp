/**
 * lib/metrics/catalog-helpers.ts — pure helpers for /api/v1/metrics/catalog.
 *
 * Kept free of Supabase so they can be unit-tested:
 *   • enrichMetric (+ describeMetric, benchmarkForMetric, targetForMetric,
 *     statusForValue, previousValueFor, trendFor …) — the Point A «Метрики»
 *     fields of every catalog item.
 *   • countByNamespace — tab-bar totals (E2E bug #8: inactive tabs showed 0).
 *   • applyGriSectionScores — fill the 7 GRI block metrics from the latest
 *     GRI assessment (E2E bug #7: catalog said «Нет данных» while /gri showed
 *     7.4–9.0). GRI blocks are scored by the assessment, never by the
 *     survey/document resolver, so the generic materialization can't fill them.
 */

import type { MetricEntry, MetricNamespace } from '@/lib/metrics/types'
import type {
  MetricBenchmark,
  MetricCatalogEnrichment,
  MetricStatus,
  MetricTarget,
  MetricTrend,
} from '@/types/metric-catalog'
import {
  getBizDescription,
  getGoalDescription,
  getGriDescription,
  getKpiDescription,
} from '@/lib/metrics/descriptions'
import { classifyMetric } from '@/lib/metrics/taxonomy'

/** Catalog label (GRI_BLOCK_DESCRIPTIONS key) → gri_assessments.section_avgs key. */
export const GRI_SECTION_BY_LABEL: Readonly<Record<string, string>> = {
  'Продукт и спрос': 'product-demand',
  'Доверие и позиция': 'trust-positioning',
  'Бизнес-модель': 'business-model',
  'Стабильность кассы': 'cash-stability',
  'Операции': 'operations',
  'Команда': 'team',
  'Готовность основателя': 'owner-readiness',
}

export const GRI_SCORE_UNIT = 'из 10'

export function countByNamespace<T extends { namespace: MetricNamespace | string }>(
  entries: ReadonlyArray<T>,
): Record<'all' | 'biz' | 'kpi' | 'gri' | 'goal', number> {
  const counts = { all: 0, biz: 0, kpi: 0, gri: 0, goal: 0 }
  for (const e of entries) {
    counts.all += 1
    if (e.namespace in counts) counts[e.namespace as keyof typeof counts] += 1
  }
  return counts
}

export interface GriOverlayItem {
  namespace: string
  label: string
  value: number | string | null
  unit: string
  confidence: number | null
  source: string | null
  computedAt: string | null
  fresh: boolean
}

export interface GriAssessmentLike {
  section_avgs: Record<string, unknown> | null
  created_at: string | null
}

/**
 * Returns a new item list where GRI items without a resolved value carry the
 * section average from `assessment`. Items with a real materialized value are
 * left untouched. Scores are 0–10; zero means "not scored" and is skipped.
 */
export function applyGriSectionScores<T extends GriOverlayItem>(
  items: ReadonlyArray<T>,
  assessment: GriAssessmentLike | null,
  freshWindowMs: number,
  now: Date = new Date(),
): T[] {
  const avgs = assessment?.section_avgs
  if (!avgs || typeof avgs !== 'object') return [...items]
  const createdAt = assessment?.created_at ?? null
  const ts = createdAt ? Date.parse(createdAt) : NaN
  const fresh = Number.isFinite(ts) && now.getTime() - ts <= freshWindowMs

  return items.map((item) => {
    if (item.namespace !== 'gri' || item.value !== null) return item
    const sectionId = GRI_SECTION_BY_LABEL[item.label]
    if (!sectionId) return item
    const raw = avgs[sectionId]
    const score = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(score) || score <= 0) return item
    return {
      ...item,
      value: Math.round(score * 100) / 100,
      unit: GRI_SCORE_UNIT,
      confidence: 0.9,
      source: 'gri_assessment',
      computedAt: createdAt,
      fresh,
    }
  })
}

// ════════════════════════════════════════════════════════════════════════════
// Catalog enrichment (Point A level 2 — «Метрики»): category, description,
// method, target, benchmark, previous value / delta / trend, status, period,
// provenance. Contract: MetricCatalogEnrichment in types/metric-catalog.ts.
// Pure — the route fetches rows and passes them in.
// ════════════════════════════════════════════════════════════════════════════


/** Registry ids of the annual revenue metric — companies.target_revenue_12m_kzt applies to them. */
export const REVENUE_METRIC_IDS: ReadonlySet<string> = new Set(['biz.finansy.vyruchka_god', 'kpi.obschaya_vyruchka_god'])

/**
 * What the metric measures and how it is calculated, from the code catalog.
 * Never the `current_state` demo texts — they describe a sample company.
 */
export function describeMetric(entry: MetricEntry): { description: string | null; calculationMethod: string | null } {
  let what: string | undefined
  let how: string | undefined
  if (entry.namespace === 'biz' && entry.department) {
    const d = getBizDescription(entry.department, entry.label)
    what = d?.what
    how = d?.how
  } else if (entry.namespace === 'kpi') {
    const d = getKpiDescription(entry.label)
    what = d?.what
    how = d?.how
  } else if (entry.namespace === 'gri') {
    const d = getGriDescription(entry.label)
    what = d?.what
    how = d?.how
  } else if (entry.namespace === 'goal' && entry.goalNumber) {
    const d = getGoalDescription(entry.goalNumber)?.items.find((i) => i.label === entry.label)
    what = d?.what
    how = d?.how || d?.formula
  }
  return { description: what?.trim() || null, calculationMethod: how?.trim() || entry.formula?.trim() || null }
}

const BENCHMARK_RE = /^\s*(≥|>=|>|≤|<=|<)\s*(\d+(?:[.,]\d+)?)\s*(%|x|х|мин)?\s*(?:\/\s*мес|от всех)?\s*$/i

/**
 * Benchmark of a metric, only from labelled code sources: the methodology
 * thresholds of the growth-goal metrics (descriptions.ts `benchmark`, an
 * expert estimate). Parsed only when unambiguous — a single «≥ / ≤ N» with a
 * unit compatible with the metric. «MoM ≥15%», ranges («40–60%»), lists
 * («60% / 40% / 25%») and cross-metric rules («LTV/CAC ≥ 3» on CAC) → null.
 */
export function benchmarkForMetric(entry: MetricEntry): MetricBenchmark | null {
  if (entry.namespace !== 'goal' || !entry.goalNumber) return null
  const raw = getGoalDescription(entry.goalNumber)?.items.find((i) => i.label === entry.label)?.benchmark?.trim()
  if (!raw) return null
  const m = BENCHMARK_RE.exec(raw)
  if (!m) return null
  const value = Number(m[2].replace(',', '.'))
  if (!Number.isFinite(value)) return null
  const rawUnit = (m[3] ?? '').toLowerCase()
  let unit: string
  if (rawUnit === '%') {
    if (entry.unit !== '%') return null
    unit = '%'
  } else if (rawUnit === 'x' || rawUnit === 'х') {
    if (entry.unit !== '') return null
    unit = ''
  } else if (rawUnit === 'мин') {
    unit = 'мин'
  } else {
    unit = entry.unit
  }
  return {
    value,
    unit,
    label: `Ориентир методики AIStart360 (экспертная оценка): ${raw}`,
    kind: 'expert_estimate',
    direction: m[1].startsWith('≥') || m[1].startsWith('>') ? 'higher_is_better' : 'lower_is_better',
  }
}

/** Row of public.metric_targets (migration 085). */
export interface MetricTargetRow {
  metric_key: string
  target_value: number | string
  direction: string
  period_label: string
  source: string
}

const TARGET_SOURCES = new Set(['owner', 'expert', 'agent', 'survey'])
const DIRECTIONS = new Set(['higher_is_better', 'lower_is_better', 'range'])

/**
 * Target of a metric: a metric_targets row (12-month first), else — for the
 * revenue metrics — the owner's 12-month revenue goal (companies.
 * target_revenue_12m_kzt, filled from survey step 1).
 */
export function targetForMetric(
  metricId: string,
  rows: ReadonlyArray<MetricTargetRow>,
  revenueTarget12m: number | null,
): MetricTarget | null {
  const own = rows
    .filter((r) => r.metric_key === metricId)
    .sort((a, b) => Number(b.period_label === '12m') - Number(a.period_label === '12m'))[0]
  if (own) {
    const value = Number(own.target_value)
    if (Number.isFinite(value)) {
      return {
        value,
        periodLabel: own.period_label,
        source: (TARGET_SOURCES.has(own.source) ? own.source : 'owner') as MetricTarget['source'],
        direction: (DIRECTIONS.has(own.direction) ? own.direction : 'higher_is_better') as MetricTarget['direction'],
      }
    }
  }
  if (REVENUE_METRIC_IDS.has(metricId) && revenueTarget12m !== null && revenueTarget12m > 0) {
    return { value: revenueTarget12m, periodLabel: '12m', source: 'survey', direction: 'higher_is_better' }
  }
  return null
}

/** Share of the target reached that still counts as «в плане» / «под угрозой». */
export const STATUS_THRESHOLDS = { onTrack: 0.95, atRisk: 0.8 } as const

export function statusForValue(value: number | null, target: MetricTarget | null): MetricStatus {
  if (value === null || !Number.isFinite(value)) return 'no_data'
  if (!target) return 'no_target'
  const t = target.value
  const grade = (ratio: number): MetricStatus =>
    ratio >= STATUS_THRESHOLDS.onTrack ? 'on_track' : ratio >= STATUS_THRESHOLDS.atRisk ? 'at_risk' : 'off_track'
  switch (target.direction) {
    case 'higher_is_better':
      if (t <= 0) return value >= t ? 'on_track' : 'off_track'
      return grade(value / t)
    case 'lower_is_better':
      if (value <= t) return 'on_track'
      if (value <= 0) return 'on_track'
      return grade(t / value)
    case 'range': {
      if (t === 0) return value === 0 ? 'on_track' : 'off_track'
      const deviation = Math.abs(value - t) / Math.abs(t)
      return deviation <= 1 - STATUS_THRESHOLDS.onTrack ? 'on_track' : deviation <= 1 - STATUS_THRESHOLDS.atRisk ? 'at_risk' : 'off_track'
    }
  }
}

/** Progress 0..100 towards a target in the target's direction (GET /api/v1/metrics/[id]/goals). */
export function goalProgress(value: number | null, target: MetricTarget): number {
  if (value === null || !Number.isFinite(value)) return 0
  let ratio: number
  if (target.direction === 'lower_is_better') ratio = value <= 0 ? 1 : target.value / value
  else if (target.direction === 'range') ratio = target.value === 0 ? (value === 0 ? 1 : 0) : 1 - Math.abs(value - target.value) / Math.abs(target.value)
  else ratio = target.value <= 0 ? (value >= target.value ? 1 : 0) : value / target.value
  return Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10
}

/** Row of public.metric_value_history (migration 085). */
export interface MetricHistoryRow {
  metric_key: string
  value: number | string | null
  source: string | null
  period_year: number | null
  period_quarter: string | null
  period_month: number | null
  recorded_at: string
}

/** Changes smaller than this (in %) read as «flat». */
export const FLAT_TREND_PCT = 1

/**
 * Previous distinct value of the SAME series (metric, source, period) — a
 * switch of source (survey → document) is not a change over time.
 * `history` must be ordered by recorded_at DESC.
 */
export function previousValueFor(
  current: { metric_key: string; value: number; source: string | null; period_year: number | null; period_quarter: string | null; period_month: number | null },
  history: ReadonlyArray<MetricHistoryRow>,
): number | null {
  for (const h of history) {
    if (h.metric_key !== current.metric_key) continue
    if ((h.source ?? null) !== (current.source ?? null)) continue
    if ((h.period_year ?? null) !== (current.period_year ?? null)) continue
    if ((h.period_quarter ?? null) !== (current.period_quarter ?? null)) continue
    if ((h.period_month ?? null) !== (current.period_month ?? null)) continue
    const v = h.value === null ? null : Number(h.value)
    if (v === null || !Number.isFinite(v)) continue
    if (v !== current.value) return v
  }
  return null
}

export function trendFor(value: number | null, previous: number | null): { delta: number | null; deltaPct: number | null; trend: MetricTrend } {
  if (value === null || previous === null) return { delta: null, deltaPct: null, trend: 'unknown' }
  const delta = Math.round((value - previous) * 10_000) / 10_000
  const deltaPct = previous !== 0 ? Math.round((delta / Math.abs(previous)) * 10_000) / 100 : null
  let trend: MetricTrend
  if (delta === 0 || (deltaPct !== null && Math.abs(deltaPct) < FLAT_TREND_PCT)) trend = 'flat'
  else trend = delta > 0 ? 'up' : 'down'
  return { delta, deltaPct, trend }
}

/** «2025», «Q3 2026», «03.2026»; null when the value is not dated. */
export function periodLabelFor(row: { period_year: number | null; period_quarter: string | null; period_month: number | null } | null): string | null {
  if (!row || !row.period_year) return null
  if (row.period_month) return `${String(row.period_month).padStart(2, '0')}.${row.period_year}`
  if (row.period_quarter) return `${row.period_quarter} ${row.period_year}`
  return String(row.period_year)
}

const FACT_SOURCES = new Set(['survey', 'document', 'manual', 'external', 'prisma'])
const CALCULATED_SOURCES = new Set(['calculated', 'resolver', 'gri_assessment'])

/** metrics.source → provenance: stated by the client / a source system = FACT, derived = CALCULATED. */
export function provenanceForSource(source: string | null): 'FACT' | 'CALCULATED' | null {
  if (!source) return null
  if (FACT_SOURCES.has(source)) return 'FACT'
  if (CALCULATED_SOURCES.has(source)) return 'CALCULATED'
  return null
}

export interface EnrichmentContext {
  targets: ReadonlyArray<MetricTargetRow>
  revenueTarget12m: number | null
  /** ordered by recorded_at DESC */
  history: ReadonlyArray<MetricHistoryRow>
}

/** The value row behind a catalog item (latest metrics row), or null. */
export interface ValueRowLike {
  metric_key: string
  value: number | null
  source: string | null
  period_year: number | null
  period_quarter: string | null
  period_month: number | null
  computed_at: string | null
}

export function enrichMetric(entry: MetricEntry, row: ValueRowLike | null, ctx: EnrichmentContext): MetricCatalogEnrichment {
  const placement = classifyMetric(entry)
  const { description, calculationMethod } = describeMetric(entry)
  const target = targetForMetric(entry.id, ctx.targets, ctx.revenueTarget12m)
  const value = row?.value ?? null
  const previous = row && value !== null ? previousValueFor({ ...row, value }, ctx.history) : null
  const t = trendFor(value, previous)
  return {
    category: placement.category,
    categoryLabel: placement.categoryLabel,
    subcategory: placement.subcategory?.key ?? null,
    subcategoryLabel: placement.subcategory?.label ?? null,
    description,
    calculationMethod,
    target,
    benchmark: benchmarkForMetric(entry),
    previousValue: previous,
    delta: t.delta,
    deltaPct: t.deltaPct,
    trend: t.trend,
    status: statusForValue(value, target),
    period: periodLabelFor(row),
    lastUpdated: row?.computed_at ?? null,
    provenanceType: provenanceForSource(row?.source ?? null),
    valueKind: entry.valueKind ?? 'number',
  }
}
