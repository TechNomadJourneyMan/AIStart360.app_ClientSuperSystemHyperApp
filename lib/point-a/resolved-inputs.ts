/**
 * lib/point-a/resolved-inputs.ts — metric values that feed the Point A rule
 * engine BEFORE survey answers (calculatePointA's second argument).
 *
 * Only values that did NOT come from the questionnaire are used (documents,
 * manual entries, CRM / external systems): the engine already reads the
 * survey itself, with its own aliases.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PointAResolvedInputs } from '@/lib/point-a-engine'
import type { MetricValue } from '@/lib/metrics/types'

/** Registry ids per engine input, most specific first. */
export const RESOLVED_INPUT_METRICS = {
  ltv: ['goal.04.ltv', 'goal.02.ltv_lifetime_value'],
  cac: ['biz.marketing.cac', 'goal.09.cac', 'goal.01.stoimost_privlecheniya_cac'],
  ltvCacRatio: ['biz.marketing.ltv_cac', 'goal.09.ltv_cac'],
  grossMargin: ['biz.finansy.valovaya_marzha'],
} as const

type InputKey = keyof typeof RESOLVED_INPUT_METRICS

const NON_SURVEY_SOURCES = new Set(['document', 'manual', 'external', 'prisma'])

function build(lookup: (metricId: string) => number | null): PointAResolvedInputs {
  const out: PointAResolvedInputs = {}
  for (const key of Object.keys(RESOLVED_INPUT_METRICS) as InputKey[]) {
    for (const id of RESOLVED_INPUT_METRICS[key]) {
      const v = lookup(id)
      if (v !== null && Number.isFinite(v) && v > 0) {
        out[key] = v
        break
      }
    }
  }
  return out
}

/** From live resolver output (aggregator). */
export function resolvedInputsFromValues(values: ReadonlyArray<MetricValue>): PointAResolvedInputs {
  const byId = new Map(values.map((v) => [v.metricId, v]))
  return build((id) => {
    const v = byId.get(id)
    return v && v.picked && NON_SURVEY_SOURCES.has(v.picked.type) ? v.numeric : null
  })
}

export interface ResolvedMetricRow {
  metric_key: string
  metric_value: number | string | null
  source: string | null
  computed_at?: string | null
}

/** From materialised public.metrics rows (recalculation). Newest non-survey row per key wins. */
export function resolvedInputsFromMetricRows(rows: ReadonlyArray<ResolvedMetricRow>): PointAResolvedInputs {
  const best = new Map<string, ResolvedMetricRow>()
  for (const r of rows) {
    if (!r.source || !NON_SURVEY_SOURCES.has(r.source) || r.metric_value === null) continue
    const prev = best.get(r.metric_key)
    if (!prev || Date.parse(r.computed_at ?? '') > Date.parse(prev.computed_at ?? '')) best.set(r.metric_key, r)
  }
  return build((id) => {
    const r = best.get(id)
    if (!r) return null
    const n = Number(r.metric_value)
    return Number.isFinite(n) ? n : null
  })
}

/** Read the materialised non-survey inputs of a company; any error → no inputs (survey only). */
export async function loadResolvedInputs(client: SupabaseClient, companyId: string | null): Promise<PointAResolvedInputs> {
  if (!companyId) return {}
  const ids = Object.values(RESOLVED_INPUT_METRICS).flat()
  try {
    const { data, error } = await client
      .from('metrics')
      .select('metric_key, metric_value, source, computed_at')
      .eq('company_id', companyId)
      .in('metric_key', ids)
    if (error) return {}
    return resolvedInputsFromMetricRows((data ?? []) as ResolvedMetricRow[])
  } catch {
    return {}
  }
}
