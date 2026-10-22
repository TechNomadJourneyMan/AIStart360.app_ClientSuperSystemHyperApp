/**
 * components/point-b/planFactModel.ts — display logic of the «План-факт и история» tab (plan Ф6b, spec §13, §15.2) and of
 * the staff plan-fact panel, free of React and of the DOM so it can be unit-tested.
 *
 * It reads `data.planFact` of `GET /api/v1/point-b/state` (PlanFactState of lib/point-b/planfact/types.ts) — or
 * `data.planFact` of the staff route. The parser is tolerant (a field the server did not send is an empty value, never
 * NaN on the screen). No single aggregated percent anywhere: the progress of a goal is the share of the WAY and the
 * share of the TIME side by side.
 */
import { fmtMoney, fmtNum } from '@/lib/point-b/model/format'
import { diffVersions } from '@/lib/point-b/planfact/diff'
import { fmtKpi, KPI_META, periodLabel, PERIOD_RE } from '@/lib/point-b/planfact/kpis'
import {
  PLAN_KPIS, type Checkpoint, type GoalProgress, type KpiValues, type KpiVerdictEntry, type PlanFactState, type PlanFactVerdict,
  type PlanKpi, type VersionDiff, type VersionSummary,
} from '@/lib/point-b/planfact/types'
import { fmtLongDate, type Tone } from './overviewModel'

export type { PlanFactState }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const VERDICTS: PlanFactVerdict[] = ['on_track', 'risk', 'behind', 'no_data']

// ── Parsing ─────────────────────────────────────────────────────────────

function kpiValues(v: unknown): KpiValues {
  const out: KpiValues = {}
  if (!isObj(v)) return out
  for (const k of PLAN_KPIS) if (finite(v[k])) out[k] = v[k] as number
  return out
}

function parseCheckpoint(v: unknown): Checkpoint | null {
  if (!isObj(v) || typeof v.period !== 'string' || !PERIOD_RE.test(v.period)) return null
  const verdict: Checkpoint['verdict'] = {}
  if (isObj(v.verdict)) {
    for (const [k, e] of Object.entries(v.verdict)) {
      if (!(PLAN_KPIS as readonly string[]).includes(k) || !isObj(e)) continue
      verdict[k as PlanKpi] = {
        kpi: k as PlanKpi,
        verdict: VERDICTS.includes(e.verdict as PlanFactVerdict) ? (e.verdict as PlanFactVerdict) : 'no_data',
        planned: finite(e.planned) ? e.planned : null,
        actual: finite(e.actual) ? e.actual : null,
        shortfallPct: finite(e.shortfallPct) ? e.shortfallPct : null,
        reason: str(e.reason) ?? '',
      }
    }
  }
  const f = isObj(v.forecast) ? v.forecast : {}
  const range = isObj(v.plannedRange) && finite(v.plannedRange.low) && finite(v.plannedRange.high) ? { low: v.plannedRange.low, high: v.plannedRange.high } : null
  const sources: Checkpoint['actualSources'] = {}
  if (isObj(v.actualSources)) {
    for (const [k, s] of Object.entries(v.actualSources)) if ((PLAN_KPIS as readonly string[]).includes(k) && (s === 'reconciliation' || s === 'facts')) sources[k as PlanKpi] = s
  }
  return {
    period: v.period,
    versionId: str(v.versionId) ?? '',
    planned: kpiValues(v.planned),
    plannedRange: range,
    actual: kpiValues(v.actual),
    actualSources: sources,
    forecast: {
      atDeadlineAnnual: finite(f.atDeadlineAnnual) ? f.atDeadlineAnnual : null,
      trendMonthlyPct: finite(f.trendMonthlyPct) ? f.trendMonthlyPct : null,
      basis: f.basis === 'history' ? 'history' : 'insufficient',
      goalAnnual: finite(f.goalAnnual) ? f.goalAnnual : null,
      deadline: str(f.deadline),
      reachDate: str(f.reachDate),
    },
    verdict,
    overall: VERDICTS.includes(v.overall as PlanFactVerdict) ? (v.overall as PlanFactVerdict) : 'no_data',
    reason: str(v.reason) ?? '',
    computedAt: str(v.computedAt) ?? '',
  }
}

