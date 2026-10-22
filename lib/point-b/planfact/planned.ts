/**
 * lib/point-b/planfact/planned.ts — what the APPROVED plan version planned for a month (spec §13). Pure.
 *
 * The version keeps its scenarios (ScenarioResult[] of the model) and the summary of the calculation
 * (`assumptions.model.computedAt`). Month 0 of a scenario trajectory is the month of that calculation (the plan
 * start); a period P is month m = P − start. For m < 0 the plan says nothing (no planned values).
 *   revenue     trajectory[m].base / 12 (the annual run-rate of the month), band low / high
 *   leads, conversion (percent), avg_check   linear from `current` to `target` over the ramp of the pace profile
 *               (assumptions.profiles, else the default ramp of the pace) — the model moves the levers the same way
 *   cash        finance.cash[m − 1] (level 2 only; month 0 has no planned cash)
 * The scenario is the selected one, else «Умеренный», else the first stored one.
 */
import type { ScenarioResult } from '../model/types'
import { periodOf, periodOrdinal } from './kpis'
import type { KpiValues, PlanKpi } from './types'

export interface PlannedVersion {
  id: string
  scenarios: unknown
  selected_scenario: string | null
  assumptions: Record<string, unknown> | null
  approved_at?: string | null
  created_at: string
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const DEFAULT_RAMP: Record<string, number> = { cautious: 18, moderate: 12, aggressive: 6 }

export function storedScenarios(raw: unknown): ScenarioResult[] {
  return Array.isArray(raw)
    ? (raw.filter((s) => s && typeof s === 'object' && typeof (s as { key?: unknown }).key === 'string') as ScenarioResult[])
    : []
}

export function planScenario(v: Pick<PlannedVersion, 'scenarios' | 'selected_scenario'>): ScenarioResult | null {
  const list = storedScenarios(v.scenarios)
  if (!list.length) return null
  return (v.selected_scenario ? list.find((s) => s.key === v.selected_scenario) : undefined)
    ?? list.find((s) => s.key === 'moderate')
    ?? list[0]
}

/** YYYY-MM of month 0 of the plan: the calculation of the scenarios, else the approval, else the creation. */
export function planStartPeriod(v: Pick<PlannedVersion, 'assumptions' | 'approved_at' | 'created_at'>): string | null {
  const model = (v.assumptions?.model ?? null) as { computedAt?: unknown } | null
  for (const at of [model?.computedAt, v.approved_at, v.created_at]) {
    if (typeof at === 'string' && Number.isFinite(Date.parse(at))) return periodOf(new Date(at))
  }
  return null
}

export function rampOf(v: Pick<PlannedVersion, 'assumptions'>, key: string): number {
  const profiles = v.assumptions?.profiles
  if (Array.isArray(profiles)) {
    const p = profiles.find((x) => x && typeof x === 'object' && (x as { key?: unknown }).key === key) as { rampMonths?: unknown } | undefined
    if (p && finite(p.rampMonths) && p.rampMonths > 0) return p.rampMonths
  }
  return DEFAULT_RAMP[key] ?? 12
}

const LEVER_KPI: Record<string, PlanKpi> = { leads: 'leads', conversion: 'conversion', avgCheck: 'avg_check' }

/** The KPIs the approved plan has numbers for (what the «Факт за месяц» form asks and what the verdict checks). */
export function planKpis(v: Pick<PlannedVersion, 'scenarios' | 'selected_scenario'>): PlanKpi[] {
  const sc = planScenario(v)
  if (!sc) return []
  const out: PlanKpi[] = []
  if (sc.trajectory?.some((p) => finite(p.base) && p.base > 0)) out.push('revenue')
  for (const lever of ['leads', 'conversion', 'avgCheck'] as const) {
    const u = sc.requiredUplift?.find((x) => x.lever === lever)
    if (u && finite(u.current) && finite(u.target)) out.push(LEVER_KPI[lever])
  }
  if (sc.finance && Array.isArray(sc.finance.cash) && sc.finance.cash.some(finite)) out.push('cash')
  return out
}

export interface PlannedMonth {
  values: KpiValues
  revenueRange: { low: number; high: number } | null
  /** Month of the plan (0 = the plan start); null = the plan has no start / no scenario. */
  monthIndex: number | null
  scenarioKey: string | null
}

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d

export function plannedFor(v: PlannedVersion, period: string): PlannedMonth {
  const sc = planScenario(v)
  const start = periodOrdinal(planStartPeriod(v))
  const at = periodOrdinal(period)
  if (!sc || start === null || at === null) return { values: {}, revenueRange: null, monthIndex: null, scenarioKey: sc?.key ?? null }
  const m = at - start
  if (m < 0) return { values: {}, revenueRange: null, monthIndex: m, scenarioKey: sc.key }

  const values: KpiValues = {}
  let revenueRange: PlannedMonth['revenueRange'] = null
  const traj = (sc.trajectory ?? []).filter((p) => finite(p.month) && finite(p.base)).sort((a, b) => a.month - b.month)
  if (traj.length) {
    const point = [...traj].reverse().find((p) => p.month <= m) ?? traj[0]
    values.revenue = round(point.base / 12)
    if (finite(point.low) && finite(point.high)) revenueRange = { low: round(point.low / 12), high: round(point.high / 12) }
  }

  const ramp = rampOf(v, sc.key)
  const share = Math.min(1, m / ramp)
  for (const lever of ['leads', 'conversion', 'avgCheck'] as const) {
    const u = sc.requiredUplift?.find((x) => x.lever === lever)
    if (!u || !finite(u.current) || !finite(u.target)) continue
    const level = u.current + (u.target - u.current) * share
    values[LEVER_KPI[lever]] = lever === 'conversion' ? round(level * 100, 2) : lever === 'leads' ? round(level, 1) : round(level)
  }

  const cash = sc.finance?.cash
  if (Array.isArray(cash) && m >= 1) {
    const c = cash[Math.min(m, cash.length) - 1]
    if (finite(c)) values.cash = round(c)
  }
  return { values, revenueRange, monthIndex: m, scenarioKey: sc.key }
}
