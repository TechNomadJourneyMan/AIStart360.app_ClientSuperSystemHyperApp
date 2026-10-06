/**
 * lib/point-a/resolved-inputs.ts — metric values that feed the Point A rule
 * engine BEFORE its own survey reading (calculatePointA's second argument).
 *
 * Since the metrics overhaul (W4) these are the company's CURRENT metric
 * values from the single source (lib/metrics/company-metrics.ts) — survey,
 * documents (incl. OCR), formulas — exactly what the Metrics catalog, the
 * dashboard and Point B show. The engine falls back to its own survey reading
 * only for inputs no metric holds.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PointAResolvedInputs } from '@/lib/point-a-engine'
import type { MetricValue } from '@/lib/metrics/types'
import {
  companyMetricsFromRows,
  companyMetricsFromValues,
  loadCompanyMetrics,
  type CompanyMetrics,
  type MetricRowLike,
} from '@/lib/metrics/company-metrics'

/** Registry ids per engine input, most specific first. */
export const RESOLVED_INPUT_METRICS = {
  ltv: ['goal.04.ltv', 'goal.02.ltv_lifetime_value'],
  cac: ['biz.marketing.cac', 'goal.09.cac', 'goal.01.stoimost_privlecheniya_cac'],
  ltvCacRatio: ['biz.marketing.ltv_cac', 'goal.09.ltv_cac'],
  grossMargin: ['biz.finansy.valovaya_marzha'],
  dealCycleDays: ['biz.prodazhi.tsikl_zakrytiya_sdelki', 'goal.08.sredniy_tsikl_zakrytiya'],
  repeatSharePct: ['goal.02.repeat_purchase_rate', 'goal.04.repeat_purchase_rate'],
  refusalPct: ['goal.06.loss_rate', 'goal.11.loss_rate'],
} as const

type InputKey = keyof typeof RESOLVED_INPUT_METRICS

/**
 * Inputs that may legitimately be zero or negative. A P&L with a negative gross
 * margin must win over the survey margin (the engine has rules for it); a 0 %
 * repeat share or refusal rate is a real answer. LTV, CAC, LTV/CAC and the deal
 * cycle are only meaningful above zero.
 */
const SIGNED_INPUTS: ReadonlySet<InputKey> = new Set<InputKey>(['grossMargin'])
const NON_NEGATIVE_INPUTS: ReadonlySet<InputKey> = new Set<InputKey>(['repeatSharePct', 'refusalPct'])

function accepts(key: InputKey, v: number): boolean {
  if (!Number.isFinite(v)) return false
  if (SIGNED_INPUTS.has(key)) return true
  if (NON_NEGATIVE_INPUTS.has(key)) return v >= 0
  return v > 0
}

/** Engine inputs from the company's current metrics. */
export function resolvedInputsFromMetrics(metrics: CompanyMetrics): PointAResolvedInputs {
  const out: PointAResolvedInputs = {}
  for (const key of Object.keys(RESOLVED_INPUT_METRICS) as InputKey[]) {
    for (const id of RESOLVED_INPUT_METRICS[key]) {
      const v = metrics.get(id)?.value
      if (v !== undefined && accepts(key, v)) {
        out[key] = v
        break
      }
    }
  }
  return out
}

/** From live resolver output (aggregator). */
export function resolvedInputsFromValues(values: ReadonlyArray<MetricValue>): PointAResolvedInputs {
  return resolvedInputsFromMetrics(companyMetricsFromValues(values))
}

export type ResolvedMetricRow = MetricRowLike

/** From materialised public.metrics rows (recalculation): the current row per key. */
export function resolvedInputsFromMetricRows(rows: ReadonlyArray<ResolvedMetricRow>): PointAResolvedInputs {
  return resolvedInputsFromMetrics(companyMetricsFromRows(rows))
}

/**
 * Read the materialised inputs of a company. A failed read throws: «no
 * values» must never stand in for «could not read them» — the caller would
 * score from the survey alone and present it as the result.
 */
export async function loadResolvedInputs(client: SupabaseClient, companyId: string | null): Promise<PointAResolvedInputs> {
  if (!companyId) return {}
  const ids = Object.values(RESOLVED_INPUT_METRICS).flat()
  try {
    return resolvedInputsFromMetrics(await loadCompanyMetrics(client, companyId, ids))
  } catch (err) {
    const code = err instanceof Error ? err.message.match(/\(([^)]+)\)$/)?.[1] : undefined
    throw new Error(`resolved inputs: metrics read failed (${code ?? 'unknown'})`)
  }
}
