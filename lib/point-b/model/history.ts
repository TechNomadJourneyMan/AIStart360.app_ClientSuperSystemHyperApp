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

export async function loadRevenueHistory(sb: SupabaseClient, companyId: string): Promise<ModelInputs['history']> {
  const { data, error } = await sb
    .from('metric_facts')
    .select('period_key, value, source_kind, flags, confidence')
    .eq('company_id', companyId)
    .eq('metric_key', REVENUE_GOAL_METRIC)
    .limit(2000)
  if (error) {
    console.error('[point-b/model] revenue history not read — the model works without it', error.code ?? 'unknown')
    return []
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
  return [...best.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([period, v]) => ({ period, revenue: v.revenue }))
}
