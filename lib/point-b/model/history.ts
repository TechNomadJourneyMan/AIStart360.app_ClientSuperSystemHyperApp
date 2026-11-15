/**
 * lib/point-b/model/history.ts — the monthly revenue history from the data layer (the ONLY IO of
 * the model besides load.ts).
 *
 * Reads `metric_facts` (migration 110: metric_key, period_key '2025-03', value NUMERIC, source_kind,
 * flags, confidence) of `biz.finansy.vyruchka_god`. Only MONTH periods are used; annual and
 * quarterly facts are never spread over months. Per month the best source wins (manual > survey >
 * document > integration, then confidence); invalid values are skipped.
 *
 * The metric is a YEARLY one, so the data layer stores a monthly figure from a document or the
 * questionnaire ×12 and flags it `rescaled` (lib/data-layer/facts.ts): that value is divided by 12
 * here to get the month's revenue back. Integration and manual facts are stored as they are.
 *
 * R3 (M2): ONE history for the overview, the recompute and the plan-fact — the revenue months the owner typed
 * («Финмодель → Выручка по месяцам», source revenue_history, migration 151) and the «Факт за месяц» of the
 * reconciliation (pb_monthly_facts, 132) are merged in and WIN over the data layer for their month (the owner's own
 * figure). A missing table (migration 132 not applied) or a failed read → the data layer alone (logged).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FACT_SOURCE_PRIORITY, type FactSourceKind } from '@/lib/data-layer/types'
import { REVENUE_GOAL_METRIC } from '@/lib/goals/store'
import type { ModelInputs } from './types'

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

interface FactRow {
  period_key: string
  value: number | string | null
  source_kind: string | null
  flags: string[] | null
  confidence: number | string | null
}

/** The revenue months of pb_monthly_facts (any source): the owner's history and the reconciliation. */
export async function loadMonthlyRevenue(sb: SupabaseClient, companyId: string): Promise<Array<{ period: string; revenue: number }>> {
  const { data, error } = await sb
    .from('pb_monthly_facts')
    .select('period, value')
    .eq('company_id', companyId)
    .eq('metric', 'revenue')
    .limit(400)
  if (error) {
    if (!/^(42P01|PGRST205)$/.test(error.code ?? '')) console.error('[point-b/model] monthly revenue not read — the data layer alone', error.code ?? 'unknown')
    return []
  }
  const out: Array<{ period: string; revenue: number }> = []
  for (const r of (data ?? []) as Array<{ period: string; value: number | string | null }>) {
    const v = r.value === null || r.value === '' ? NaN : Number(r.value)
    if (MONTH_RE.test(String(r.period)) && Number.isFinite(v) && v > 0) out.push({ period: r.period, revenue: v })
  }
  return out
}

/**
 * The monthly revenue history of a company, oldest first. `monthly: false` = the data layer only (the «Финмодель»
 * table merges the stored months itself, with their source).
 */
export async function loadRevenueHistory(sb: SupabaseClient, companyId: string, opts: { monthly?: boolean } = {}): Promise<ModelInputs['history']> {
  const [{ data, error }, monthly] = await Promise.all([
    sb
      .from('metric_facts')
      .select('period_key, value, source_kind, flags, confidence')
      .eq('company_id', companyId)
      .eq('metric_key', REVENUE_GOAL_METRIC)
      .limit(2000),
    opts.monthly === false ? Promise.resolve([] as Array<{ period: string; revenue: number }>) : loadMonthlyRevenue(sb, companyId),
  ])
  if (error) {
    console.error('[point-b/model] revenue history not read — the model works without it', error.code ?? 'unknown')
    return mergeMonthly([], monthly)
  }

  const best = new Map<string, { revenue: number; rank: number; confidence: number }>()
  for (const r of (data ?? []) as FactRow[]) {
    if (!MONTH_RE.test(String(r.period_key))) continue
    const flags = Array.isArray(r.flags) ? r.flags : []
    if (flags.includes('invalid')) continue
    const raw = r.value === null || r.value === '' ? NaN : Number(r.value)
    if (!Number.isFinite(raw) || raw <= 0) continue
    const revenue = flags.includes('rescaled') ? raw / 12 : raw
    const rank = FACT_SOURCE_PRIORITY[(r.source_kind ?? '') as FactSourceKind] ?? 0
    const confidence = Number(r.confidence)
    const cur = best.get(r.period_key)
    if (!cur || rank > cur.rank || (rank === cur.rank && (Number.isFinite(confidence) ? confidence : 0) > cur.confidence)) {
      best.set(r.period_key, { revenue, rank, confidence: Number.isFinite(confidence) ? confidence : 0 })
    }
  }
  const facts = [...best.entries()].map(([period, v]) => ({ period, revenue: v.revenue }))
  return mergeMonthly(facts, monthly)
}

/** The stored months win for their month; oldest first. */
export function mergeMonthly(facts: ModelInputs['history'], monthly: Array<{ period: string; revenue: number }>): ModelInputs['history'] {
  const byPeriod = new Map(facts.map((h) => [h.period, h.revenue]))
  for (const m of monthly) byPeriod.set(m.period, m.revenue)
  return [...byPeriod.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([period, revenue]) => ({ period, revenue }))
}
