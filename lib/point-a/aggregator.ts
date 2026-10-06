// ============================================================
// lib/point-a/aggregator.ts
// Phase 4 — Aggregator v2.
// Combines the rule-based PointA with the Phase-1 metric
// resolver to produce a richer PointA payload that includes
// department breakdowns, top strengths/gaps, and coverage stats.
// Metric values that come from documents / manual / external
// sources feed the rule engine before survey answers
// (lib/point-a/resolved-inputs.ts); the new intelligence lives
// under `PointA.intelligence`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PointA, PointAIntelligence } from '@/types/onboarding'
import { calculatePointA } from '@/lib/point-a-engine'
import {
  gatherResolverContext,
  materializeAll,
  toMaterializedRow,
} from '@/lib/metrics/materialize'
import { isMissingTable, previousValueFor, trendFor, type MetricHistoryRow } from '@/lib/metrics/catalog-helpers'
import type { MetricValue } from '@/lib/metrics/types'
import { resolvedInputsFromValues } from './resolved-inputs'
import { resolveAllMetrics } from '@/lib/metrics/resolver'
import { getMetricRegistry } from '@/lib/metrics/registry'
import {
  buildByDepartment,
  buildTopStrengths,
  buildTopGaps,
} from './helpers'

export interface AggregateOptions {
  /**
   * When true, skip the best-effort upsert into `public.metrics`.
   * GET handlers pass this; POST handlers do not.
   */
  skipMaterialize?: boolean
  /**
   * Client used for the upsert into `public.metrics`. Routes pass the service
   * role (lib/supabase-service.ts) after authorising the company: since
   * migration 088 authenticated users cannot write metrics. Defaults to the
   * read client (tests / scripts).
   */
  writeClient?: SupabaseClient
  /** 'company' = the company's documents, not only the owner's uploads. */
  documentsScope?: 'user' | 'company'
}

const RESOLVER_VERSION = 'phase4-v1'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Build the `intelligence` block from a list of resolved metric
 * values + the catalog entries. Pure function — no DB.
 */
function buildIntelligence(
  values: ReturnType<typeof resolveAllMetrics>,
  trends: PointAIntelligence['trends'],
): PointAIntelligence {
  const entries = getMetricRegistry()

  const by_department = buildByDepartment(values, entries)
  const top_strengths = buildTopStrengths(values, entries)
  const top_gaps = buildTopGaps(values, entries)

  // Per-namespace coverage.
  const namespaces = ['biz', 'kpi', 'gri', 'goal'] as const
  const coverage = {
    biz: 0,
    kpi: 0,
    gri: 0,
    goal: 0,
    overall: 0,
  } as PointAIntelligence['coverage']

  for (const ns of namespaces) {
    const inNs = values.filter((v) => v.metricId.startsWith(`${ns}.`))
    const resolved = inNs.filter((v) => v.picked !== null).length
    coverage[ns] = inNs.length === 0 ? 0 : round2(resolved / inNs.length)
  }
  const totalResolved = values.filter((v) => v.picked !== null).length
  coverage.overall =
    values.length === 0 ? 0 : round2(totalResolved / values.length)

  return {
    by_department,
    top_strengths,
    top_gaps,
    coverage,
    trends,
    generated_at: new Date().toISOString(),
    resolver_version: RESOLVER_VERSION,
  }
}

/**
 * Trends of the resolved values against metric_value_history (pure): the
 * previous distinct value of the same series (metric, source, period) →
 * direction + relative change. Metrics without such a previous value (or with
 * a previous value of 0, where a percentage is undefined) are left out.
 */
export function buildTrends(
  values: ReadonlyArray<MetricValue>,
  history: ReadonlyArray<MetricHistoryRow>,
  companyId: string,
): PointAIntelligence['trends'] {
  const out: PointAIntelligence['trends'] = []
  for (const v of values) {
    if (v.picked === null || v.numeric === null) continue
    const row = toMaterializedRow(v, companyId)
    const previous = previousValueFor({
      metric_key: v.metricId,
      value: v.numeric,
      source: row.source,
      period_year: row.period_year,
      period_quarter: row.period_quarter,
      period_month: null,
    }, history)
    const t = trendFor(v.numeric, previous)
    if (t.trend === 'unknown' || t.deltaPct === null) continue
    out.push({ metric_id: v.metricId, direction: t.trend, delta_pct: t.deltaPct })
  }
  return out
}

/** History of the resolved metrics (newest first). Missing table (before 085) → none; other errors throw. */
async function loadHistory(
  supabase: SupabaseClient,
  companyId: string,
  values: ReadonlyArray<MetricValue>,
): Promise<MetricHistoryRow[]> {
  const ids = values.filter((v) => v.picked !== null && v.numeric !== null).map((v) => v.metricId)
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('metric_value_history')
    .select('metric_key, value, source, period_year, period_quarter, period_month, recorded_at')
    .eq('company_id', companyId)
    .in('metric_key', ids)
    .order('recorded_at', { ascending: false })
    .limit(2000)
  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(`point-a aggregate: metric history failed (${error.code ?? 'unknown'})`)
  }
  return (data ?? []) as MetricHistoryRow[]
}

/**
 * Top-level Phase 4 aggregator.
 *
 * 1. Gather resolver context (survey + documents) from Supabase.
 * 2. Run the full metric resolver to get values + provenance.
 * 3. Compute the rule-based PointA from the survey answers, with
 *    document / manual metric values taking precedence.
 * 4. (Optional) Best-effort write to `public.metrics` so the UI
 *    can subscribe to realtime changes. Failures are logged and
 *    swallowed — the API still returns a useful payload.
 * 5. Build the `intelligence` block (trends from metric_value_history)
 *    and merge it into PointA.
 */
export async function aggregatePointA(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
  opts: AggregateOptions = {},
): Promise<PointA> {
  const ctx = await gatherResolverContext(supabase, { userId, companyId, documentsScope: opts.documentsScope })

  const values = resolveAllMetrics(ctx)

  const basePointA = calculatePointA(ctx.surveyAnswers, resolvedInputsFromValues(values))
  // Read before materialising: the trend compares with what was stored before this run.
  const history = await loadHistory(supabase, companyId, values)

  if (!opts.skipMaterialize) {
    try {
      await materializeAll(opts.writeClient ?? supabase, ctx)
    } catch (err) {
      // Best-effort: never fail the aggregator over a write error.
      const message = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.warn(`[point-a/aggregator] materializeAll failed: ${message}`)
    }
  }

  const intelligence = buildIntelligence(values, buildTrends(values, history, companyId))

  return {
    ...basePointA,
    intelligence,
  }
}
