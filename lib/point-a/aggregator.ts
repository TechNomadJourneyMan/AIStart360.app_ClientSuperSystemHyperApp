// ============================================================
// lib/point-a/aggregator.ts
// Phase 4 — Aggregator v2.
// Combines the legacy rule-based PointA with the Phase-1 metric
// resolver to produce a richer PointA payload that includes
// department breakdowns, top strengths/gaps, and coverage stats.
// The legacy `calculatePointA` output is preserved bit-for-bit;
// the new intelligence lives under `PointA.intelligence`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PointA, PointAIntelligence } from '@/types/onboarding'
import { calculatePointA } from '@/lib/point-a-engine'
import {
  gatherResolverContext,
  materializeAll,
} from '@/lib/metrics/materialize'
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
    trends: [], // Phase 5 will populate from history snapshots.
    generated_at: new Date().toISOString(),
    resolver_version: RESOLVER_VERSION,
  }
}

/**
 * Top-level Phase 4 aggregator.
 *
 * 1. Gather resolver context (survey + documents) from Supabase.
 * 2. Compute the rule-based PointA from the survey answers.
 * 3. Run the full metric resolver to get values + provenance.
 * 4. (Optional) Best-effort write to `public.metrics` so the UI
 *    can subscribe to realtime changes. Failures are logged and
 *    swallowed — the API still returns a useful payload.
 * 5. Build the `intelligence` block and merge it into PointA.
 */
export async function aggregatePointA(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
  opts: AggregateOptions = {},
): Promise<PointA> {
  const ctx = await gatherResolverContext(supabase, { userId, companyId })

  const basePointA = calculatePointA(ctx.surveyAnswers)

  const values = resolveAllMetrics(ctx)

  if (!opts.skipMaterialize) {
    try {
      await materializeAll(supabase, ctx)
    } catch (err) {
      // Best-effort: never fail the aggregator over a write error.
      const message = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.warn(`[point-a/aggregator] materializeAll failed: ${message}`)
    }
  }

  const intelligence = buildIntelligence(values)

  return {
    ...basePointA,
    intelligence,
  }
}
