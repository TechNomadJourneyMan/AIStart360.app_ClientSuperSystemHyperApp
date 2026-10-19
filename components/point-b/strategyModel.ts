/**
 * components/point-b/strategyModel.ts — display logic of the client «Стратегия» and «Дорожная карта»
 * tabs and of the expert's matrix preview (plan Ф5 Tasks 5–6), free of React and of the DOM so it can
 * be unit-tested.
 *
 * It speaks the contract of `GET /api/v1/point-b/state` (plan Ф5, «Контракты»):
 *   data.plan.strategy = { items: StrategyNode[], milestones: Milestone[],
 *                          progress: Record<nodeKey, NodeProgress>, matrix: { points: MatrixPoint[], unrated: number } } | null
 * `null` = there is no APPROVED version (a draft never reaches the client). The parser is tolerant: a field the
 * server did not send becomes an empty value, never a crash and never NaN on the screen.
 *
 * Only TYPES of the server modules are imported — nothing is calculated here that the server owns
 * (progress, the matrix quadrants). The geometry of the two charts is pure and finite.
 *
 * No invented numbers: a missing rating, date or progress is «—» / «нет задач», never 0.
 */
import type { Milestone, StrategyKind, StrategyNode } from '@/lib/point-b/strategy/types'
import type { MatrixPoint, Quadrant } from '@/lib/point-b/strategy/matrix'
import type { NodeProgress } from '@/lib/point-b/strategy/progress'
import { DASH, fmtNumber } from './overviewModel'

// ── Types ───────────────────────────────────────────────────────────────

export interface PointBStrategyState {
  items: StrategyNode[]
  milestones: Milestone[]
  progress: Record<string, NodeProgress>
  matrix: { points: MatrixPoint[]; unrated: number }
}

export type ProgressState = NodeProgress['state']

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const nonNegInt = (v: unknown): number => (finite(v) && v >= 0 ? Math.floor(v) : 0)

// ── Dates (YYYY-MM-DD, no time zone) ────────────────────────────────────

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar day in `YYYY-MM-DD`, otherwise null (2026-02-30 is not one). */
export function isoDay(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = ISO_DAY.exec(v)
  if (!m) return null
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? v : null
}

