/**
 * lib/point-b/planfact/actuals.ts — the FACTS of the months of the plan-fact (spec §13): the monthly reconciliation
 * (pb_monthly_facts) and the month facts of Point A (metric_facts, migration 110). Reads only.
 *
 * Per KPI and month: a manual period value of Point A (an owner's / expert's correction, metric_overrides → a
 * 'manual' fact) wins, then the reconciliation, then the best other fact (survey > document > integration, then
 * confidence). Revenue facts of the YEARLY metric flagged `rescaled` are a month ×12 — divided back (as the model's
 * history does); conversion is in percent like the registry. Facts flagged `invalid` are skipped. Cash comes only
 * from the reconciliation. A failed read of metric_facts = no Point A facts (logged), never a failed recompute.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FACT_SOURCE_PRIORITY, type FactSourceKind } from '@/lib/data-layer/types'
import { REVENUE_GOAL_METRIC } from '@/lib/goals/store'
import { KPI_META, PERIOD_RE } from './kpis'
import { isMissingTable, loadMonthlyFacts, type MonthlyFactRow } from './store'
import { PLAN_KPIS, type Checkpoint, type KpiValues, type PlanKpi } from './types'

export interface MonthActual { values: KpiValues; sources: Checkpoint['actualSources'] }

interface FactRow {
  metric_key: string
  period_key: string
  value: number | string | null
  source_kind: string | null
  flags: string[] | null
  confidence: number | string | null
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const METRIC_KPI: Record<string, PlanKpi> = Object.fromEntries(
  PLAN_KPIS.filter((k) => KPI_META[k].metricKey).map((k) => [KPI_META[k].metricKey as string, k]),
)

/** Point A month facts → per period and KPI the best value with its rank. */
export function bestFacts(rows: FactRow[]): Map<string, Map<PlanKpi, { value: number; rank: number; manual: boolean; confidence: number }>> {
  const out = new Map<string, Map<PlanKpi, { value: number; rank: number; manual: boolean; confidence: number }>>()
  for (const r of rows) {
    const kpi = METRIC_KPI[r.metric_key]
    if (!kpi || !PERIOD_RE.test(String(r.period_key))) continue
    const flags = Array.isArray(r.flags) ? r.flags : []
    if (flags.includes('invalid')) continue
    const raw = r.value === null || r.value === '' ? NaN : Number(r.value)
    if (!finite(raw)) continue
    if (kpi !== 'cash' && raw < 0) continue
    const value = kpi === 'revenue' && r.metric_key === REVENUE_GOAL_METRIC && flags.includes('rescaled') ? raw / 12 : raw
    const rank = FACT_SOURCE_PRIORITY[(r.source_kind ?? '') as FactSourceKind] ?? 0
    const confidence = Number(r.confidence)
    const byKpi = out.get(r.period_key) ?? new Map()
    const cur = byKpi.get(kpi)
    const conf = finite(confidence) ? confidence : 0
    if (!cur || rank > cur.rank || (rank === cur.rank && conf > cur.confidence)) {
      byKpi.set(kpi, { value, rank, manual: r.source_kind === 'manual', confidence: conf })
    }
    out.set(r.period_key, byKpi)
  }
  return out
}

export function mergeActuals(periods: string[], monthly: MonthlyFactRow[], facts: FactRow[]): Record<string, MonthActual> {
  const best = bestFacts(facts)
  const out: Record<string, MonthActual> = {}
  for (const period of periods) {
    const values: KpiValues = {}
    const sources: Checkpoint['actualSources'] = {}
    const fromFacts = best.get(period)
    for (const k of PLAN_KPIS) {
      const f = fromFacts?.get(k)
      const rec = monthly.find((r) => r.period === period && r.metric === k)
      const recValue = rec ? Number(rec.value) : NaN
      if (f?.manual) { values[k] = f.value; sources[k] = 'facts'; continue }
      if (finite(recValue)) { values[k] = recValue; sources[k] = 'reconciliation'; continue }
      if (f) { values[k] = f.value; sources[k] = 'facts' }
    }
    out[period] = { values, sources }
  }
  return out
}

async function loadPointAFacts(sb: SupabaseClient, companyId: string, periods: string[]): Promise<FactRow[]> {
  const keys = Object.keys(METRIC_KPI)
  const { data, error } = await sb.from('metric_facts')
    .select('metric_key, period_key, value, source_kind, flags, confidence')
    .eq('company_id', companyId).in('metric_key', keys).in('period_key', periods).limit(1000)
  if (error) {
    console.error('[point-b/planfact] Point A facts not read — only the reconciliation counts', error.code ?? 'unknown')
    return []
  }
  return (data ?? []) as FactRow[]
}

/**
 * The facts of `periods` (YYYY-MM) for a company plus the raw reconciliation rows since the earliest of them.
 * Migration 132 not applied → no reconciliation rows.
 */
export async function loadActuals(sb: SupabaseClient, companyId: string, periods: string[]): Promise<{ byPeriod: Record<string, MonthActual>; monthly: MonthlyFactRow[] }> {
  const sorted = [...new Set(periods.filter((p) => PERIOD_RE.test(p)))].sort()
  if (!sorted.length) return { byPeriod: {}, monthly: [] }
  const [monthly, facts] = await Promise.all([
    loadMonthlyFacts(sb, companyId, { since: sorted[0] }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      if (!isMissingTable(message)) console.error('[point-b/planfact] monthly facts not read', message)
      return [] as MonthlyFactRow[]
    }),
    loadPointAFacts(sb, companyId, sorted),
  ])
  return { byPeriod: mergeActuals(sorted, monthly, facts), monthly }
}

/**
 * The newest fact of each goal metric in the GOAL's units, from the given months (newest first wins):
 * revenue as an annual run-rate (month × 12), the other KPIs as they are.
 */
export function goalFacts(byPeriod: Record<string, MonthActual>): Record<string, { value: number; period: string }> {
  const out: Record<string, { value: number; period: string }> = {}
  for (const period of Object.keys(byPeriod).sort().reverse()) {
    for (const k of PLAN_KPIS) {
      const metric = KPI_META[k].metricKey
      const v = byPeriod[period].values[k]
      if (!metric || out[metric] || !finite(v)) continue
      out[metric] = { value: k === 'revenue' ? v * 12 : v, period }
    }
  }
  return out
}

/** Revenue months of the reconciliation, for the model's history (a month the history already has is replaced). */
export function withReconciledHistory<T extends { period: string; revenue: number }>(history: T[], monthly: MonthlyFactRow[]): Array<{ period: string; revenue: number }> {
  const byPeriod = new Map(history.map((h) => [h.period, h.revenue]))
  for (const r of monthly) {
    const v = Number(r.value)
    if (r.metric === 'revenue' && finite(v) && v > 0) byPeriod.set(r.period, v)
  }
  return [...byPeriod.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([period, revenue]) => ({ period, revenue }))
}
