/**
 * The model of «Точка А на дашборде» (plan 2026-10-22, W1): the important
 * Point A v4 data in one block — score, confidence, completeness, key
 * metrics, what needs attention, risks / quick wins / strengths and the two
 * revenue goals (12 months, 3 years) with progress. Pure: built from the
 * state of GET /api/v1/point-a/state (usePointAState), unit-tested.
 */
import type { PointAPageState } from '@/hooks/usePointAState'
import type { GoalStatus } from '@/lib/goals/evaluate'
import type { MetricView } from '@/lib/point-a/v4/metric-views'
import { overviewSummary, type OverviewSummary } from '@/lib/point-a/v4/summary'
import { parseAmount } from '@/lib/format/kzt'

/** The revenue goal metric (lib/goals/store.ts REVENUE_GOAL_METRIC — not imported: that module is server-side). */
export const REVENUE_GOAL_METRIC = 'biz.finansy.vyruchka_god'
export type RevenuePeriod = '12m' | '3y'

export const POINT_A_HREF = '/client/point-a'
export const POINT_B_HREF = '/client/point-b'
const SURVEY_HREF = '/client/onboarding'
const DOCUMENTS_HREF = '/client/onboarding/documents'

export interface AttentionItem {
  kind: 'discrepancy' | 'data'
  title: string
  detail: string
  action: { label: string; href: string }
}

export interface RevenueGoalRow {
  period: RevenuePeriod
  title: string
  /** Goal id (metric_targets or «company-<period>»), null when there is no goal. */
  goalId: string | null
  /** Annual revenue goal, ₸. */
  target: number | null
  targetMonthly: number | null
  /** Current annual revenue (the same value as everywhere — lib/metrics/company-metrics). */
  current: number | null
  currentPeriod: string | null
  /** current / target, 0..100 (null without a fact or a goal). */
  reachedPct: number | null
  status: GoalStatus | null
  statusText: string | null
  realismText: string | null
  deadline: string | null
}

export interface DashboardSummaryModel {
  hasSnapshot: boolean
  score: number | null
  /** 0..100 */
  confidencePct: number | null
  /** 0..100 */
  coveragePct: number | null
  stage: string | null
  updatedAt: string | null
  recalculating: boolean
  headline: string | null
  keyMetrics: Array<{ metric: MetricView; goal: PointAPageState['goals'][number] | undefined }>
  attention: AttentionItem[]
  /** All open items (the block shows the top 3). */
  attentionTotal: number
  risks: OverviewSummary['risks']
  quickWins: OverviewSummary['quickWins']
  strengths: OverviewSummary['strengths']
  goals: Record<RevenuePeriod, RevenueGoalRow>
  /** Goals on other metrics / horizons (shown on the Point A page). */
  otherGoals: number
  canManage: boolean
}

const STAGE_RU: Record<string, string> = { seed: 'Старт', early: 'Ранний рост', growth: 'Рост', scale: 'Масштаб', mature: 'Зрелость' }

export const GOAL_STATUS_RU: Record<GoalStatus, string> = {
  achieved: 'Достигнута',
  on_track: 'По плану',
  at_risk: 'Под угрозой',
  behind: 'Отстаём',
  overdue: 'Срок прошёл',
  no_data: 'Нет факта',
  unknown: 'Темп не оценить',
}

const DISCREPANCY_RU: Record<string, string> = {
  conflict: 'Источники расходятся — выберите верное значение',
  invalid: 'Недопустимое значение — укажите верное',
  outlier: 'Необычное значение — проверьте',
}

const pct100 = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(Math.max(0, Math.min(1, v)) * 100)