/** Whole days since 1970-01-01 of a valid ISO day (null when it is not one). */
export function dayNumber(iso: string | null): number | null {
  const ok = isoDay(iso)
  if (!ok) return null
  const m = ISO_DAY.exec(ok)!
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

/** Today in the visitor's time zone as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']

/** «15 нояб. 2026»; anything that is not a valid day → «—». */
export function fmtDay(iso: string | null | undefined): string {
  const ok = isoDay(iso ?? null)
  if (!ok) return DASH
  const m = ISO_DAY.exec(ok)!
  return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}`
}

// ── Parsing ─────────────────────────────────────────────────────────────

const KINDS: readonly StrategyKind[] = ['strategy', 'initiative', 'task']
const PROGRESS_STATES: readonly ProgressState[] = ['no_tasks', 'not_started', 'in_progress', 'done']
const QUADRANTS: readonly Quadrant[] = ['quick_wins', 'big_bets', 'fill_ins', 'avoid']

const rating = (v: unknown): number | null => (finite(v) && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null)

/** Tolerant reading of the tree: an unreadable node is dropped, an unreadable field becomes null. Kinds that cannot hold a rating lose it. */
export function coerceNodes(raw: unknown): StrategyNode[] {
  const out: StrategyNode[] = []
  const seen = new Set<string>()
  ;(Array.isArray(raw) ? raw : []).forEach((r, i) => {
    if (!isObj(r)) return
    const key = text(r.key)
    const kind = KINDS.find((k) => k === r.kind)
    if (!key || !kind || seen.has(key)) return
    seen.add(key)
    const k = isObj(r.kpi) && text(r.kpi.name) ? r.kpi : null
    const rated = kind !== 'task'
    out.push({
      key,
      kind,
      parentKey: text(r.parentKey),
      title: text(r.title) ?? '',
      description: text(r.description),
      ownerLabel: text(r.ownerLabel),
      dueDate: isoDay(r.dueDate),
      impact: rated ? rating(r.impact) : null,
      effort: rated ? rating(r.effort) : null,
      metricId: text(r.metricId),
      block: text(r.block),
      kpi: k ? { name: String(k.name), target: finite(k.target) ? k.target : null, unit: text(k.unit) } : null,
      dependsOn: (Array.isArray(r.dependsOn) ? r.dependsOn : []).filter((d): d is string => typeof d === 'string' && d !== ''),
      delayRisk: text(r.delayRisk),
      order: finite(r.order) ? r.order : i,
    })
  })
  return out
}

export function coerceMilestones(raw: unknown): Milestone[] {
  const out: Milestone[] = []
  const seen = new Set<string>()
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r)) continue
    const key = text(r.key)
    const date = isoDay(r.date)
    if (!key || !date || seen.has(key)) continue
    seen.add(key)
    out.push({ key, title: text(r.title) ?? '', date, description: text(r.description), kpi: text(r.kpi) })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

function coerceProgress(raw: unknown): Record<string, NodeProgress> {
  const out: Record<string, NodeProgress> = {}
  if (!isObj(raw)) return out
  for (const [key, v] of Object.entries(raw)) {
    if (!isObj(v)) continue
    const state = PROGRESS_STATES.find((s) => s === v.state)
    if (!state) continue
    const tasks = nonNegInt(v.tasks)
    out[key] = {
      key,
      tasks,
      done: Math.min(nonNegInt(v.done), tasks),
      inProgress: nonNegInt(v.inProgress),
      percent: state === 'no_tasks' ? null : finite(v.percent) ? Math.max(0, Math.min(100, Math.round(v.percent))) : null,
      state,
    }
  }
  return out
}

/** The quadrant rule of the plan: impact ≥ 3 & effort ≤ 3 → quick wins; impact ≥ 3 & effort ≥ 4 → big bets; impact ≤ 2 & effort ≤ 3 → fill-ins; else avoid. */
export function quadrantOf(impact: number, effort: number): Quadrant {
  if (impact >= 3) return effort <= 3 ? 'quick_wins' : 'big_bets'
  return effort <= 3 ? 'fill_ins' : 'avoid'
}

function coerceMatrix(raw: unknown, items: StrategyNode[]): PointBStrategyState['matrix'] {
  if (isObj(raw) && Array.isArray(raw.points)) {
    const points: MatrixPoint[] = []
    for (const p of raw.points) {
      if (!isObj(p)) continue
      const key = text(p.key)
      const impact = rating(p.impact)
      const effort = rating(p.effort)
      if (!key || impact === null || effort === null) continue
      const kind: MatrixPoint['kind'] = p.kind === 'strategy' ? 'strategy' : 'initiative'
      const quadrant = QUADRANTS.find((q) => q === p.quadrant) ?? quadrantOf(impact, effort)
      points.push({ key, title: text(p.title) ?? '', kind, impact, effort, quadrant })
    }
    return { points, unrated: nonNegInt(raw.unrated) }
  }
  // The server did not send the matrix: the same rule, from the tree itself.
  const rated = items.filter((n) => n.kind !== 'task')
  const points = rated.flatMap((n): MatrixPoint[] => (n.impact !== null && n.effort !== null
    ? [{ key: n.key, title: n.title, kind: n.kind === 'strategy' ? 'strategy' : 'initiative', impact: n.impact, effort: n.effort, quadrant: quadrantOf(n.impact, n.effort) }]
    : []))
  return { points, unrated: rated.length - points.length }
}

/** `data.plan.strategy` → state; null (no approved version) and anything unreadable → null. */
export function parseStrategyState(raw: unknown): PointBStrategyState | null {
  if (!isObj(raw)) return null
  const items = coerceNodes(raw.items)
  return { items, milestones: coerceMilestones(raw.milestones), progress: coerceProgress(raw.progress), matrix: coerceMatrix(raw.matrix, items) }
}

/** From the whole body of `GET /api/v1/point-b/state`. */
export function parseStrategyFromBody(body: unknown): PointBStrategyState | null {
  if (!isObj(body) || !isObj(body.data) || !isObj(body.data.plan)) return null
  return parseStrategyState(body.data.plan.strategy)
}

// ── Modes of the two tabs ───────────────────────────────────────────────

export type StrategyMode = 'loading' | 'error' | 'preparing' | 'empty' | 'ready'

/**
 * loading → skeleton; error → retry card; no strategy and no approved plan → «Эксперт готовит стратегию»;
 * an approved plan without items → «В плане пока нет стратегии»; otherwise the content.
 */
export function strategyMode(snap: { phase: string; result: unknown; plan: { status: string }; strategy?: PointBStrategyState | null }): StrategyMode {
  if (snap.phase === 'loading') return 'loading'
  if (snap.phase === 'error' && !snap.result) return 'error'
  if (snap.strategy) return snap.strategy.items.length > 0 ? 'ready' : 'empty'
  return snap.plan.status === 'published' ? 'empty' : 'preparing'
}

// ── Labels ──────────────────────────────────────────────────────────────

export const PROGRESS_LABEL: Record<ProgressState, string> = {
  no_tasks: 'нет задач',
  not_started: 'не начато',
  in_progress: 'в работе',
  done: 'выполнено',
}

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  quick_wins: 'Быстрые победы',
  big_bets: 'Крупные проекты',
  fill_ins: 'Можно отложить',
  avoid: 'Не стоит',
}

export const QUADRANT_HINT: Record<Quadrant, string> = {
  quick_wins: 'большое влияние, умеренное усилие — с этого стоит начать',
  big_bets: 'большое влияние, большое усилие — планировать отдельно',
  fill_ins: 'малое влияние, умеренное усилие — когда будут силы',
  avoid: 'малое влияние, большое усилие — вряд ли окупится',
}

export const QUADRANT_ORDER: readonly Quadrant[] = ['quick_wins', 'big_bets', 'fill_ins', 'avoid']

export const KIND_LABEL: Record<StrategyKind, string> = { strategy: 'Стратегия', initiative: 'Инициатива', task: 'Задача' }

export const TASK_STATUS_LABEL = { done: 'Выполнена', in_progress: 'В работе', open: 'Не начата', missing: 'Нет в плане действий' } as const
export type TaskStatusKey = keyof typeof TASK_STATUS_LABEL

/** The only place where the action plan is: the «Подробности» tab of this page. */
export const ACTION_PLAN_TAB = 'details' as const
export const ACTION_PLAN_LINK_TEXT = 'Открыть в плане действий'

// ── Progress ────────────────────────────────────────────────────────────

export interface ProgressView {
  /** `unknown` = the server sent nothing for the node (shown as «—», not as 0%). */
  state: ProgressState | 'unknown'
  label: string
  /** null = no bar. */
  percent: number | null
  /** «1 из 4 задач выполнено» or the reason for «—». */
  detail: string
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

export const tasksWord = (n: number): string => plural(n, 'задача', 'задачи', 'задач')
/** After «из»: из 1 задачи, из 4 задач. */
const tasksOf = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? 'задачи' : 'задач')

export function progressView(p: NodeProgress | undefined): ProgressView {
  if (!p) return { state: 'unknown', label: DASH, percent: null, detail: 'прогресс не рассчитан' }
  if (p.state === 'no_tasks' || p.tasks === 0) return { state: 'no_tasks', label: PROGRESS_LABEL.no_tasks, percent: null, detail: 'в плане действий нет задач этого узла' }
  const detail = `${p.done} из ${p.tasks} ${tasksOf(p.tasks)} выполнено${p.inProgress > 0 ? `, в работе ${p.inProgress}` : ''}`
  return { state: p.state, label: PROGRESS_LABEL[p.state], percent: p.percent, detail }
}

export interface TaskStatusView { key: TaskStatusKey | 'unknown'; label: string; overdue: boolean }

/**
 * The status of a task node comes from its own entry in `progress` (the server counts a task by the live row of
 * the action plan): done / in progress / not started; no row (deleted by the client) → «Нет в плане действий».
 */
export function taskStatusView(node: StrategyNode, progress: Record<string, NodeProgress>, today: string): TaskStatusView {
  const p = progress[node.key]
  if (!p) return { key: 'unknown', label: DASH, overdue: false }
  const key: TaskStatusKey = p.tasks === 0 || p.state === 'no_tasks' ? 'missing' : p.state === 'done' || (p.done > 0 && p.done >= p.tasks) ? 'done' : p.inProgress > 0 || p.state === 'in_progress' ? 'in_progress' : 'open'
  const overdue = (key === 'open' || key === 'in_progress') && !!node.dueDate && node.dueDate < today
  return { key, label: TASK_STATUS_LABEL[key as TaskStatusKey], overdue }
}

// ── Node texts ──────────────────────────────────────────────────────────

export function ratingText(label: 'Влияние' | 'Усилие', v: number | null): string {
  return v === null ? `${label} ${DASH}` : `${label} ${v} из 5`
}

export function kpiText(kpi: StrategyNode['kpi']): string | null {
  if (!kpi) return null
  const target = kpi.target !== null ? ` → ${fmtNumber(kpi.target)}${kpi.unit ? ` ${kpi.unit}` : ''}` : kpi.unit ? ` (${kpi.unit})` : ''
  return `${kpi.name}${target}`
}

// ── Tree for the «Стратегия» tab ────────────────────────────────────────

export interface TaskView { node: StrategyNode; status: TaskStatusView }
export interface InitiativeView { node: StrategyNode; progress: ProgressView; tasks: TaskView[] }
export interface StrategyCardView { node: StrategyNode; progress: ProgressView; initiatives: InitiativeView[] }

const byOrder = (a: StrategyNode, b: StrategyNode): number => a.order - b.order || a.title.localeCompare(b.title, 'ru')

export function childrenOf(items: StrategyNode[], parentKey: string | null, kind: StrategyKind): StrategyNode[] {
  return items.filter((n) => n.kind === kind && n.parentKey === parentKey).sort(byOrder)
}

/** Strategies → initiatives → tasks, each level in the expert's order. Orphans (a parent that is gone) are left out. */
export function buildCards(state: PointBStrategyState, today: string): StrategyCardView[] {
  return childrenOf(state.items, null, 'strategy').map((s) => ({
    node: s,
    progress: progressView(state.progress[s.key]),
    initiatives: childrenOf(state.items, s.key, 'initiative').map((i) => ({
      node: i,
      progress: progressView(state.progress[i.key]),
      tasks: childrenOf(state.items, i.key, 'task').map((t) => ({ node: t, status: taskStatusView(t, state.progress, today) })),
    })),
  }))
}

export interface StrategyCounts { strategies: number; initiatives: number; tasks: number; milestones: number }

export function strategyCounts(state: Pick<PointBStrategyState, 'items' | 'milestones'>): StrategyCounts {
  const n = (k: StrategyKind) => state.items.filter((x) => x.kind === k).length
  return { strategies: n('strategy'), initiatives: n('initiative'), tasks: n('task'), milestones: state.milestones.length }
}

export function countsLine(c: StrategyCounts): string {
  return [
    `${c.strategies} ${plural(c.strategies, 'стратегия', 'стратегии', 'стратегий')}`,
    `${c.initiatives} ${plural(c.initiatives, 'инициатива', 'инициативы', 'инициатив')}`,
    `${c.tasks} ${tasksWord(c.tasks)}`,
  ].join(' · ')
}

// ── Dependencies («X ждёт Y») ───────────────────────────────────────────

export interface DependencyLine { key: string; text: string; resolved: boolean }

export function dependencyLines(state: Pick<PointBStrategyState, 'items' | 'progress'>): DependencyLine[] {
  const byKey = new Map(state.items.map((n) => [n.key, n]))
  const out: DependencyLine[] = []
  for (const n of [...state.items].sort(byOrder)) {
    for (const dep of n.dependsOn) {
      const target = byKey.get(dep)
      if (!target || target.key === n.key) continue
      const resolved = state.progress[target.key]?.state === 'done'
      out.push({ key: `${n.key}>${dep}`, text: `${KIND_LABEL[n.kind]} «${n.title || DASH}» ждёт «${target.title || DASH}»`, resolved })
    }
  }
  return out
}

// ── Impact × effort matrix ──────────────────────────────────────────────

export interface NumberedPoint extends MatrixPoint { n: number }
export interface MatrixGroup { quadrant: Quadrant; label: string; hint: string; points: NumberedPoint[] }

/** The points grouped by quadrant (fixed order) and numbered 1…N in that order — the chart and the list share the numbers. */
export function matrixGroups(points: MatrixPoint[]): MatrixGroup[] {
  let n = 0
  return QUADRANT_ORDER.map((q) => ({
    quadrant: q,
    label: QUADRANT_LABEL[q],
    hint: QUADRANT_HINT[q],
    points: points
      .filter((p) => p.quadrant === q)
      .sort((a, b) => b.impact - a.impact || a.effort - b.effort || a.title.localeCompare(b.title, 'ru'))
      .map((p) => ({ ...p, n: ++n })),
  }))
}

export function unratedText(unrated: number): string {
  return unrated > 0 ? `без оценки: ${unrated}` : 'все оценены'
}

export function matrixSummary(matrix: { points: MatrixPoint[]; unrated: number }): string {
  if (matrix.points.length === 0) return `Матрица пуста: нет стратегий и инициатив с оценкой влияния и усилия (${unratedText(matrix.unrated)}).`
  const parts = matrixGroups(matrix.points).filter((g) => g.points.length > 0).map((g) => `${g.label}: ${g.points.map((p) => p.title || DASH).join(', ')}`)
  return `Матрица влияния и усилия. ${parts.join('. ')}. ${unratedText(matrix.unrated)}.`
}

export interface MatrixGeometry {
  width: number
  height: number
  plot: { left: number; right: number; top: number; bottom: number }
  /** The quadrant rectangles with the position of their caption. */
  quadrants: Array<{ quadrant: Quadrant; label: string; x: number; y: number; w: number; h: number; tx: number; ty: number; anchor: 'start' | 'end' }>
  points: Array<{ key: string; n: number; kind: 'strategy' | 'initiative'; x: number; y: number; quadrant: Quadrant }>
  xTicks: Array<{ x: number; label: string }>
  yTicks: Array<{ y: number; label: string }>
}

export const MATRIX_SIZE = { width: 360, height: 300 } as const

export function matrixGeometry(groups: MatrixGroup[]): MatrixGeometry {
  const { width, height } = MATRIX_SIZE
  const plot = { left: 40, right: width - 12, top: 10, bottom: height - 44 }
  const cw = (plot.right - plot.left) / 5
  const ch = (plot.bottom - plot.top) / 5
  const bx = plot.left + 3 * cw // effort 1–3 | 4–5
  const by = plot.bottom - 2 * ch // impact 1–2 | 3–5
  const rect = (q: Quadrant) => {
    const left = q === 'quick_wins' || q === 'fill_ins'
    const top = q === 'quick_wins' || q === 'big_bets'
    const x = left ? plot.left : bx
    const y = top ? plot.top : by
    const w = left ? bx - plot.left : plot.right - bx
    const h = top ? by - plot.top : plot.bottom - by
    return { quadrant: q, label: QUADRANT_LABEL[q], x, y, w, h, tx: left ? x + 6 : x + w - 6, ty: y + 14, anchor: (left ? 'start' : 'end') as 'start' | 'end' }
  }
  const all = groups.flatMap((g) => g.points)
  const cell = new Map<string, NumberedPoint[]>()
  for (const p of all) {
    const k = `${p.impact}:${p.effort}`
    cell.set(k, [...(cell.get(k) ?? []), p])
  }
  const points: MatrixGeometry['points'] = []
  for (const list of Array.from(cell.values())) {
    list.forEach((p, i) => {
      const cx = plot.left + (p.effort - 0.5) * cw
      const cy = plot.bottom - (p.impact - 0.5) * ch
      const spread = list.length > 1 ? 11 : 0
      const angle = (2 * Math.PI * i) / list.length - Math.PI / 2
      points.push({ key: p.key, n: p.n, kind: p.kind, x: round1(cx + spread * Math.cos(angle)), y: round1(cy + spread * Math.sin(angle)), quadrant: p.quadrant })
    })
  }
  points.sort((a, b) => a.n - b.n)
  return {
    width,
    height,
    plot,
    quadrants: QUADRANT_ORDER.map(rect),
    points,
    xTicks: [1, 2, 3, 4, 5].map((v) => ({ x: round1(plot.left + (v - 0.5) * cw), label: String(v) })),
    yTicks: [1, 2, 3, 4, 5].map((v) => ({ y: round1(plot.bottom - (v - 0.5) * ch), label: String(v) })),
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10

// ── Roadmap ─────────────────────────────────────────────────────────────

export interface Quarter { key: string; label: string; startDay: number; endDay: number; index: number }

const ROMAN = ['I', 'II', 'III', 'IV']

/** Calendar quarter number (year·4 + 0..3) of a valid ISO day. */
export function quarterIndex(iso: string): number | null {
  const ok = isoDay(iso)
  if (!ok) return null
  const m = ISO_DAY.exec(ok)!
  return Number(m[1]) * 4 + Math.floor((Number(m[2]) - 1) / 3)
}

export function quarterOf(index: number): Quarter {
  const year = Math.floor(index / 4)
  const q = index - year * 4
  const startDay = Math.round(Date.UTC(year, q * 3, 1) / 86_400_000)
  const endDay = Math.round(Date.UTC(year, q * 3 + 3, 1) / 86_400_000) - 1
  return { key: `${year}-Q${q + 1}`, label: `${ROMAN[q]} кв. ${year}`, startDay, endDay, index }
}

/** More quarters than this are not drawn: the rest is counted in `outside` and stays in the list. */
export const MAX_QUARTERS = 12

export interface RoadmapRow {
  key: string
  kind: 'strategy' | 'initiative'
  title: string
  /** The span of dated work under the node; null = nothing is dated. */
  start: string | null
  end: string | null
  progress: ProgressView
}

export type RoadmapItemType = 'milestone' | 'task' | 'initiative' | 'strategy'

export interface RoadmapItem {
  id: string
  type: RoadmapItemType
  date: string | null
  title: string
  /** For a task: the initiative it belongs to. */
  context: string | null
  owner: string | null
  kpi: string | null
  description: string | null
  status: TaskStatusView | null
}

export interface RoadmapQuarter { quarter: Quarter; items: RoadmapItem[]; isCurrent: boolean }

export interface Roadmap {
  quarters: Quarter[]
  rows: RoadmapRow[]
  milestones: RoadmapItem[]
  byQuarter: RoadmapQuarter[]
  /** Items with no date at all. */
  undated: RoadmapItem[]
  /** Dated items that fall outside the drawn quarters. */
  outside: number
  hasDates: boolean
  dependencies: DependencyLine[]
  today: string
}

function descendants(items: StrategyNode[], key: string): StrategyNode[] {
  const out: StrategyNode[] = []
  const stack = [key]
  const seen = new Set<string>([key])
  while (stack.length) {
    const k = stack.pop()!
    for (const n of items) {
      if (n.parentKey === k && !seen.has(n.key)) { seen.add(n.key); out.push(n); stack.push(n.key) }
    }
  }
  return out
}

export function buildRoadmap(state: PointBStrategyState, today: string): Roadmap {
  const { items, milestones, progress } = state
  const titleOf = (key: string | null) => (key ? items.find((n) => n.key === key)?.title || null : null)

  const rows: RoadmapRow[] = []
  for (const s of childrenOf(items, null, 'strategy')) {
    for (const node of [s, ...childrenOf(items, s.key, 'initiative')]) {
      const dates = [node.dueDate, ...descendants(items, node.key).map((d) => d.dueDate)].filter((d): d is string => !!d).sort()
      rows.push({
        key: node.key,
        kind: node.kind === 'strategy' ? 'strategy' : 'initiative',
        title: node.title,
        start: dates[0] ?? null,
        end: dates[dates.length - 1] ?? null,
        progress: progressView(progress[node.key]),
      })
    }
  }

  const toItem = (n: StrategyNode): RoadmapItem => ({
    id: n.key,
    type: n.kind,
    date: n.dueDate,
    title: n.title,
    context: n.kind === 'task' ? titleOf(n.parentKey) : n.kind === 'initiative' ? titleOf(n.parentKey) : null,
    owner: n.ownerLabel,
    kpi: kpiText(n.kpi),
    description: n.description,
    status: n.kind === 'task' ? taskStatusView(n, progress, today) : null,
  })
  const nodeItems = [...items].sort(byOrder).map(toItem)
  const milestoneItems: RoadmapItem[] = milestones.map((m) => ({
    id: m.key, type: 'milestone', date: m.date, title: m.title, context: null, owner: null, kpi: m.kpi, description: m.description, status: null,
  }))
  const everything = [...nodeItems, ...milestoneItems]
  const dated = everything.filter((i) => i.date)
  // Only tasks are listed without a date: a strategy or an initiative takes its span from its tasks.
  const undated = everything.filter((i) => !i.date && i.type === 'task')

  // The drawn window: from the first to the last dated item, today's quarter too when it fits.
  const indexes = dated.map((i) => quarterIndex(i.date!)).filter((v): v is number => v !== null)
  const todayIdx = quarterIndex(today)
  let quarters: Quarter[] = []
  let outside = 0
  if (indexes.length > 0) {
    let lo = Math.min(...indexes)
    let hi = Math.max(...indexes)
    if (todayIdx !== null && Math.max(hi, todayIdx) - Math.min(lo, todayIdx) + 1 <= MAX_QUARTERS) { lo = Math.min(lo, todayIdx); hi = Math.max(hi, todayIdx) }
    if (hi - lo + 1 > MAX_QUARTERS) hi = lo + MAX_QUARTERS - 1
    for (let i = lo; i <= hi; i++) quarters.push(quarterOf(i))
    outside = indexes.filter((i) => i < lo || i > hi).length
  }
  quarters = quarters.slice(0, MAX_QUARTERS)

  const byQuarter: RoadmapQuarter[] = quarters.map((quarter) => ({
    quarter,
    isCurrent: todayIdx === quarter.index,
    items: dated
      .filter((i) => quarterIndex(i.date!) === quarter.index)
      .sort((a, b) => a.date!.localeCompare(b.date!) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]),
  }))

  return {
    quarters,
    rows,
    milestones: milestoneItems.sort((a, b) => a.date!.localeCompare(b.date!)),
    byQuarter,
    undated,
    outside,
    hasDates: dated.length > 0,
    dependencies: dependencyLines(state),
    today,
  }
}

const TYPE_ORDER: Record<RoadmapItemType, number> = { milestone: 0, strategy: 1, initiative: 2, task: 3 }

export function roadmapSummary(r: Roadmap): string {
  if (!r.hasDates) return 'Дорожная карта: в плане пока нет сроков.'
  const first = r.quarters[0]
  const last = r.quarters[r.quarters.length - 1]
  const span = first.key === last.key ? first.label : `с ${first.label} по ${last.label}`
  const n = (t: RoadmapItemType) => r.byQuarter.reduce((a, q) => a + q.items.filter((i) => i.type === t).length, 0)
  return `Дорожная карта ${span}: ${n('task')} ${tasksWord(n('task'))} со сроком, контрольных точек ${n('milestone')}.`
}

export interface TimelineGeometry {
  width: number
  height: number
  plot: { left: number; right: number; top: number; bottom: number }
  quarters: Array<{ key: string; label: string; x: number; w: number; current: boolean }>
  milestoneLane: { y: number }
  milestones: Array<{ key: string; title: string; date: string; x: number; y: number }>
  rows: Array<{
    key: string
    kind: 'strategy' | 'initiative'
    label: string
    full: string
    y: number
    /** null = the node has no dated work. */
    bar: { x1: number; x2: number; fillX: number } | null
    percent: number | null
    state: ProgressView['state']
  }>
  todayX: number | null
}

export const TIMELINE_WIDTH = 760
const LABEL_W = 190
const ROW_H = 26
const HEAD_H = 24
const LANE_H = 26

export function truncate(s: string, max: number): string {
  const t = s.trim() || DASH
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…` : t
}

