/**
 * lib/point-b/metrics.ts — the metric values Point B reads, from the single
 * source every surface uses (lib/metrics/company-metrics.ts).
 *
 * Replaces the old «newest revenue row by period_year, .limit(1)» lookup:
 * resolver rows carry no period_year, so that query returned an arbitrary row
 * of either revenue metric and source.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCompanyMetrics, metricNumber, type CompanyMetrics } from '@/lib/metrics/company-metrics'
import { POINT_B_LEVER_METRICS, type PointBOptions } from './engine'

export const POINT_B_METRIC_IDS: readonly string[] = Object.values(POINT_B_LEVER_METRICS)

/** Engine options (current revenue + lever values) from the company's current metrics. */
export function pointBOptionsFromMetrics(metrics: CompanyMetrics): Pick<PointBOptions, 'currentRevenueYear' | 'metrics'> {
  const values: Record<string, number | null> = {}
  for (const id of POINT_B_METRIC_IDS) values[id] = metricNumber(metrics, id)
  const revenue = values[POINT_B_LEVER_METRICS.revenue]
  return { currentRevenueYear: revenue !== null && revenue > 0 ? revenue : null, metrics: values }
}

/** Read them for a company. A failed read is logged and yields no metric values (Point B then reads the survey). */
export async function loadPointBMetricOptions(
  client: SupabaseClient,
  companyId: string | null,
): Promise<Pick<PointBOptions, 'currentRevenueYear' | 'metrics'>> {
  if (!companyId) return { currentRevenueYear: null, metrics: {} }
  try {
    return pointBOptionsFromMetrics(await loadCompanyMetrics(client, companyId, POINT_B_METRIC_IDS))
  } catch (err) {
    console.error('[point-b] metrics read failed — Point B falls back to the questionnaire', err)
    return { currentRevenueYear: null, metrics: {} }
  }
}
