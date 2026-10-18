/**
 * components/point-b/overviewModel.ts — display logic of the Point B «Обзор» and «Сценарии»
 * tabs (plan Phase 2 Task 8), free of React and of the DOM so it can be unit-tested.
 *
 * It speaks the contract of `GET /api/v1/point-b/state`:
 *   { ok, data: { access: 'ok',
 *       overview: { result: ModelResult, labelledAutomatic: true },
 *       plan: { status: 'none'|'preparing'|'published', version: number|null,
 *               selectedScenario: string|null, scenarios: ScenarioResult[] (approved version only),
 *               approvedAt: string|null, authorName: string|null } } }
 * and with the model types of lib/point-b/model/types.ts. The parser is tolerant: a field the
 * server did not send becomes an empty value, never a crash and never NaN on the screen.
 *
 * No invented numbers: every figure comes from the ModelResult; a missing one is «—».
 */
import type { MissingInput, ModelResult, Range, ScenarioResult, VerdictKey } from '@/lib/point-b/model/types'

export const DASH = '—'

// ── Tabs ────────────────────────────────────────────────────────────────

export type PointBTabKey = 'overview' | 'scenarios' | 'details'

export const POINT_B_TABS: ReadonlyArray<{ key: PointBTabKey; label: string }> = [
  { key: 'overview', label: 'Обзор' },
  { key: 'scenarios', label: 'Сценарии' },
  { key: 'details', label: 'Подробности' },
]

export function isTabKey(v: unknown): v is PointBTabKey {
  return v === 'overview' || v === 'scenarios' || v === 'details'
}

/** Keyboard model of a tablist (arrows, Home, End); null = the key is not ours. */
export function nextTab(current: PointBTabKey, key: string): PointBTabKey | null {
  const keys = POINT_B_TABS.map((t) => t.key)
  const i = keys.indexOf(current)
  if (key === 'ArrowRight') return keys[(i + 1) % keys.length]
  if (key === 'ArrowLeft') return keys[(i - 1 + keys.length) % keys.length]
  if (key === 'Home') return keys[0]
  if (key === 'End') return keys[keys.length - 1]
  return null
}

// ── State parsed from the server ────────────────────────────────────────

export type PlanStatus = 'none' | 'preparing' | 'published'

export interface PointBPlanState {
  status: PlanStatus
  version: number | null
  selectedScenario: string | null
  /** Scenarios of the APPROVED version only; empty while there is none. */
  scenarios: ScenarioResult[]
  approvedAt: string | null
  authorName: string | null
}

export const EMPTY_PLAN_STATE: PointBPlanState = {
  status: 'none', version: null, selectedScenario: null, scenarios: [], approvedAt: null, authorName: null,
}

export interface PointBStateData { result: ModelResult; plan: PointBPlanState }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [])

function toRange(v: unknown): Range {
  const r = isObj(v) ? v : {}
  return { low: num(r.low), base: num(r.base), high: num(r.high) }
}

const SCENARIO_KEYS: ReadonlyArray<ScenarioResult['key']> = ['cautious', 'moderate', 'aggressive']

function toScenario(v: unknown): ScenarioResult | null {
  if (!isObj(v) || !SCENARIO_KEYS.includes(v.key as ScenarioResult['key'])) return null
  const inv = isObj(v.investments) ? v.investments : {}
  return {
    key: v.key as ScenarioResult['key'],
    label: str(v.label) ?? '',
    feasible: v.feasible !== false,
    infeasibleReason: str(v.infeasibleReason),
    timeToGoalMonths: toRange(v.timeToGoalMonths),
    revenueAtDeadline: toRange(v.revenueAtDeadline),
    requiredUplift: (Array.isArray(v.requiredUplift) ? v.requiredUplift : []).filter(isObj).map((u) => ({
      lever: (['leads', 'conversion', 'avgCheck', 'repeat', 'growth'].includes(u.lever as string) ? u.lever : 'growth') as ScenarioResult['requiredUplift'][number]['lever'],
      label: str(u.label) ?? '',
      current: num(u.current),
      target: num(u.target),
      upliftPct: num(u.upliftPct),
    })),
    investments: {
      marketingMonthlyIncrease: num(inv.marketingMonthlyIncrease),
      totalOverRamp: num(inv.totalOverRamp),
      staffNeed: num(inv.staffNeed),
      note: str(inv.note) ?? '',
    },
    constraints: strArr(v.constraints),
    risks: strArr(v.risks),
    conditions: strArr(v.conditions),
    downside: str(v.downside) ?? '',
    reviewPoints: strArr(v.reviewPoints),
    signsToChangePace: strArr(v.signsToChangePace),
    assumptions: strArr(v.assumptions),
    trajectory: (Array.isArray(v.trajectory) ? v.trajectory : []).filter(isObj)
      .map((p) => ({ month: num(p.month), low: num(p.low), base: num(p.base), high: num(p.high) }))
      .filter((p): p is { month: number; low: number; base: number; high: number } => p.month !== null && p.low !== null && p.base !== null && p.high !== null)
      .sort((a, b) => a.month - b.month),
  }
}