function parseProgress(v: unknown): GoalProgress | null {
  if (!isObj(v) || !str(v.metricKey) || !finite(v.target)) return null
  const n = (x: unknown) => (finite(x) ? x : null)
  const unit = ['money_year', 'money', 'number', 'percent'].includes(v.unit as string) ? (v.unit as GoalProgress['unit']) : 'number'
  return {
    metricKey: v.metricKey as string, periodLabel: str(v.periodLabel) ?? '', label: str(v.label) ?? (v.metricKey as string), unit,
    base: n(v.base), fact: n(v.fact), factPeriod: str(v.factPeriod), target: v.target as number,
    pathShare: n(v.pathShare), timeShare: n(v.timeShare), startDate: str(v.startDate), deadline: str(v.deadline),
    forecastDate: str(v.forecastDate), forecastNote: str(v.forecastNote),
  }
}

function parseVersion(v: unknown): VersionSummary | null {
  if (!isObj(v) || !str(v.id) || !finite(v.version)) return null
  const status = ['draft', 'in_review', 'approved', 'superseded'].includes(v.status as string) ? (v.status as VersionSummary['status']) : 'draft'
  const arr = <T>(x: unknown, f: (y: Record<string, unknown>) => T | null): T[] => (Array.isArray(x) ? x.filter(isObj).map(f).filter((y): y is T => y !== null) : [])
  const t = isObj(v.totals) ? v.totals : {}
  const p = isObj(v.pace) ? v.pace : null
  return {
    id: v.id as string, version: v.version as number, status,
    authorName: str(v.authorName), authorKind: str(v.authorKind), approvedAt: str(v.approvedAt), approverName: str(v.approverName),
    createdAt: str(v.createdAt) ?? '', changeReason: str(v.changeReason),
    goals: arr(v.goals, (g) => (str(g.key) && finite(g.target) ? { key: g.key as string, label: str(g.label) ?? (g.key as string), target: g.target as number, deadline: str(g.deadline), status: str(g.status) ?? '' } : null)),
    primaryGoal: str(v.primaryGoal), selectedScenario: str(v.selectedScenario),
    pace: p && str(p.key) ? { key: p.key as string, label: str(p.label) ?? (p.key as string), rampMonths: finite(p.rampMonths) ? p.rampMonths : null, reserveMonths: finite(p.reserveMonths) ? p.reserveMonths : null, growthCapAnnual: finite(p.growthCapAnnual) ? p.growthCapAnnual : null } : null,
    assumptions: arr(v.assumptions, (a) => (str(a.key) ? { key: a.key as string, label: str(a.label) ?? (a.key as string), value: str(a.value) ?? '—' } : null)),
    totals: {
      timeToGoalMonths: finite(t.timeToGoalMonths) ? t.timeToGoalMonths : null, revenueAtDeadline: finite(t.revenueAtDeadline) ? t.revenueAtDeadline : null,
      revenueTotal: finite(t.revenueTotal) ? t.revenueTotal : null, netProfitTotal: finite(t.netProfitTotal) ? t.netProfitTotal : null, fundingNeed: finite(t.fundingNeed) ? t.fundingNeed : null,
    },
    strategy: arr(v.strategy, (n) => (str(n.key) && str(n.title) ? { key: n.key as string, kind: str(n.kind) ?? 'task', title: n.title as string } : null)),
    ...(v.contentHidden === true ? { contentHidden: true } : {}),
  }
}

