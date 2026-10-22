/**
 * lib/point-b/planfact/diff.ts — «что изменилось и почему» between two plan versions (spec §15.2, MVP level). Pure.
 *
 *   summarizeVersion   a plan version row → what the comparison and the version list show: goals, the pace
 *                      profile, the key assumptions of the calculation, the totals of the selected scenario, the
 *                      nodes of the strategy, who approved it and when, the reason of the change
 *   diffVersions       two summaries → the changed goals / pace / assumptions / totals, the strategy nodes added,
 *                      removed and renamed (by their stable key), and the reason of the NEWER version
 * Numbers are compared on their displayed form, so a rounding difference is not a «change».
 */
import { fmtMoney, fmtMonths, fmtNum, fmtPct } from '../model/format'
import type { PlanGoalsSnapshot } from '../plan/types'
import { planScenario } from './planned'
import type { VersionDiff, VersionDiffEntry, VersionSummary } from './types'

export interface VersionRowLike {
  id: string
  version: number
  status: string
  goals: PlanGoalsSnapshot | null
  assumptions: Record<string, unknown> | null
  scenarios: unknown
  selected_scenario: string | null
  strategy: Record<string, unknown> | null
  change_reason: string | null
  author_name: string | null
  author_kind?: string | null
  approved_at: string | null
  approved_by?: string | null
  created_at: string
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const STATUSES = ['draft', 'in_review', 'approved', 'superseded'] as const

const GOAL_STATUS: Record<string, string> = {
  owner_draft: 'ждёт проверки', verified: 'проверена', corrected: 'исправлена (ждёт согласия)', agreed: 'согласована', disputed: 'оспорена',
}
const KIND_LABEL: Record<string, string> = { strategy: 'Стратегия', initiative: 'Инициатива', task: 'Задача' }

export function summarizeVersion(row: VersionRowLike, names: { approverName?: string | null } = {}): VersionSummary {
  const goals = (row.goals?.items ?? []).filter((g) => g && typeof g.metricKey === 'string').map((g) => ({
    key: `${g.metricKey}|${g.periodLabel}`,
    label: g.label?.trim() || g.metricKey,
    target: Number(g.targetValue),
    deadline: g.deadline ?? null,
    status: GOAL_STATUS[g.reviewStatus] ?? String(g.reviewStatus ?? ''),
  }))
  const primary = row.goals?.primary ? `${row.goals.primary.metricKey}|${row.goals.primary.periodLabel}` : null
  const sc = planScenario({ scenarios: row.scenarios, selected_scenario: row.selected_scenario })
  const profiles = Array.isArray(row.assumptions?.profiles) ? (row.assumptions!.profiles as Array<Record<string, unknown>>) : []
  const prof = profiles.find((p) => p && p.key === (row.selected_scenario ?? sc?.key)) ?? null
  const paceKey = row.selected_scenario ?? sc?.key ?? (prof?.key as string | undefined) ?? null
  const pace = paceKey
    ? {
        key: paceKey,
        label: (typeof prof?.label === 'string' ? prof.label : sc?.label) ?? paceKey,
        rampMonths: finite(prof?.rampMonths) ? prof!.rampMonths as number : null,
        reserveMonths: finite(prof?.reserveMonths) ? prof!.reserveMonths as number : null,
        growthCapAnnual: finite(prof?.growthCapAnnual) ? prof!.growthCapAnnual as number : null,
      }
    : null

  const model = (row.assumptions?.model ?? null) as { level?: unknown; kind?: unknown; gap?: Record<string, unknown> } | null
  const assumptions: VersionSummary['assumptions'] = []
  if (model) {
    if (finite(model.level)) assumptions.push({ key: 'level', label: 'Уровень данных', value: `уровень ${model.level}` })
    if (typeof model.kind === 'string') assumptions.push({ key: 'kind', label: 'Модель', value: model.kind === 'funnel' ? 'воронка' : model.kind === 'growth' ? 'упрощённый рост' : 'нет' })
    if (finite(model.gap?.baseAnnual)) assumptions.push({ key: 'base', label: 'Выручка на старте плана, в год', value: fmtMoney(model.gap!.baseAnnual as number) })
    if (finite(model.gap?.months)) assumptions.push({ key: 'months', label: 'Срок главной цели', value: fmtMonths(model.gap!.months as number) })
  }
  for (const u of sc?.requiredUplift ?? []) {
    if (!finite(u.current)) continue
    const v = u.lever === 'leads' ? fmtNum(u.current) : u.lever === 'avgCheck' ? fmtMoney(u.current) : fmtPct(u.current, 1)
    assumptions.push({ key: `lever:${u.lever}`, label: `${u.label} на старте`, value: v })
  }

  const items = Array.isArray(row.strategy?.items) ? (row.strategy!.items as Array<Record<string, unknown>>) : []
  const strategy = items
    .filter((n) => n && typeof n.key === 'string' && typeof n.title === 'string')
    .map((n) => ({ key: n.key as string, kind: typeof n.kind === 'string' ? n.kind : 'task', title: (n.title as string).trim() }))

  return {
    id: row.id,
    version: row.version,
    status: (STATUSES as readonly string[]).includes(row.status) ? (row.status as VersionSummary['status']) : 'draft',
    authorName: row.author_name ?? null,
    authorKind: row.author_kind ?? null,
    approvedAt: row.approved_at ?? null,
    approverName: names.approverName ?? null,
    createdAt: row.created_at,
    changeReason: row.change_reason?.trim() || null,
    goals,
    primaryGoal: primary,
    selectedScenario: row.selected_scenario ?? null,
    pace,
    assumptions,
    totals: {
      timeToGoalMonths: finite(sc?.timeToGoalMonths?.base) ? sc!.timeToGoalMonths.base : null,
      revenueAtDeadline: finite(sc?.revenueAtDeadline?.base) ? sc!.revenueAtDeadline.base : null,
      revenueTotal: finite(sc?.finance?.totals?.revenue) ? sc!.finance!.totals.revenue : null,
      netProfitTotal: finite(sc?.finance?.totals?.netProfit) ? sc!.finance!.totals.netProfit : null,
      fundingNeed: finite(sc?.finance?.fundingNeed) ? sc!.finance!.fundingNeed : null,
    },
    strategy,
  }
}

const show = (v: string | null | undefined): string => (v === null || v === undefined || v === '' ? '—' : v)

function entry(out: VersionDiffEntry[], field: string, label: string, before: string | null | undefined, after: string | null | undefined): void {
  if (show(before) !== show(after)) out.push({ field, label, before: show(before), after: show(after) })
}

/** `a` and `b` in any order: the older one (smaller number) is «before». */
export function diffVersions(a: VersionSummary, b: VersionSummary): VersionDiff {
  const [older, newer] = a.version <= b.version ? [a, b] : [b, a]

  const goals: VersionDiffEntry[] = []
  const og = new Map(older.goals.map((g) => [g.key, g]))
  const ng = new Map(newer.goals.map((g) => [g.key, g]))
  const goalText = (g: VersionSummary['goals'][number] | undefined): string | null =>
    g ? `${g.key.startsWith('biz.finansy.vyruchka_god') ? fmtMoney(g.target) : fmtNum(g.target, 2).replace(/,00$/, '')}${g.deadline ? ` к ${g.deadline}` : ''}` : null
  for (const key of new Set([...og.keys(), ...ng.keys()])) {
    const o = og.get(key)
    const n = ng.get(key)
    const label = (n ?? o)!.label
    entry(goals, `goal:${key}`, `Цель «${label}»`, o ? goalText(o) : 'не было', n ? goalText(n) : 'удалена')
    if (o && n) entry(goals, `goal-status:${key}`, `Статус цели «${label}»`, o.status, n.status)
  }
  entry(goals, 'primary', 'Главная цель', older.primaryGoal ? (og.get(older.primaryGoal)?.label ?? older.primaryGoal) : null, newer.primaryGoal ? (ng.get(newer.primaryGoal)?.label ?? newer.primaryGoal) : null)

  const pace: VersionDiffEntry[] = []
  entry(pace, 'scenario', 'Темп плана', older.pace?.label, newer.pace?.label)
  entry(pace, 'ramp', 'Выход рычагов на целевой уровень', finite(older.pace?.rampMonths) ? fmtMonths(older.pace!.rampMonths) : null, finite(newer.pace?.rampMonths) ? fmtMonths(newer.pace!.rampMonths) : null)
  entry(pace, 'reserve', 'Резерв ликвидности', finite(older.pace?.reserveMonths) ? fmtMonths(older.pace!.reserveMonths) : null, finite(newer.pace?.reserveMonths) ? fmtMonths(newer.pace!.reserveMonths) : null)
  entry(pace, 'cap', 'Потолок годового роста', finite(older.pace?.growthCapAnnual) ? fmtPct(older.pace!.growthCapAnnual) : null, finite(newer.pace?.growthCapAnnual) ? fmtPct(newer.pace!.growthCapAnnual) : null)

  const assumptions: VersionDiffEntry[] = []
  const oa = new Map(older.assumptions.map((x) => [x.key, x]))
  const na = new Map(newer.assumptions.map((x) => [x.key, x]))
  for (const key of new Set([...oa.keys(), ...na.keys()])) entry(assumptions, `assumption:${key}`, (na.get(key) ?? oa.get(key))!.label, oa.get(key)?.value, na.get(key)?.value)

  const totals: VersionDiffEntry[] = []
  const money = (n: number | null): string | null => (finite(n) ? fmtMoney(n) : null)
  entry(totals, 'time', 'Срок достижения цели', finite(older.totals.timeToGoalMonths) ? fmtMonths(older.totals.timeToGoalMonths) : null, finite(newer.totals.timeToGoalMonths) ? fmtMonths(newer.totals.timeToGoalMonths) : null)
  entry(totals, 'revenueAtDeadline', 'Выручка к сроку цели, в год', money(older.totals.revenueAtDeadline), money(newer.totals.revenueAtDeadline))
  entry(totals, 'revenueTotal', 'Выручка за горизонт плана', money(older.totals.revenueTotal), money(newer.totals.revenueTotal))
  entry(totals, 'netProfitTotal', 'Чистая прибыль за горизонт плана', money(older.totals.netProfitTotal), money(newer.totals.netProfitTotal))
  entry(totals, 'fundingNeed', 'Нехватка денег до резерва', money(older.totals.fundingNeed), money(newer.totals.fundingNeed))

  const os = new Map(older.strategy.map((n) => [n.key, n]))
  const ns = new Map(newer.strategy.map((n) => [n.key, n]))
  const strategyAdded = newer.strategy.filter((n) => !os.has(n.key))
  const strategyRemoved = older.strategy.filter((n) => !ns.has(n.key))
  const strategyRenamed = newer.strategy
    .filter((n) => os.has(n.key) && os.get(n.key)!.title !== n.title)
    .map((n) => ({ key: n.key, before: os.get(n.key)!.title, after: n.title }))

  const unchanged = !goals.length && !pace.length && !assumptions.length && !totals.length && !strategyAdded.length && !strategyRemoved.length && !strategyRenamed.length
  return {
    from: { id: older.id, version: older.version },
    to: { id: newer.id, version: newer.version },
    goals, pace, assumptions, totals, strategyAdded, strategyRemoved, strategyRenamed,
    reason: newer.changeReason,
    unchanged,
  }
}

export const STRATEGY_KIND_LABEL = KIND_LABEL