export function parseScenarios(v: unknown): ScenarioResult[] {
  return (Array.isArray(v) ? v : []).map(toScenario).filter((s): s is ScenarioResult => !!s)
}

export function parseModelResult(v: unknown): ModelResult | null {
  if (!isObj(v) || !isObj(v.verdict) || !isObj(v.gap)) return null
  const g = v.gap
  const f = isObj(v.forecast) ? v.forecast : {}
  const verdictKey: VerdictKey = ['on_track', 'at_risk', 'behind', 'no_data'].includes(v.verdict.key as string) ? (v.verdict.key as VerdictKey) : 'no_data'
  const level = v.level === 1 || v.level === 2 ? v.level : 0
  return {
    modelVersion: str(v.modelVersion) ?? '',
    computedAt: str(v.computedAt) ?? '',
    level,
    kind: v.kind === 'funnel' || v.kind === 'growth' ? v.kind : 'none',
    template: (['default', 'ecommerce', 'services', 'production'].includes(v.template as string) ? v.template : 'default') as ModelResult['template'],
    gap: {
      baseAnnual: num(g.baseAnnual), targetAnnual: num(g.targetAnnual), absolute: num(g.absolute),
      multiplier: num(g.multiplier), requiredCagrPct: num(g.requiredCagrPct), months: num(g.months),
    },
    forecast: {
      atCurrentPace: toRange(f.atCurrentPace),
      trendMonthlyPct: num(f.trendMonthlyPct),
      basis: f.basis === 'history' ? 'history' : 'insufficient',
    },
    verdict: { key: verdictKey, headline: str(v.verdict.headline) ?? '', reason: str(v.verdict.reason) ?? '' },
    scenarios: parseScenarios(v.scenarios),
    missing: (Array.isArray(v.missing) ? v.missing : []).filter(isObj).map((m): MissingInput => ({
      key: str(m.key) ?? '',
      label: str(m.label) ?? '',
      unlocks: str(m.unlocks) ?? '',
      level: m.level === 2 ? 2 : 1,
      actions: (Array.isArray(m.actions) ? m.actions : []).filter((a): a is 'survey' | 'documents' | 'expert' => a === 'survey' || a === 'documents' || a === 'expert'),
    })),
    warnings: strArr(v.warnings),
  }
}

export function parsePointBState(body: unknown): PointBStateData | null {
  if (!isObj(body) || body.ok !== true || !isObj(body.data)) return null
  const overview = isObj(body.data.overview) ? body.data.overview : null
  const result = parseModelResult(overview?.result)
  if (!result) return null
  const p = isObj(body.data.plan) ? body.data.plan : {}
  const plan: PointBPlanState = {
    status: p.status === 'preparing' || p.status === 'published' ? p.status : 'none',
    version: num(p.version),
    selectedScenario: str(p.selectedScenario),
    scenarios: parseScenarios(p.scenarios),
    approvedAt: str(p.approvedAt),
    authorName: str(p.authorName),
  }
  return { result, plan }
}

// ── Formatting ──────────────────────────────────────────────────────────

export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH
  const a = Math.abs(v)
  if (a >= 1_000_000_000) return `${(v / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млрд ₸`
  if (a >= 1_000_000) return `${(v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₸`
  return `${Math.round(v).toLocaleString('ru-RU')} ₸`
}