function goalRow(state: PointAPageState, period: RevenuePeriod): RevenueGoalRow {
  const item = state.goals.find((g) => g.goal.metricId === REVENUE_GOAL_METRIC && g.goal.periodLabel === period)
  const title = period === '12m' ? 'Выручка через 12 месяцев' : 'Выручка через 3 года'
  if (!item) {
    return { period, title, goalId: null, target: null, targetMonthly: null, current: null, currentPeriod: null, reachedPct: null, status: null, statusText: null, realismText: null, deadline: null }
  }
  const { goal, evaluation: e } = item
  const target = Number.isFinite(goal.targetValue) && goal.targetValue > 0 ? goal.targetValue : null
  const reachedPct = target && e.current !== null && e.current >= 0 ? Math.min(100, Math.round((e.current / target) * 100)) : null
  return {
    period,
    title,
    goalId: goal.id,
    target,
    targetMonthly: target ? Math.round(target / 12) : null,
    current: e.current,
    currentPeriod: e.currentPeriod,
    reachedPct,
    status: e.status,
    statusText: GOAL_STATUS_RU[e.status] ?? null,
    realismText: e.realismText || null,
    deadline: e.deadline || null,
  }
}

/** Open discrepancies first (they lower the confidence), then the most useful data to add. */
export function attentionItems(state: PointAPageState): AttentionItem[] {
  const out: AttentionItem[] = state.discrepancies.map((d) => ({
    kind: 'discrepancy',
    title: `${d.metricLabel} · ${d.periodLabel}`,
    detail: DISCREPANCY_RU[d.kind] ?? 'Проверьте значение',
    action: { label: 'Решить', href: `${POINT_A_HREF}#pa-attention` },
  }))
  for (const c of state.snapshot?.uploadChecklist ?? []) {
    const survey = /анкет/i.test(c.what)
    out.push({
      kind: 'data',
      title: c.title,
      detail: `${c.what}${c.gain > 0 ? ` · точность +${c.gain}%` : ''}`,
      action: survey ? { label: 'Дополнить анкету', href: SURVEY_HREF } : { label: 'Загрузить документы', href: DOCUMENTS_HREF },
    })
  }
  return out
}

export function buildDashboardSummary(state: PointAPageState): DashboardSummaryModel {
  const s = state.snapshot
  const overview = s ? overviewSummary(s) : null
  const attention = attentionItems(state)
  const goals = { '12m': goalRow(state, '12m'), '3y': goalRow(state, '3y') }
  const goalOf = (id: string) => state.goals.find((g) => g.goal.metricId === id)
  return {
    hasSnapshot: !!s,
    score: s?.overall ?? null,
    confidencePct: pct100(s?.confidence),
    coveragePct: pct100(s?.coverage),
    stage: s?.stage ? STAGE_RU[s.stage] ?? s.stage : null,
    updatedAt: s?.createdAt ?? null,
    recalculating: state.recalculation !== 'idle',
    headline: overview?.headline ?? null,
    keyMetrics: state.keyMetrics.slice(0, 6).map((metric) => ({ metric, goal: goalOf(metric.id) })),
    attention: attention.slice(0, 3),
    attentionTotal: attention.length,
    risks: overview?.risks ?? [],
    quickWins: overview?.quickWins ?? [],
    strengths: overview?.strengths ?? [],
    goals,
    otherGoals: state.goals.filter((g) => !(g.goal.metricId === REVENUE_GOAL_METRIC && (g.goal.periodLabel === '12m' || g.goal.periodLabel === '3y'))).length,
    canManage: state.canManage,
  }
}

/** «780 млн», «3,4 млрд», «780 000 000» → ₸ per year; null when it is not a positive amount. */
export function parseGoalAmount(raw: string): number | null {
  const n = parseAmount(raw)
  return n !== null && n > 0 ? n : null
}

/** Body of POST /api/v1/goals for a revenue goal (the server mirrors it into the questionnaire). */
export function revenueGoalDraft(period: RevenuePeriod, annual: number) {
  return {
    metricId: REVENUE_GOAL_METRIC,
    targetValue: Math.round(annual),
    periodLabel: period,
    direction: 'higher_is_better' as const,
    label: period === '12m' ? 'Выручка через 12 месяцев' : 'Выручка через 3 года',
  }
}