export function parsePlanFact(v: unknown): PlanFactState | null {
  if (!isObj(v)) return null
  const checkpoints = (Array.isArray(v.checkpoints) ? v.checkpoints : []).map(parseCheckpoint).filter((c): c is Checkpoint => !!c)
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
  const rec = isObj(v.reconciliation) ? v.reconciliation : {}
  return {
    checkpoints,
    current: parseCheckpoint(v.current),
    progress: (Array.isArray(v.progress) ? v.progress : []).map(parseProgress).filter((p): p is GoalProgress => !!p),
    kpis: (Array.isArray(v.kpis) ? v.kpis : []).filter((k): k is PlanKpi => (PLAN_KPIS as readonly unknown[]).includes(k)),
    reconciliation: {
      period: typeof rec.period === 'string' && PERIOD_RE.test(rec.period) ? rec.period : '',
      done: rec.done === true,
      values: kpiValues(rec.values),
    },
    computedAt: str(v.computedAt),
    staleDays: finite(v.staleDays) ? v.staleDays : null,
    versions: (Array.isArray(v.versions) ? v.versions : []).map(parseVersion).filter((x): x is VersionSummary => !!x),
  }
}

/** `data.planFact` of a state / staff answer; undefined when the server did not send the field (older server). */
export function parsePlanFactFromBody(body: unknown): PlanFactState | null | undefined {
  if (!isObj(body) || !isObj(body.data)) return undefined
  if (!('planFact' in body.data)) return undefined
  return parsePlanFact(body.data.planFact)
}

// ── Verdict ─────────────────────────────────────────────────────────────

export const PF_VERDICT_VIEW: Record<PlanFactVerdict, { label: string; tone: Tone; icon: string }> = {
  on_track: { label: 'На курсе', tone: 'good', icon: 'check_circle' },
  risk: { label: 'Риск', tone: 'warn', icon: 'warning' },
  behind: { label: 'Отстаём', tone: 'bad', icon: 'trending_down' },
  no_data: { label: 'Нет данных', tone: 'neutral', icon: 'help' },
}

export interface VerdictStrip { label: string; tone: Tone; icon: string; period: string; reason: string; forecast: string | null }

export function verdictStrip(state: PlanFactState): VerdictStrip | null {
  const c = state.current
  if (!c) return null
  const v = PF_VERDICT_VIEW[c.overall]
  const f = c.forecast
  let forecast: string | null = null
  if (f.reachDate) forecast = `При текущем темпе цель по выручке будет достигнута примерно ${fmtLongDate(f.reachDate)}.`
  else if (finite(f.atDeadlineAnnual) && f.deadline) forecast = `При текущем ходе к ${fmtLongDate(f.deadline)} выручка выйдет на ${fmtMoney(f.atDeadlineAnnual)} в год${finite(f.goalAnnual) ? ` при цели ${fmtMoney(f.goalAnnual)}` : ''}.`
  else if (f.basis === 'insufficient') forecast = 'Прогноз по текущему ходу появится, когда наберётся история выручки по месяцам.'
  return { label: v.label, tone: v.tone, icon: v.icon, period: periodLabel(c.period), reason: c.reason, forecast }
}

/** «Обновлено сегодня» / «обновлено N дней назад»; stale after 4 days (the recompute runs twice a week). */
export function staleBadge(state: PlanFactState): { text: string; stale: boolean } | null {
  if (state.staleDays === null) return state.checkpoints.length ? null : { text: 'Ещё не пересчитано', stale: true }
  const d = state.staleDays
  const days = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней')
  const text = d === 0 ? 'Обновлено сегодня' : d === 1 ? 'Обновлено вчера' : `Обновлено ${d} ${days(d)} назад`
  return { text: d > 4 ? `${text} · ждёт пересчёта` : text, stale: d > 4 }
}

// ── Checkpoints ─────────────────────────────────────────────────────────