/** Axis label: no currency sign, compact. */
export function fmtAxis(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000_000) return `${(v / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млрд`
  if (a >= 1_000_000) return `${(v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} млн`
  if (a >= 1_000) return `${(v / 1e3).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} тыс`
  return v.toLocaleString('ru-RU')
}

export function fmtPct(v: number | null | undefined, signed = false): string {
  if (v == null || !Number.isFinite(v)) return DASH
  const s = v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  return signed && v > 0 ? `+${s}%` : `${s}%`
}

export function fmtNumber(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? DASH : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

export interface RangeText { main: string; range: string | null }

function bounds(r: Range): { min: number; max: number } | null {
  const vals = [r.low, r.base, r.high].filter((x): x is number => x != null && Number.isFinite(x))
  return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null
}

export function moneyRange(r: Range): RangeText {
  const b = bounds(r)
  if (!b) return { main: DASH, range: null }
  const main = r.base != null ? fmtMoney(r.base) : `${fmtMoney(b.min)} – ${fmtMoney(b.max)}`
  const range = b.min !== b.max && r.base != null ? `${fmtMoney(b.min)} – ${fmtMoney(b.max)}` : null
  return { main, range }
}

/** Months to the goal. The range is min–max of the three values (which end is the pessimistic one does not matter). */
export function monthsRange(r: Range): RangeText {
  const b = bounds(r)
  if (!b) return { main: DASH, range: null }
  if (r.base === 0) return { main: 'цель уже достигнута', range: null }
  const m = (n: number) => Math.round(n)
  const main = r.base != null ? `≈ ${m(r.base)} мес.` : `${m(b.min)}–${m(b.max)} мес.`
  const range = r.base != null && m(b.min) !== m(b.max) ? `${m(b.min)}–${m(b.max)} мес.` : null
  return { main, range }
}

export function fmtLongDate(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Verdict ─────────────────────────────────────────────────────────────

export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

export const TONE_CLASS: Record<Tone, { text: string; border: string; bg: string }> = {
  good: { text: 'text-primary', border: 'border-primary/30', bg: 'bg-primary/[0.08]' },
  warn: { text: 'text-tertiary-fixed-dim', border: 'border-tertiary-fixed-dim/30', bg: 'bg-tertiary-fixed-dim/[0.08]' },
  bad: { text: 'text-error', border: 'border-error/30', bg: 'bg-error/[0.08]' },
  neutral: { text: 'text-on-surface-variant', border: 'border-white/[0.08]', bg: 'bg-white/[0.04]' },
}

export const VERDICT_VIEW: Record<VerdictKey, { label: string; headline: string; tone: Tone; icon: string }> = {
  on_track: { label: 'На курсе', headline: 'Вы идёте к цели в нужном темпе', tone: 'good', icon: 'trending_up' },
  at_risk: { label: 'Есть риск', headline: 'До цели можно не дойти без усилий', tone: 'warn', icon: 'trending_flat' },
  behind: { label: 'Отстаём', headline: 'При текущем темпе цель не достигается', tone: 'bad', icon: 'trending_down' },
  no_data: { label: 'Мало данных', headline: 'Пока нельзя сказать, идёте ли вы к цели', tone: 'neutral', icon: 'help' },
}

export interface VerdictView { key: VerdictKey; label: string; headline: string; reason: string; tone: Tone; icon: string }

export function verdictView(result: ModelResult): VerdictView {
  const base = VERDICT_VIEW[result.verdict.key]
  return {
    key: result.verdict.key,
    label: base.label,
    headline: result.verdict.headline || base.headline,
    reason: result.verdict.reason,
    tone: base.tone,
    icon: base.icon,
  }
}

// ── А → Б ───────────────────────────────────────────────────────────────

export interface PathCell { label: string; value: string; note: string | null }

/** «Сейчас → Цель → Прогноз при текущем ходе → Разрыв». */
export function pathCells(result: ModelResult): PathCell[] {
  const g = result.gap
  const pace = moneyRange(result.forecast.atCurrentPace)
  const noForecast = result.forecast.basis !== 'history' || result.forecast.atCurrentPace.base === null
  let gapValue = DASH
  let gapNote: string | null = null
  if (g.absolute !== null) {
    if (g.absolute <= 0) { gapValue = 'цель уже достигнута'; gapNote = null }
    else {
      gapValue = fmtMoney(g.absolute)
      const parts: string[] = []
      if (g.multiplier !== null) parts.push(`рост в ${g.multiplier.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} раза`)
      if (g.requiredCagrPct !== null) parts.push(`нужно ${fmtPct(g.requiredCagrPct)} в год`)
      gapNote = parts.length ? parts.join(' · ') : null
    }
  } else {
    gapNote = g.targetAnnual === null ? 'нужна цель' : 'нужна текущая выручка'
  }
  return [
    { label: 'Сейчас', value: fmtMoney(g.baseAnnual), note: 'выручка за год' },
    { label: 'Цель', value: fmtMoney(g.targetAnnual), note: g.targetAnnual === null ? 'цель не задана' : g.months !== null ? `через ${Math.round(g.months)} мес.` : null },
    {
      label: 'При текущем ходе',
      value: noForecast ? 'нет прогноза' : pace.main,
      note: noForecast ? 'мало истории выручки: нужно не менее 12 месяцев' : pace.range ? `диапазон ${pace.range}` : null,
    },
    { label: 'Разрыв', value: gapValue, note: gapNote },
  ]
}

// ── Warnings and missing inputs ─────────────────────────────────────────

const STALE_RE = /устаре|stale/i

export function staleWarning(result: ModelResult): string | null {
  return result.warnings.find((w) => STALE_RE.test(w)) ?? null
}

export function otherWarnings(result: ModelResult): string[] {
  return result.warnings.filter((w) => !STALE_RE.test(w))
}

export const GAP_ACTIONS = {
  survey: { label: 'Заполнить в анкете', href: '/client/onboarding' },
  documents: { label: 'Загрузить файл', href: '/client/onboarding/documents' },
  expert: { label: 'Попросить эксперта', href: '/client/messages' },
} as const

export type GapActionKey = keyof typeof GAP_ACTIONS

export const MISSING_LEVEL_LABEL: Record<1 | 2, string> = { 1: 'Для расчёта сценариев', 2: 'Для расчёта денег' }

// ── Chart ───────────────────────────────────────────────────────────────

export interface TrajPoint { month: number; low: number; base: number; high: number }

export interface CorridorChartData {
  points: TrajPoint[]
  /** Run-rate now: the first point of every line (month 0). */
  startAnnual: number | null
  target: number | null
  /** Months to the goal deadline; draws the vertical «срок цели» mark. */
  goalMonths: number | null
  /** «При текущем ходе»: a dashed line from now to the forecast at the deadline. */
  pace: { months: number; base: number; low: number | null; high: number | null } | null
}

export function pickChartScenario(result: ModelResult, selected: string | null): ScenarioResult | null {
  const withLine = result.scenarios.filter((s) => s.trajectory.length >= 2)
  return withLine.find((s) => s.key === selected) ?? withLine.find((s) => s.key === 'moderate') ?? withLine[0] ?? null
}

export function chartData(result: ModelResult, selected: string | null): { data: CorridorChartData; scenario: ScenarioResult } | null {
  if (result.level < 1) return null
  const scenario = pickChartScenario(result, selected)
  if (!scenario) return null
  const g = result.gap
  const p = result.forecast.atCurrentPace
  const pace = result.forecast.basis === 'history' && p.base !== null && g.months !== null && g.months > 0
    ? { months: g.months, base: p.base, low: p.low, high: p.high }
    : null
  return {
    scenario,
    data: { points: scenario.trajectory, startAnnual: g.baseAnnual, target: g.targetAnnual, goalMonths: g.months, pace },
  }
}

/** Why there is no chart: an honest sentence for the placeholder. */
export function chartPlaceholder(result: ModelResult): string {
  const g = result.gap
  if (g.targetAnnual === null) return 'Траектория появится, когда будет задана цель по выручке.'
  if (g.baseAnnual === null) return 'Траектория появится, когда станет известна текущая выручка за год.'
  return 'Траектория появится после расчёта: пока данных для неё не хватает.'
}

export function chartSummary(data: CorridorChartData, scenarioLabel: string): string {
  const last = data.points[data.points.length - 1]
  const parts = [`Траектория выручки (годовой темп), сценарий «${scenarioLabel}»`]
  if (data.startAnnual !== null) parts.push(`сейчас ${fmtMoney(data.startAnnual)}`)
  if (last) parts.push(`через ${Math.round(last.month)} мес. ${fmtMoney(last.base)} (коридор ${fmtMoney(last.low)} – ${fmtMoney(last.high)})`)
  if (data.target !== null) parts.push(`цель ${fmtMoney(data.target)}`)
  return parts.join('; ')
}

export interface CorridorGeometry {
  width: number
  height: number
  /** Right end of the month axis. */
  maxMonth: number
  plot: { left: number; right: number; top: number; bottom: number }
  band: string
  baseLine: string
  paceLine: string | null
  paceEnd: { x: number; y: number; yLow: number | null; yHigh: number | null } | null
  targetY: number | null
  deadlineX: number | null
  yTicks: Array<{ y: number; label: string }>
  xTicks: Array<{ x: number; label: string }>
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Cleans the series: finite values only, month order, low ≤ base ≤ high, month 0 = now. */
function cleanPoints(d: CorridorChartData): TrajPoint[] {
  const raw = d.points.filter((p) => finite(p.month) && p.month > 0 && finite(p.low) && finite(p.base) && finite(p.high))
    .map((p) => ({ month: p.month, low: Math.min(p.low, p.base, p.high), base: p.base, high: Math.max(p.low, p.base, p.high) }))
    .sort((a, b) => a.month - b.month)
  if (finite(d.startAnnual) && raw.length) raw.unshift({ month: 0, low: d.startAnnual, base: d.startAnnual, high: d.startAnnual })
  // one point per month
  return raw.filter((p, i) => i === 0 || p.month !== raw[i - 1].month)
}

export function niceScale(max: number): { max: number; ticks: number[] } | null {
  if (!finite(max) || max <= 0) return null
  const raw = max / 4
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(v)
  return { max: top, ticks }
}

const X_STEPS = [1, 2, 3, 6, 12, 24, 36, 60]

/** «M x y L x y …»; non-finite points are dropped, fewer than 2 → ''. */
export function linePath(pts: Array<[number, number]>): string {
  const ok = pts.filter(([x, y]) => finite(x) && finite(y))
  if (ok.length < 2) return ''
  return ok.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
}

export function corridorGeometry(d: CorridorChartData, width: number, height: number): CorridorGeometry | null {
  const pts = cleanPoints(d)
  if (pts.length < 2) return null
  const W = Math.min(1200, Math.max(280, finite(width) ? width : 640))
  const H = Math.max(160, finite(height) ? height : 260)
  const plot = { left: 56, right: W - 14, top: 14, bottom: H - 30 }

  const lastMonth = pts[pts.length - 1].month
  const maxMonth = Math.max(lastMonth, finite(d.goalMonths) ? d.goalMonths : 0, d.pace && finite(d.pace.months) ? d.pace.months : 0)
  const paceTop = d.pace ? Math.max(d.pace.base, d.pace.high ?? 0) : 0
  const maxVal = Math.max(...pts.map((p) => p.high), finite(d.target) ? d.target : 0, finite(paceTop) ? paceTop : 0)
  const scale = niceScale(maxVal)
  if (!scale || maxMonth <= 0) return null

  const x = (m: number) => plot.left + (m / maxMonth) * (plot.right - plot.left)
  const y = (v: number) => plot.top + (1 - v / scale.max) * (plot.bottom - plot.top)

  const upper = pts.map((p): [number, number] => [x(p.month), y(p.high)])
  const lower = pts.map((p): [number, number] => [x(p.month), y(p.low)]).reverse()
  const ring = [...upper, ...lower]
  const band = ring.length >= 3 && ring.every(([a, b]) => finite(a) && finite(b))
    ? `${ring.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join(' ')} Z`
    : ''

  let paceLine: string | null = null
  let paceEnd: CorridorGeometry['paceEnd'] = null
  const start = finite(d.startAnnual) ? d.startAnnual : null
  if (d.pace && start !== null && start > 0 && d.pace.base > 0 && d.pace.months > 0) {
    // compound growth between the two known points: v(t) = start·(end/start)^(t/months)
    const steps = 24
    const line: Array<[number, number]> = []
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * d.pace.months
      line.push([x(t), y(start * Math.pow(d.pace.base / start, t / d.pace.months))])
    }
    paceLine = linePath(line) || null
    const ex = x(d.pace.months)
    paceEnd = {
      x: ex, y: y(d.pace.base),
      yLow: d.pace.low !== null ? y(d.pace.low) : null,
      yHigh: d.pace.high !== null ? y(d.pace.high) : null,
    }
    if (![paceEnd.x, paceEnd.y].every(finite)) { paceLine = null; paceEnd = null }
  }

  const xStep = X_STEPS.find((s) => maxMonth / s <= 6) ?? 60
  const xTicks: CorridorGeometry['xTicks'] = []
  for (let m = 0; m <= maxMonth + 1e-9; m += xStep) xTicks.push({ x: x(m), label: m === 0 ? 'сейчас' : `${m} мес.` })

  return {
    width: W,
    height: H,
    maxMonth,
    plot,
    band,
    baseLine: linePath(pts.map((p): [number, number] => [x(p.month), y(p.base)])),
    paceLine,
    paceEnd,
    targetY: finite(d.target) && d.target > 0 ? y(d.target) : null,
    deadlineX: finite(d.goalMonths) && d.goalMonths > 0 ? x(d.goalMonths) : null,
    yTicks: scale.ticks.map((v) => ({ y: y(v), label: fmtAxis(v) })),
    xTicks,
  }
}

// ── Scenarios ───────────────────────────────────────────────────────────

export type ScenariosMode = 'preparing' | 'no_scenarios' | 'ready'

export function scenariosMode(plan: PointBPlanState): ScenariosMode {
  if (plan.scenarios.length > 0) return 'ready'
  return plan.status === 'published' ? 'no_scenarios' : 'preparing'
}

export interface ScenarioCardView {
  key: ScenarioResult['key']
  label: string
  selected: boolean
  feasible: boolean
  reason: string | null
  time: RangeText
  revenue: RangeText
  /** «89% цели к сроку» — only when the revenue at the deadline is below the target. */
  share: string | null
}

export function scenarioCards(scenarios: ScenarioResult[], selected: string | null, target: number | null): ScenarioCardView[] {
  return scenarios.map((s) => {
    const rev = s.revenueAtDeadline.base
    const share = target && target > 0 && rev !== null && rev < target ? `${Math.round((rev / target) * 100)}% цели к сроку` : null
    return {
      key: s.key,
      label: s.label,
      selected: s.key === selected,
      feasible: s.feasible,
      reason: s.feasible ? null : s.infeasibleReason ?? 'Требует прироста выше потолка реализуемости',
      time: monthsRange(s.timeToGoalMonths),
      revenue: moneyRange(s.revenueAtDeadline),
      share,
    }
  })
}

export interface ComparisonRow { key: string; label: string; cells: string[][] }

/** How a lever value reads: shares as %, money as ₸, counts as plain numbers. */
function fmtLever(lever: ScenarioResult['requiredUplift'][number]['lever'], n: number | null): string {
  if (n === null) return DASH
  if (lever === 'conversion' || lever === 'repeat') return n <= 1 ? fmtPct(n * 100) : fmtPct(n)
  if (lever === 'avgCheck' || lever === 'growth') return fmtMoney(n)
  return fmtNumber(n)
}

function upliftLine(u: ScenarioResult['requiredUplift'][number]): string {
  const up = u.upliftPct !== null ? ` (${fmtPct(u.upliftPct, true)})` : ''
  return `${u.label}: ${fmtLever(u.lever, u.current)} → ${fmtLever(u.lever, u.target)}${up}`
}

/** Numeric rows of the comparison table: one cell (lines of text) per scenario. */
export function comparisonRows(scenarios: ScenarioResult[]): ComparisonRow[] {
  const cell = (fn: (s: ScenarioResult) => string[]) => scenarios.map(fn)
  const rows: ComparisonRow[] = [
    { key: 'time', label: 'Срок выхода на цель', cells: cell((s) => { const r = monthsRange(s.timeToGoalMonths); return r.range ? [r.main, `диапазон ${r.range}`] : [r.main] }) },
    { key: 'revenue', label: 'Выручка к сроку цели (годовой темп)', cells: cell((s) => { const r = moneyRange(s.revenueAtDeadline); return r.range ? [r.main, `диапазон ${r.range}`] : [r.main] }) },
    { key: 'feasible', label: 'Реализуемость', cells: cell((s) => (s.feasible ? ['Достижим'] : ['Не достижим', s.infeasibleReason ?? 'выше потолка реализуемости'])) },
    { key: 'uplift', label: 'Прирост рычагов', cells: cell((s) => (s.requiredUplift.length ? s.requiredUplift.map(upliftLine) : [DASH])) },
    { key: 'marketing', label: 'Рост расходов на маркетинг в месяц', cells: cell((s) => [fmtMoney(s.investments.marketingMonthlyIncrease)]) },
    { key: 'invest', label: 'Вложения за период выхода', cells: cell((s) => [fmtMoney(s.investments.totalOverRamp)]) },
    { key: 'staff', label: 'Потребность в персонале', cells: cell((s) => [s.investments.staffNeed === null ? DASH : s.investments.staffNeed === 0 ? 'без найма' : `+${s.investments.staffNeed} чел.`]) },
  ]
  if (scenarios.some((s) => s.investments.note)) {
    rows.push({ key: 'investNote', label: 'К вложениям', cells: cell((s) => [s.investments.note || DASH]) })
  }
  return rows
}

export interface ComparisonGroup {
  key: string
  label: string
  columns: Array<{ scenarioKey: ScenarioResult['key']; scenarioLabel: string; items: string[] }>
}

/** Text groups, expandable: one list per scenario. */
export function comparisonGroups(scenarios: ScenarioResult[]): ComparisonGroup[] {
  const group = (key: string, label: string, pick: (s: ScenarioResult) => string[]): ComparisonGroup => ({
    key, label, columns: scenarios.map((s) => ({ scenarioKey: s.key, scenarioLabel: s.label, items: pick(s) })),
  })
  return [
    group('constraints', 'Ограничения', (s) => s.constraints),
    group('risks', 'Риски', (s) => s.risks),
    group('conditions', 'Условия успеха', (s) => s.conditions),
    group('downside', 'Если не получится', (s) => (s.downside ? [s.downside] : [])),
    group('reviewPoints', 'Точки пересмотра', (s) => s.reviewPoints),
    group('signs', 'Признаки, что пора менять темп', (s) => s.signsToChangePace),
    group('assumptions', 'Допущения расчёта', (s) => s.assumptions),
  ]
}

/** Horizontal position of a month on the chart. */
export function xForMonth(geo: Pick<CorridorGeometry, 'plot' | 'maxMonth'>, month: number): number {
  return geo.plot.left + (month / geo.maxMonth) * (geo.plot.right - geo.plot.left)
}

/** Month under a pointer at `x`, snapped to the nearest point of the series (month 0 = now). */
export function nearestPoint(d: CorridorChartData, geo: Pick<CorridorGeometry, 'plot' | 'maxMonth'>, x: number): TrajPoint | null {
  const pts = cleanPoints(d)
  if (!pts.length || !finite(x)) return null
  const month = ((x - geo.plot.left) / (geo.plot.right - geo.plot.left)) * geo.maxMonth
  return pts.reduce((best, p) => (Math.abs(p.month - month) < Math.abs(best.month - month) ? p : best), pts[0])
}

export function pointReadout(p: TrajPoint): string {
  const when = p.month === 0 ? 'Сейчас' : `Через ${Math.round(p.month)} мес.`
  return p.low === p.high ? `${when}: ${fmtMoney(p.base)}` : `${when}: ${fmtMoney(p.base)} (коридор ${fmtMoney(p.low)} – ${fmtMoney(p.high)})`
}
