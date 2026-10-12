/**
 * lib/goals/current.ts — goals of a company with their evaluation against the
 * current metric values (lib/metrics/company-metrics.ts — the same values
 * every surface shows).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCompanyMetrics, type CompanyMetricValue } from '@/lib/metrics/company-metrics'
import { evaluateGoal, type Goal, type GoalEvaluation } from './evaluate'
import { loadGoals } from './store'

/** Calendar period of a current metric value ('2026-10', '2025' …) from its provenance. */
export function valuePeriod(v: CompanyMetricValue | undefined): string | null {
  if (!v) return null
  const p = (v.provenance as { period?: { year?: number | null; month?: number | null; quarter?: string | null } } | null)?.period
  if (p && typeof p.year === 'number') {
    return typeof p.month === 'number' ? `${p.year}-${String(p.month).padStart(2, '0')}` : p.quarter ? `${p.year}-${p.quarter}` : String(p.year)
  }
  return v.periodYear ? String(v.periodYear) : null
}

export interface GoalWithEvaluation {
  goal: Goal
  evaluation: GoalEvaluation
}

export function evaluateGoals(goals: readonly Goal[], metrics: ReadonlyMap<string, CompanyMetricValue>, now: Date): GoalWithEvaluation[] {
  return goals.map((goal) => {
    const v = metrics.get(goal.metricId)
    return { goal, evaluation: evaluateGoal(goal, { value: v?.value ?? null, period: valuePeriod(v) }, now) }
  })
}

export async function loadGoalsWithEvaluation(client: SupabaseClient, companyId: string, now = new Date()): Promise<GoalWithEvaluation[]> {
  const goals = await loadGoals(client, companyId)
  if (!goals.length) return []
  const metrics = await loadCompanyMetrics(client, companyId, [...new Set(goals.map((g) => g.metricId))])
  return evaluateGoals(goals, metrics, now)
}