export interface KpiCell { kpi: PlanKpi; label: string; planned: string; actual: string; verdict: PlanFactVerdict; verdictLabel: string; tone: Tone; source: string | null }
export interface CheckpointRow { period: string; label: string; overall: PlanFactVerdict; overallLabel: string; tone: Tone; reason: string; cells: KpiCell[] }

const SOURCE_LABEL = { reconciliation: 'сверка', facts: 'данные Точки А' } as const

export function checkpointRows(state: PlanFactState): CheckpointRow[] {
  return [...state.checkpoints].reverse().map((c) => ({
    period: c.period,
    label: periodLabel(c.period),
    overall: c.overall,
    overallLabel: PF_VERDICT_VIEW[c.overall].label,
    tone: PF_VERDICT_VIEW[c.overall].tone,
    reason: c.reason,
    cells: state.kpis.map((k) => {
      const e: KpiVerdictEntry | undefined = c.verdict[k]
      const verdict = e?.verdict ?? 'no_data'
      const src = c.actualSources[k]
      return {
        kpi: k, label: KPI_META[k].label, planned: fmtKpi(k, c.planned[k]), actual: fmtKpi(k, c.actual[k]),
        verdict, verdictLabel: PF_VERDICT_VIEW[verdict].label, tone: PF_VERDICT_VIEW[verdict].tone, source: src ? SOURCE_LABEL[src] : null,
      }
    }),
  }))
}

export interface RevenueBar { period: string; short: string; plan: number | null; low: number | null; high: number | null; fact: number | null }
export interface RevenueChart { bars: RevenueBar[]; max: number; summary: string }

const SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** Monthly revenue: the plan (with its corridor) and the fact, oldest first; null without any planned revenue. */
export function revenueChart(state: PlanFactState): RevenueChart | null {
  const bars = state.checkpoints.map((c) => ({
    period: c.period,
    short: SHORT[Number(c.period.slice(5, 7)) - 1] ?? c.period,
    plan: finite(c.planned.revenue) ? c.planned.revenue : null,
    low: c.plannedRange?.low ?? null,
    high: c.plannedRange?.high ?? null,
    fact: finite(c.actual.revenue) ? c.actual.revenue : null,
  }))
  if (!bars.some((b) => b.plan !== null)) return null
  const max = Math.max(...bars.flatMap((b) => [b.plan ?? 0, b.high ?? 0, b.fact ?? 0]), 1)
  const facts = bars.filter((b) => b.fact !== null).length
  return { bars, max, summary: `Выручка по месяцам: план и факт за ${bars.length} мес., факт есть за ${facts}.` }
}

// ── Progress ────────────────────────────────────────────────────────────

export interface ProgressRow {
  key: string
  label: string
  base: string
  fact: string
  factNote: string | null
  target: string
  path: { text: string; width: number } | null
  time: { text: string; width: number } | null
  forecast: string
  deadline: string | null
}

function goalValue(p: GoalProgress, v: number | null): string {
  if (!finite(v)) return '—'
  if (p.unit === 'money_year') return `${fmtMoney(v)} в год`
  if (p.unit === 'money') return fmtMoney(v)
  if (p.unit === 'percent') return `${fmtNum(v, Number.isInteger(v) ? 0 : 1)}%`
  return fmtNum(v, Number.isInteger(v) ? 0 : 1)
}

const share = (x: number | null, what: string): { text: string; width: number } | null =>
  finite(x) ? { text: `${Math.round(x * 100)}% ${what}`, width: Math.max(0, Math.min(100, Math.round(x * 100))) } : null

export function progressRows(state: PlanFactState): ProgressRow[] {
  return state.progress.map((p) => ({
    key: `${p.metricKey}|${p.periodLabel}`,
    label: p.label,
    base: goalValue(p, p.base),
    fact: goalValue(p, p.fact),
    factNote: p.fact === null ? 'нет факта' : p.factPeriod ? `факт за ${periodLabel(p.factPeriod)}` : null,
    target: goalValue(p, p.target),
    path: share(p.pathShare, 'пути'),
    time: share(p.timeShare, 'времени'),
    forecast: p.forecastDate ? `Прогноз достижения: ${fmtLongDate(p.forecastDate)}` : p.forecastNote ?? 'Прогноза даты нет',
    deadline: p.deadline ? fmtLongDate(p.deadline) : null,
  }))
}

