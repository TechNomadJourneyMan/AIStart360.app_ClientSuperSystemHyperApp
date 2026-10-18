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

/** The model (lib/point-b/model) also reads the active client base and the headcount. */
export const POINT_B_ACTIVE_CLIENTS_METRIC = 'biz.klienty.aktivnykh_klientov'
export const POINT_B_HEADCOUNT_METRIC = 'biz.hr.kol_vo_sotrudnikov'

export const POINT_B_METRIC_IDS: readonly string[] = [
  ...Object.values(POINT_B_LEVER_METRICS),
  POINT_B_ACTIVE_CLIENTS_METRIC,
  POINT_B_HEADCOUNT_METRIC,
]

/** Engine options (current revenue + lever values) from the company's current metrics. */
export function pointBOptionsFromMetrics(metrics: CompanyMetrics): Pick<PointBOptions, 'currentRevenueYear' | 'metrics'> {
  const values: Record<string, number | null> = {}
  for (const id of POINT_B_METRIC_IDS) values[id] = metricNumber(metrics, id)
  const revenue = values[POINT_B_LEVER_METRICS.revenue]
  return { currentRevenueYear: revenue !== null && revenue > 0 ? revenue : null, metrics: values }
}

export type PointBMetricOptions = Pick<PointBOptions, 'currentRevenueYear' | 'metrics'>

/** Engine options plus the calendar period of the revenue row ('2024', '2025-Q2'), null when it has none. */
export async function loadPointBMetrics(
  client: SupabaseClient,
  companyId: string | null,
): Promise<{ options: PointBMetricOptions; revenuePeriod: string | null }> {
  if (!companyId) return { options: { currentRevenueYear: null, metrics: {} }, revenuePeriod: null }
  try {
    const metrics = await loadCompanyMetrics(client, companyId, POINT_B_METRIC_IDS)
    const revenue = metrics.get(POINT_B_LEVER_METRICS.revenue)
    const quarter = revenue?.periodQuarter ? Number(String(revenue.periodQuarter).replace(/^q/i, '')) : null
    const revenuePeriod = typeof revenue?.periodYear === 'number'
      ? (quarter && quarter >= 1 && quarter <= 4 ? `${revenue.periodYear}-Q${quarter}` : String(revenue.periodYear))
      : null
    return { options: pointBOptionsFromMetrics(metrics), revenuePeriod }
  } catch (err) {
    console.error('[point-b] metrics read failed — Point B falls back to the questionnaire', err)
    return { options: { currentRevenueYear: null, metrics: {} }, revenuePeriod: null }
  }
}

/** Read them for a company. A failed read is logged and yields no metric values (Point B then reads the survey). */
export async function loadPointBMetricOptions(client: SupabaseClient, companyId: string | null): Promise<PointBMetricOptions> {
  return (await loadPointBMetrics(client, companyId)).options
}