export function timelineGeometry(r: Roadmap): TimelineGeometry | null {
  if (!r.hasDates || r.quarters.length === 0) return null
  const width = TIMELINE_WIDTH
  const left = LABEL_W
  const right = width - 10
  const startDay = r.quarters[0].startDay
  const endDay = r.quarters[r.quarters.length - 1].endDay + 1
  const span = Math.max(1, endDay - startDay)
  const x = (day: number): number => round1(left + ((Math.min(endDay, Math.max(startDay, day)) - startDay) / span) * (right - left))
  const xOf = (iso: string): number => x(dayNumber(iso) ?? startDay)

  const top = HEAD_H + LANE_H
  const rows = r.rows.map((row, i) => {
    const y = top + i * ROW_H
    let bar: TimelineGeometry['rows'][number]['bar'] = null
    if (row.start && row.end) {
      const x1 = xOf(row.start)
      const x2 = Math.max(xOf(row.end), x1 + 8)
      const pct = row.progress.percent
      bar = { x1, x2, fillX: pct === null ? x1 : round1(x1 + ((x2 - x1) * pct) / 100) }
    }
    return { key: row.key, kind: row.kind, label: truncate(row.title, row.kind === 'strategy' ? 28 : 26), full: row.title || DASH, y, bar, percent: row.progress.percent, state: row.progress.state }
  })
  const todayDay = dayNumber(r.today)
  return {
    width,
    height: top + Math.max(1, rows.length) * ROW_H + 18,
    plot: { left, right, top, bottom: top + Math.max(1, rows.length) * ROW_H },
    quarters: r.quarters.map((q) => ({
      key: q.key,
      label: q.label,
      x: x(q.startDay),
      w: Math.max(0, round1(x(q.endDay + 1) - x(q.startDay))),
      current: todayDay !== null && todayDay >= q.startDay && todayDay <= q.endDay,
    })),
    milestoneLane: { y: HEAD_H },
    milestones: r.milestones.map((m) => ({ key: m.id, title: m.title, date: m.date!, x: xOf(m.date!), y: HEAD_H + LANE_H / 2 })),
    rows,
    todayX: todayDay !== null && todayDay >= startDay && todayDay <= endDay - 1 ? x(todayDay) : null,
  }
}