// ── The «Факт за месяц» form ────────────────────────────────────────────

export interface FactField { kpi: PlanKpi; label: string; hint: string; suffix: string; value: string; inputMode: 'numeric' | 'decimal' }

const SUFFIX: Record<PlanKpi, string> = { revenue: '₸', leads: 'шт.', conversion: '%', avg_check: '₸', cash: '₸' }

export function factFields(kpis: PlanKpi[], values: KpiValues): FactField[] {
  return kpis.map((k) => ({
    kpi: k, label: KPI_META[k].label, hint: KPI_META[k].hint, suffix: SUFFIX[k],
    value: finite(values[k]) ? String(values[k]) : '', inputMode: KPI_META[k].integer ? 'numeric' : 'decimal',
  }))
}

// ── Versions ────────────────────────────────────────────────────────────

export const VERSION_STATUS_LABEL: Record<VersionSummary['status'], string> = {
  approved: 'Действует', superseded: 'Заменена', draft: 'Черновик', in_review: 'На одобрении',
}

export interface VersionItem { id: string; title: string; status: string; tone: Tone; meta: string; reason: string | null; system: boolean }

export function versionItems(state: Pick<PlanFactState, 'versions'>): VersionItem[] {
  return state.versions.map((v) => {
    const who = v.approverName ? `одобрил ${v.approverName}` : null
    const when = v.approvedAt ? fmtLongDate(v.approvedAt) : fmtLongDate(v.createdAt)
    const author = v.authorKind === 'system' ? 'предложение пересчёта' : v.authorName ? `автор ${v.authorName}` : null
    return {
      id: v.id, title: `Версия ${v.version}`, status: VERSION_STATUS_LABEL[v.status],
      tone: v.status === 'approved' ? 'good' : v.status === 'superseded' ? 'neutral' : 'warn',
      meta: [when, who, author].filter(Boolean).join(' · '), reason: v.changeReason, system: v.authorKind === 'system',
    }
  })
}

/** The default pair: the current approved version against the one before it. */
export function defaultPair(state: Pick<PlanFactState, 'versions'>): [string, string] | null {
  const list = state.versions
  if (list.length < 2) return null
  const cur = list.find((v) => v.status === 'approved') ?? list[0]
  const prev = list.filter((v) => v.version < cur.version).sort((a, b) => b.version - a.version)[0] ?? list.find((v) => v.id !== cur.id)!
  return [prev.id, cur.id]
}

export type CompareView =
  | { mode: 'diff'; diff: VersionDiff }
  | { mode: 'reasons'; items: Array<{ title: string; reason: string }> }

export function compareView(state: Pick<PlanFactState, 'versions'>, aId: string, bId: string): CompareView | null {
  const a = state.versions.find((v) => v.id === aId)
  const b = state.versions.find((v) => v.id === bId)
  if (!a || !b || a.id === b.id) return null
  if (a.contentHidden || b.contentHidden) {
    const [older, newer] = a.version <= b.version ? [a, b] : [b, a]
    // Without the content of an older version: what changed, in the words of the version that changed it.
    const items = state.versions
      .filter((v) => v.version > older.version && v.version <= newer.version)
      .sort((x, y) => x.version - y.version)
      .map((v) => ({ title: `Версия ${v.version}`, reason: v.changeReason ?? 'Причина изменений не указана' }))
    return { mode: 'reasons', items }
  }
  return { mode: 'diff', diff: diffVersions(a, b) }
}

export const STRATEGY_KIND: Record<string, string> = { strategy: 'Стратегия', initiative: 'Инициатива', task: 'Задача' }
