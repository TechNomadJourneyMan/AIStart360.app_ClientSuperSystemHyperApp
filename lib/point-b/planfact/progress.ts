/**
 * lib/point-b/planfact/progress.ts — progress of every goal of the plan (spec §13): base → fact → goal, the share
 * of the WAY and the share of the TIME side by side, the forecast date. Never one aggregated percent. Pure.
 *
 *   pathShare   (fact − base) / (target − base); null without a base or a fact (a weak fact is not invented)
 *   timeShare   (now − start) / (deadline − start), 0..1; the start is when the goal's horizon began (the goal's
 *               baselineAt), else the plan start given by the caller
 *   forecast    the revenue goal only: at the model's monthly trend from the fact, the first month the annual
 *               run-rate reaches the target (≤ 60 months); otherwise a note says why there is no date
 */
import { goalDeadline } from '@/lib/goals/evaluate'
import { REVENUE_GOAL_METRIC } from '@/lib/goals/store'
import type { PlanGoalItem } from '../plan/types'
import { KPI_META } from './kpis'
import type { GoalProgress } from './types'

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const MAX_MONTHS = 60
const DAY = 86_400_000

export interface GoalFact { value: number; period: string | null }

export interface ProgressInput {
  goals: PlanGoalItem[]
  /** The latest fact of each goal metric IN THE GOAL'S UNITS (revenue: an annual run-rate). */
  facts: Record<string, GoalFact | undefined>
  /** The model's mean monthly revenue growth, percent (null = no history to tell). */
  revenueTrendMonthlyPct: number | null
  /** The plan start (ISO), for goals without their own start. */
  planStart: string | null
  now: Date
}

const UNIT_BY_METRIC: Record<string, GoalProgress['unit']> = {
  [REVENUE_GOAL_METRIC]: 'money_year',
  'biz.marketing.konversiya_lid_klient': 'percent',
  'biz.prodazhi.sredniy_chek': 'money',
  'biz.marketing.lidov_v_mes': 'number',
}

function labelOf(item: PlanGoalItem): string {
  if (item.label?.trim()) return item.label.trim()
  if (item.metricKey === REVENUE_GOAL_METRIC) return 'Выручка в год'
  const kpi = Object.values(KPI_META).find((k) => k.metricKey === item.metricKey)
  return kpi?.label ?? item.metricKey
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10)

function addMonths(d: Date, m: number): Date {
  const x = new Date(d.getTime())
  x.setUTCMonth(x.getUTCMonth() + m)
  return x
}

function forecastOf(item: PlanGoalItem, fact: GoalFact | undefined, trendPct: number | null, now: Date): { date: string | null; note: string | null } {
  if (item.metricKey !== REVENUE_GOAL_METRIC) return { date: null, note: 'Прогноз даты считается только для цели по выручке.' }
  if (!fact || !finite(fact.value) || fact.value <= 0) return { date: null, note: 'Нет факта выручки — дату не оценить.' }
  if (fact.value >= item.targetValue) return { date: null, note: 'Цель уже достигнута по факту.' }
  if (!finite(trendPct)) return { date: null, note: 'Нужна история выручки по месяцам (12 месяцев подряд), чтобы оценить дату.' }
  const g = trendPct / 100
  if (g <= 0) return { date: null, note: 'При текущем темпе выручка не растёт — даты достижения нет.' }
  const months = Math.ceil(Math.log(item.targetValue / fact.value) / Math.log(1 + g))
  if (!finite(months) || months > MAX_MONTHS) return { date: null, note: 'При текущем темпе цель не достигается в ближайшие 5 лет.' }
  return { date: isoDate(addMonths(now, Math.max(1, months))), note: null }
}

export function goalProgress(input: ProgressInput): GoalProgress[] {
  const { now } = input
  return input.goals
    .filter((g) => finite(g.targetValue))
    .map((item) => {
      const fact = input.facts[item.metricKey]
      const base = finite(item.baselineValue) ? item.baselineValue : null
      const value = fact && finite(fact.value) ? fact.value : null
      const span = base !== null ? item.targetValue - base : null
      const pathShare = base !== null && value !== null && span !== null && Math.abs(span) > 1e-9 ? Math.round(((value - base) / span) * 1000) / 1000 : null

      const startIso = item.baselineAt ?? input.planStart
      const start = startIso && Number.isFinite(Date.parse(startIso)) ? new Date(startIso) : null
      const deadline = item.deadline || start
        ? goalDeadline({ deadline: item.deadline, periodLabel: item.periodLabel, createdAt: null, baselineAt: start ? start.toISOString() : null }, now)
        : null
      let timeShare: number | null = null
      if (start && deadline && deadline.getTime() > start.getTime()) {
        timeShare = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / (deadline.getTime() - start.getTime())))
        timeShare = Math.round(timeShare * 1000) / 1000
      }
      const f = forecastOf(item, fact, input.revenueTrendMonthlyPct, now)
      return {
        metricKey: item.metricKey,
        periodLabel: item.periodLabel,
        label: labelOf(item),
        unit: UNIT_BY_METRIC[item.metricKey] ?? 'number',
        base,
        fact: value,
        factPeriod: fact?.period ?? null,
        target: item.targetValue,
        pathShare,
        timeShare,
        startDate: start ? isoDate(start) : null,
        deadline: deadline && Number.isFinite(deadline.getTime()) ? isoDate(deadline) : null,
        forecastDate: f.date,
        forecastNote: f.note,
      }
    })
}

/** Whole days between two instants (the «обновлено N дней назад» badge). */
export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY))
}
