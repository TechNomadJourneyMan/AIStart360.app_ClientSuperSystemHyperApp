/**
 * lib/point-b/planfact/load.ts — the plan-fact part of the Point B page (client) and of the staff panel (spec §13,
 * §15.2). Reads only (service-role client; the callers authorise first). Never recalculates the model: the forecast
 * comes from the stored checkpoints, so the page stays one cheap read.
 *
 *   checkpoints   the newest 12 months of the APPROVED version (oldest first)
 *   progress      every goal of the approved version: base → the newest fact (reconciliation / Point A facts of the last
 *                 6 months) → target, the share of the way and of the time, the forecast date at the stored trend
 *   kpis          the KPIs of the plan (the «Факт за месяц» form asks only these)
 *   reconciliation the last finished month and what is already entered for it
 *   versions      the staff: every version with its content; the client: the approved version with its content and the
 *                 superseded ones as metadata only (number, dates, who approved, the reason — never their content, like
 *                 the RLS of migration 125); newest first, ≤ 10, names of people (never an email)
 * Migration 132 not applied → empty checkpoints and no reconciliation values (the page does not fail).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { expertDisplayName } from '@/lib/expert-review/blocks'
import { goalStart } from '@/lib/goals/evaluate'
import { loadGoals } from '@/lib/goals/store'
import type { PlanGoalItem, PlanVersionRow } from '../plan/types'
import { goalFacts, loadActuals } from './actuals'
import { currentCheckpoint } from './checkpoint'
import { summarizeVersion } from './diff'
import { addPeriods, lastFinishedPeriod, periodOf } from './kpis'
import { planKpis } from './planned'
import { daysSince, goalProgress } from './progress'
import { isMissingTable, listCheckpoints, monthValues } from './store'
import type { Checkpoint, PlanFactState, VersionSummary } from './types'

const VERSIONS_SHOWN = 10

function hideContent(s: VersionSummary): VersionSummary {
  return {
    ...s, goals: [], primaryGoal: null, selectedScenario: null, pace: null, assumptions: [], strategy: [], contentHidden: true,
    totals: { timeToGoalMonths: null, revenueAtDeadline: null, revenueTotal: null, netProfitTotal: null, fundingNeed: null },
  }
}
const FACT_MONTHS = 6
const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

async function quietly<T>(what: string, run: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (!isMissingTable(msg(err))) console.error(`[point-b/planfact] ${what} not read — shown empty`, msg(err))
    return empty
  }
}

/** A goal kept by its label («12m») counts from the start of its horizon, which only the live goal knows. */
async function withStarts(sb: SupabaseClient, companyId: string, items: PlanGoalItem[]): Promise<PlanGoalItem[]> {
  if (!items.some((i) => !i.deadline && !i.baselineAt)) return items
  const live = await loadGoals(sb, companyId)
  const byKey = new Map(live.map((g) => [`${g.metricId}|${g.periodLabel}`, g]))
  return items.map((i) => {
    if (i.deadline || i.baselineAt) return i
    const g = byKey.get(`${i.metricKey}|${i.periodLabel}`)
    const start = g ? goalStart(g) : null
    return start ? { ...i, baselineAt: start } : i
  })
}

async function approverNames(sb: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const { data, error } = await sb.from('profiles').select('id, full_name').in('id', ids)
  if (error) return new Map()
  return new Map(((data ?? []) as Array<{ id: string; full_name: string | null }>).filter((p) => p.full_name?.trim()).map((p) => [p.id, p.full_name!.trim()]))
}

export interface PlanFactLoadInput {
  companyId: string
  /** The approved version (null = none yet). */
  published: PlanVersionRow | null
  /** Every version of the plan, newest first (loadPlanBundle). */
  versions: PlanVersionRow[]
  audience: 'client' | 'staff'
  now: Date
  /** The trend of the page's own calculation, when the checkpoints do not have one. */
  trendMonthlyPct?: number | null
}

export async function loadPlanFactState(sb: SupabaseClient, input: PlanFactLoadInput): Promise<PlanFactState> {
  const { companyId, published, now } = input
  const visible = input.versions
    .filter((v) => input.audience === 'staff' || v.status === 'approved' || v.status === 'superseded')
    .slice(0, VERSIONS_SHOWN)
  const curPeriod = periodOf(now)
  const recPeriod = lastFinishedPeriod(now)
  const months = Array.from({ length: FACT_MONTHS }, (_, i) => addPeriods(curPeriod, i - FACT_MONTHS + 1))

  const [checkpoints, actuals, goals, names] = await Promise.all([
    published ? quietly('checkpoints', () => listCheckpoints(sb, published.id), [] as Checkpoint[]) : Promise.resolve([] as Checkpoint[]),
    published ? quietly('facts', () => loadActuals(sb, companyId, months), { byPeriod: {}, monthly: [] }) : Promise.resolve({ byPeriod: {}, monthly: [] }),
    published ? quietly('goal starts', () => withStarts(sb, companyId, published.goals?.items ?? []), published.goals?.items ?? []) : Promise.resolve([] as PlanGoalItem[]),
    quietly('approvers', () => approverNames(sb, [...new Set(visible.map((v) => v.approved_by).filter((x): x is string => !!x))]), new Map<string, string>()),
  ])

  const current = currentCheckpoint(checkpoints)
  const trend = [...checkpoints].reverse().find((c) => c.forecast.trendMonthlyPct !== null)?.forecast.trendMonthlyPct ?? input.trendMonthlyPct ?? null
  const computedAt = checkpoints.reduce<string | null>((m, c) => (!m || c.computedAt > m ? c.computedAt : m), null)
  const recValues = monthValues(actuals.monthly, recPeriod)
  const planStart = published ? (published.approved_at ?? published.created_at) : null

  return {
    checkpoints,
    current,
    progress: published ? goalProgress({ goals, facts: goalFacts(actuals.byPeriod), revenueTrendMonthlyPct: trend, planStart, now }) : [],
    kpis: published ? planKpis(published) : [],
    reconciliation: { period: recPeriod, done: Object.keys(recValues).length > 0, values: recValues },
    computedAt,
    staleDays: daysSince(computedAt, now),
    versions: visible.map((v) => {
      const summary = summarizeVersion(v, { approverName: v.approved_by ? names.get(v.approved_by) ?? null : null })
      if (input.audience === 'staff') return summary
      // The client: a person's name, never an email; of a superseded version only what it was and why it changed.
      const named = { ...summary, authorName: v.author_kind === 'system' ? null : expertDisplayName(v.author_name) }
      return v.status === 'approved' ? named : hideContent(named)
    }),
  }
}
