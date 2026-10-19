/**
 * components/giga-panel/user360/point-b/strategyController.ts — the brain of the expert's strategy editor in a plan
 * draft (plan Ф5 Task 6, spec §11), free of React and of the DOM so it can be tested with a fetch double (same approach
 * as scenariosController.ts). `useStrategyEditor` binds it to the panel; the panel only draws `getSnapshot()`.
 *
 * Contract (plan Ф5 Task 4), under /api/giga-admin/users/:id/point-b/plan/versions/:versionId/strategy:
 *   PUT { strategy: PlanStrategy } → { ok, data: { strategy, version } }
 *       400 { ok:false, error, field }  — the tree is refused (field like `items[3].dependsOn[0]`) or profanity
 *       403 not your client · 404 not your version · 409 the version is not a draft (`not_editable`)
 * The server is the authority; the same pure `validateStrategy` runs here first so the mistake is shown under its field
 * before anything is sent. The whole tree is sent (the server replaces, it does not merge).
 *
 * The tree is edited in memory: nodes get stable keys on creation (`crypto.randomUUID()`), a key never changes on an edit
 * (it links the task to the client's action plan). Levels are strategy → initiative → task; `dependsOn` can point only to
 * nodes of the SAME level and never to a node that already waits for this one (no cycle can be made from the UI).
 */
import { STRATEGY_LIMITS, type Milestone, type PlanStrategy, type StrategyKind, type StrategyNode } from '@/lib/point-b/strategy/types'
import { buildMatrix } from '@/lib/point-b/strategy/matrix'
import { validateStrategy } from '@/lib/point-b/strategy/validate'
import { childrenOf, coerceMilestones, coerceNodes } from '@/components/point-b/strategyModel'

export { STRATEGY_LIMITS }

/** The pure functions the editor leans on; tests may replace them. */
export interface EditorDeps {
  newKey: () => string
  validate: (raw: unknown) => { ok: true; strategy: PlanStrategy } | { ok: false; error: string; field: string }
  buildMatrix: typeof buildMatrix
}

export function randomKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.padEnd(8, '0')
}

const DEFAULT_DEPS: EditorDeps = { newKey: randomKey, validate: (raw) => validateStrategy(raw), buildMatrix }

// ── Pure helpers ────────────────────────────────────────────────────────

export const LIMIT_BY_KIND: Record<StrategyKind, number> = {
  strategy: STRATEGY_LIMITS.strategies,
  initiative: STRATEGY_LIMITS.initiatives,
  task: STRATEGY_LIMITS.tasks,
}

export const KIND_ONE: Record<StrategyKind, string> = { strategy: 'стратегию', initiative: 'инициативу', task: 'задачу' }
export const KIND_NOM: Record<StrategyKind, string> = { strategy: 'Стратегия', initiative: 'Инициатива', task: 'Задача' }
export const CHILD_KIND: Record<StrategyKind, StrategyKind | null> = { strategy: 'initiative', initiative: 'task', task: null }

export interface LimitRow { kind: StrategyKind | 'milestone'; label: string; used: number; max: number }

export function limitRows(s: PlanStrategy): LimitRow[] {
  const n = (k: StrategyKind) => s.items.filter((x) => x.kind === k).length
  return [
    { kind: 'strategy', label: 'Стратегий', used: n('strategy'), max: STRATEGY_LIMITS.strategies },
    { kind: 'initiative', label: 'Инициатив', used: n('initiative'), max: STRATEGY_LIMITS.initiatives },
    { kind: 'task', label: 'Задач', used: n('task'), max: STRATEGY_LIMITS.tasks },
    { kind: 'milestone', label: 'Контрольных точек', used: s.milestones.length, max: STRATEGY_LIMITS.milestones },
  ]
}

export function canAdd(s: PlanStrategy, kind: StrategyKind | 'milestone'): boolean {
  const row = limitRows(s).find((r) => r.kind === kind)
  return !!row && row.used < row.max
}

/** All keys below a node (not the node itself). */
export function descendantKeys(items: StrategyNode[], key: string): string[] {
  const out: string[] = []
  const stack = [key]
  while (stack.length) {
    const k = stack.pop()!
    for (const n of items) if (n.parentKey === k && !out.includes(n.key)) { out.push(n.key); stack.push(n.key) }
  }
  return out
}

/** The parents of a node, nearest first. */
export function ancestorKeys(items: StrategyNode[], key: string): string[] {
  const byKey = new Map(items.map((n) => [n.key, n]))
  const out: string[] = []
  let cur = byKey.get(key)?.parentKey ?? null
  while (cur && !out.includes(cur)) { out.push(cur); cur = byKey.get(cur)?.parentKey ?? null }
  return out
}

/**
 * Nodes this node can wait for: the SAME level, not itself, not already chosen, and not a node that (directly or
 * through others) already waits for this one — so a cycle cannot be made.
 */
export function dependencyCandidates(items: StrategyNode[], key: string): StrategyNode[] {
  const me = items.find((n) => n.key === key)
  if (!me) return []
  const byKey = new Map(items.map((n) => [n.key, n]))
  // who waits for me, transitively
  const waitsForMe = new Set<string>()
  const stack = [key]
  while (stack.length) {
    const k = stack.pop()!
    for (const n of items) if (n.dependsOn.includes(k) && !waitsForMe.has(n.key)) { waitsForMe.add(n.key); stack.push(n.key) }
  }
  return items.filter((n) => n.kind === me.kind && n.key !== key && !me.dependsOn.includes(n.key) && !waitsForMe.has(n.key) && byKey.has(n.key))
}

/** A number typed by a person: empty → null, «2,5» → 2.5, junk → not ok. */
export function parseNumberInput(text: string): { ok: true; value: number | null } | { ok: false } {
  const t = text.trim().replace(/\s/g, '').replace(',', '.')
  if (t === '') return { ok: true, value: null }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false }
  const v = Number(t)
  return Number.isFinite(v) ? { ok: true, value: v } : { ok: false }
}

// ── Field errors ────────────────────────────────────────────────────────

export interface EditorErrors {
  /** A refusal about the tree as a whole (a limit, size, an unreadable body). */
  general: string | null
  /** node key → field name → text. */
  nodes: Record<string, Record<string, string>>
  /** milestone key → field name → text. */
  milestones: Record<string, Record<string, string>>
}

export const NO_ERRORS: EditorErrors = { general: null, nodes: {}, milestones: {} }

export type LocatedField =
  | { scope: 'node'; key: string; name: string }
  | { scope: 'milestone'; key: string; name: string }
  | { scope: 'general' }

/** `items[3].dependsOn[0]` → the node at index 3, field «dependsOn»; `items[1].kpi.name` → «kpi»; `milestones[1].date` → the milestone. */
export function locateField(field: string, s: PlanStrategy): LocatedField {
  const m = /^(items|milestones)\[(\d+)\](?:\.([A-Za-z]+))?/.exec(field)
  if (!m) return { scope: 'general' }
  const i = Number(m[2])
  if (m[1] === 'items') {
    const node = s.items[i]
    return node ? { scope: 'node', key: node.key, name: m[3] ?? 'node' } : { scope: 'general' }
  }
  const ms = s.milestones[i]
  return ms ? { scope: 'milestone', key: ms.key, name: m[3] ?? 'milestone' } : { scope: 'general' }
}

export function errorsFrom(refusal: { error: string; field: string }, s: PlanStrategy): { errors: EditorErrors; at: LocatedField } {
  const at = locateField(refusal.field, s)
  if (at.scope === 'node') return { at, errors: { general: null, nodes: { [at.key]: { [at.name]: refusal.error } }, milestones: {} } }
  if (at.scope === 'milestone') return { at, errors: { general: null, nodes: {}, milestones: { [at.key]: { [at.name]: refusal.error } } } }
  return { at, errors: { general: refusal.error, nodes: {}, milestones: {} } }
}

// ── Snapshot ────────────────────────────────────────────────────────────

export interface StrategySnapshot {
  strategy: PlanStrategy
  /** Edited and not saved yet. */
  dirty: boolean
  /** «Сохранить» was pressed: errors are shown and kept fresh while editing. */
  attempted: boolean
  errors: EditorErrors
  busy: boolean
  notice: string | null
  /** The server's refusal that is not tied to a field (409, 403, no connection…). */
  serverError: { message: string; status: number } | null
  /** Nodes whose children are shown (aria-expanded). */
  expanded: ReadonlySet<string>
  /** Nodes whose form is open. */
  editing: ReadonlySet<string>
  pendingRemove: { key: string; title: string; kind: StrategyKind; descendants: number } | null
}

export type NodePatch = Partial<Pick<StrategyNode, 'title' | 'description' | 'ownerLabel' | 'dueDate' | 'impact' | 'effort' | 'metricId' | 'block' | 'delayRisk'>>
export type MilestonePatch = Partial<Pick<Milestone, 'title' | 'date' | 'description' | 'kpi'>>

const DEFAULT_ERROR: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  400: 'Сервер не принял стратегию — проверьте поля',
  401: 'Сессия закончилась — войдите заново',
  403: 'Недостаточно прав или клиент вам не назначен',
  404: 'Версия не найдена',
  409: 'Стратегию можно менять только в черновике — обновите страницу',
}

const blankToNull = (v: string): string | null => (v.trim() === '' ? null : v)

/** The strategy stored in a version (`pb_plan_versions.strategy`), read tolerantly; `{}` is an empty one. */
export function strategyFromRaw(raw: unknown): PlanStrategy {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return { items: coerceNodes(o.items), milestones: coerceMilestones(o.milestones) }
}

export class StrategyEditor {
  private snap: StrategySnapshot
  private listeners = new Set<() => void>()
  private readonly deps: EditorDeps

  constructor(
    private readonly userId: string,
    private readonly versionId: string,
    initial: unknown,
    private readonly fetchFn: typeof fetch,
    private readonly opts: { editable?: boolean; onSaved?: () => void; deps?: Partial<EditorDeps> } = {},
  ) {
    this.deps = { ...DEFAULT_DEPS, ...(opts.deps ?? {}) }
    const strategy = strategyFromRaw(initial)
    this.snap = {
      strategy,
      dirty: false,
      attempted: false,
      errors: NO_ERRORS,
      busy: false,
      notice: null,
      serverError: null,
      // the strategies and the initiatives are open at the start, forms are closed
      expanded: new Set(strategy.items.filter((n) => n.kind !== 'task').map((n) => n.key)),
      editing: new Set(),
      pendingRemove: null,
    }
  }

  get editable(): boolean { return this.opts.editable !== false }

  private get url(): string {
    return `/api/giga-admin/users/${this.userId}/point-b/plan/versions/${encodeURIComponent(this.versionId)}/strategy`
  }

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): StrategySnapshot => this.snap

  private set(patch: Partial<StrategySnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  /** The preview of the matrix, from the tree as it is now. */
  matrix(): ReturnType<typeof buildMatrix> { return this.deps.buildMatrix(this.snap.strategy.items) }

  /** The version was reloaded from the server: take it unless there are unsaved edits. */
  sync(raw: unknown): void {
    if (this.snap.dirty || this.snap.busy) return
    const strategy = strategyFromRaw(raw)
    if (JSON.stringify(strategy) === JSON.stringify(this.snap.strategy)) return
    this.set({ strategy, errors: NO_ERRORS, attempted: false })
  }

  // ── structure ─────────────────────────────────────────────────────────

  /** The tree changed: unsaved, the old message is gone, errors are refreshed after the first save attempt. */
  private commit(strategy: PlanStrategy, extra: Partial<StrategySnapshot> = {}): void {
    const patch: Partial<StrategySnapshot> = { strategy, dirty: true, notice: null, serverError: null, ...extra }
    if (this.snap.attempted) patch.errors = this.check(strategy).errors
    this.set(patch)
  }

  private check(strategy: PlanStrategy): { ok: boolean; errors: EditorErrors; at: LocatedField | null; prepared: PlanStrategy } {
    const prepared = prepareForSave(strategy)
    const r = this.deps.validate(prepared)
    if (r.ok) return { ok: true, errors: NO_ERRORS, at: null, prepared: r.strategy }
    const { errors, at } = errorsFrom(r, prepared)
    return { ok: false, errors, at, prepared }
  }

  /** Adds a node under `parentKey` (null for a strategy); returns its key, or null when it is not allowed. */
  add(kind: StrategyKind, parentKey: string | null): string | null {
    if (!this.editable) return null
    const s = this.snap.strategy
    const parent = parentKey ? s.items.find((n) => n.key === parentKey) : null
    if (kind === 'strategy' ? parentKey !== null : !parent || CHILD_KIND[parent.kind] !== kind) return null
    if (!canAdd(s, kind)) {
      this.set({ notice: null, serverError: { message: `Достигнут предел: не больше ${LIMIT_BY_KIND[kind]}`, status: 400 } })
      return null
    }
    const siblings = s.items.filter((n) => n.kind === kind && n.parentKey === parentKey)
    const node: StrategyNode = {
      key: this.deps.newKey(), kind, parentKey, title: '', description: null, ownerLabel: null, dueDate: null, impact: null, effort: null,
      metricId: null, block: null, kpi: null, dependsOn: [], delayRisk: null, order: siblings.reduce((m, n) => Math.max(m, n.order), -1) + 1,
    }
    const expanded = new Set(this.snap.expanded)
    if (parentKey) expanded.add(parentKey)
    expanded.add(node.key)
    this.commit({ ...s, items: [...s.items, node] }, { expanded, editing: new Set(this.snap.editing).add(node.key) })
    return node.key
  }

  addStrategy(): string | null { return this.add('strategy', null) }
  addInitiative(strategyKey: string): string | null { return this.add('initiative', strategyKey) }
  addTask(initiativeKey: string): string | null { return this.add('task', initiativeKey) }

  /** Edits fields of a node. Its key, level and parent never change. Blank optional texts become null. */
  update(key: string, patch: NodePatch): void {
    if (!this.editable) return
    const s = this.snap.strategy
    const clean: NodePatch = { ...patch }
    for (const f of ['description', 'ownerLabel', 'metricId', 'block', 'delayRisk'] as const) {
      if (typeof clean[f] === 'string') clean[f] = blankToNull(clean[f] as string)
    }
    if (clean.dueDate !== undefined) clean.dueDate = clean.dueDate ? clean.dueDate : null
    this.commit({
      ...s,
      items: s.items.map((n) => {
        if (n.key !== key) return n
        const next = { ...n, ...clean }
        // a task has no rating
        if (n.kind === 'task') { next.impact = null; next.effort = null }
        return next
      }),
    })
  }

  /** KPI of a node: any of the three parts; all empty → no KPI. */
  updateKpi(key: string, patch: { name?: string; target?: number | null; unit?: string | null }): void {
    if (!this.editable) return
    const s = this.snap.strategy
    this.commit({
      ...s,
      items: s.items.map((n) => {
        if (n.key !== key) return n
        const cur = n.kpi ?? { name: '', target: null, unit: null }
        const next = {
          name: patch.name !== undefined ? patch.name : cur.name,
          target: patch.target !== undefined ? patch.target : cur.target,
          unit: patch.unit !== undefined ? (patch.unit === null ? null : blankToNull(patch.unit)) : cur.unit,
        }
        const empty = next.name.trim() === '' && next.target === null && next.unit === null
        return { ...n, kpi: empty ? null : next }
      }),
    })
  }

  // ── dependencies ──────────────────────────────────────────────────────

  addDependency(key: string, depKey: string): boolean {
    if (!this.editable) return false
    const s = this.snap.strategy
    if (!dependencyCandidates(s.items, key).some((n) => n.key === depKey)) return false
    this.commit({ ...s, items: s.items.map((n) => (n.key === key ? { ...n, dependsOn: [...n.dependsOn, depKey] } : n)) })
    return true
  }

  removeDependency(key: string, depKey: string): void {
    if (!this.editable) return
    const s = this.snap.strategy
    this.commit({ ...s, items: s.items.map((n) => (n.key === key ? { ...n, dependsOn: n.dependsOn.filter((d) => d !== depKey) } : n)) })
  }

  // ── order and removal ─────────────────────────────────────────────────

  move(key: string, dir: 'up' | 'down'): void {
    if (!this.editable) return
    const s = this.snap.strategy
    const me = s.items.find((n) => n.key === key)
    if (!me) return
    const group = childrenOf(s.items, me.parentKey, me.kind)
    const i = group.findIndex((n) => n.key === key)
    const j = dir === 'up' ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= group.length) return
    const order = group.map((n) => n.key)
    ;[order[i], order[j]] = [order[j], order[i]]
    const pos = new Map(order.map((k, idx) => [k, idx]))
    this.commit({ ...s, items: s.items.map((n) => (pos.has(n.key) ? { ...n, order: pos.get(n.key)! } : n)) })
  }

  /** Asks for the confirmation: a node is removed together with everything below it. */
  requestRemove(key: string): void {
    if (!this.editable) return
    const node = this.snap.strategy.items.find((n) => n.key === key)
    if (!node) return
    this.set({ pendingRemove: { key, title: node.title, kind: node.kind, descendants: descendantKeys(this.snap.strategy.items, key).length } })
  }

  cancelRemove(): void { this.set({ pendingRemove: null }) }

  confirmRemove(): void {
    const p = this.snap.pendingRemove
    if (!p || !this.editable) return
    const s = this.snap.strategy
    const gone = new Set([p.key, ...descendantKeys(s.items, p.key)])
    const items = s.items
      .filter((n) => !gone.has(n.key))
      // whoever waited for a removed node does not wait for it any more
      .map((n) => (n.dependsOn.some((d) => gone.has(d)) ? { ...n, dependsOn: n.dependsOn.filter((d) => !gone.has(d)) } : n))
    const expanded = new Set(Array.from(this.snap.expanded).filter((k) => !gone.has(k)))
    const editing = new Set(Array.from(this.snap.editing).filter((k) => !gone.has(k)))
    this.commit({ ...s, items }, { pendingRemove: null, expanded, editing })
  }

  toggleExpanded(key: string): void {
    const next = new Set(this.snap.expanded)
    if (!next.delete(key)) next.add(key)
    this.set({ expanded: next })
  }

  toggleEditing(key: string): void {
    const next = new Set(this.snap.editing)
    if (!next.delete(key)) next.add(key)
    this.set({ editing: next })
  }

  // ── milestones ────────────────────────────────────────────────────────

  addMilestone(): string | null {
    if (!this.editable) return null
    const s = this.snap.strategy
    if (!canAdd(s, 'milestone')) {
      this.set({ serverError: { message: `Достигнут предел: не больше ${STRATEGY_LIMITS.milestones} контрольных точек`, status: 400 } })
      return null
    }
    const m: Milestone = { key: this.deps.newKey(), title: '', date: '', description: null, kpi: null }
    this.commit({ ...s, milestones: [...s.milestones, m] })
    return m.key
  }

  updateMilestone(key: string, patch: MilestonePatch): void {
    if (!this.editable) return
    const s = this.snap.strategy
    const clean: MilestonePatch = { ...patch }
    if (typeof clean.description === 'string') clean.description = blankToNull(clean.description)
    if (typeof clean.kpi === 'string') clean.kpi = blankToNull(clean.kpi)
    this.commit({ ...s, milestones: s.milestones.map((m) => (m.key === key ? { ...m, ...clean } : m)) })
  }

  removeMilestone(key: string): void {
    if (!this.editable) return
    const s = this.snap.strategy
    this.commit({ ...s, milestones: s.milestones.filter((m) => m.key !== key) })
  }

  // ── check and save ────────────────────────────────────────────────────

  /** Opens the form of the node with the mistake (and its parents) so the text under the field is visible. */
  private reveal(at: LocatedField | null): Partial<StrategySnapshot> {
    if (!at || at.scope !== 'node') return {}
    const expanded = new Set(this.snap.expanded)
    for (const k of ancestorKeys(this.snap.strategy.items, at.key)) expanded.add(k)
    return { expanded, editing: new Set(this.snap.editing).add(at.key) }
  }

  /** Pre-validation with the same pure module as the server. */
  validate(): boolean {
    const r = this.check(this.snap.strategy)
    this.set({ attempted: true, errors: r.errors, ...(r.ok ? {} : this.reveal(r.at)) })
    return r.ok
  }

  async save(): Promise<boolean> {
    if (!this.editable || this.snap.busy) return false
    const r = this.check(this.snap.strategy)
    if (!r.ok) {
      this.set({ attempted: true, errors: r.errors, notice: null, serverError: null, ...this.reveal(r.at) })
      return false
    }
    this.set({ busy: true, attempted: true, errors: NO_ERRORS, notice: null, serverError: null })
    let status = 0
    let body: Record<string, unknown> | null = null
    try {
      const res = await this.fetchFn(this.url, {
        method: 'PUT',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: r.prepared }),
      })
      status = res.status
      body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!(res.ok && body?.ok !== false)) status = status || 500
      else {
        const data = body && typeof body.data === 'object' && body.data ? (body.data as Record<string, unknown>) : null
        // The server stores what it normalised; show that.
        const saved = data && data.strategy ? strategyFromRaw(data.strategy) : r.prepared
        const keep = saved.items.length > 0 || r.prepared.items.length === 0 ? saved : r.prepared
        this.set({
          busy: false,
          dirty: false,
          attempted: false,
          errors: NO_ERRORS,
          strategy: keep,
          notice: 'Стратегия сохранена. Клиент увидит её после одобрения версии, а задачи появятся в его плане действий.',
        })
        this.opts.onSaved?.()
        return true
      }
    } catch {
      status = 0
    }
    const text = typeof body?.error === 'string' && body.error.trim() ? body.error : typeof body?.message === 'string' ? body.message : ''
    const field = typeof body?.field === 'string' ? body.field : null
    if (field && text && status === 400) {
      const { errors, at } = errorsFrom({ error: text, field }, r.prepared)
      this.set({ busy: false, errors, serverError: errors.general ? null : { message: text, status }, ...this.reveal(at) })
    } else {
      this.set({ busy: false, serverError: { message: text || DEFAULT_ERROR[status] || `Ошибка сервера (${status})`, status } })
    }
    return false
  }
}

/**
 * The tree as it is sent: the KPI without a name is kept as typed (the validation names the field), empty strings are
 * null, the siblings are numbered 0…n−1 in the order shown. Keys, levels and parents are untouched.
 */
export function prepareForSave(s: PlanStrategy): PlanStrategy {
  const order = new Map<string, number>()
  const groups = new Map<string, StrategyNode[]>()
  for (const n of s.items) {
    const g = `${n.kind}:${n.parentKey ?? ''}`
    groups.set(g, [...(groups.get(g) ?? []), n])
  }
  groups.forEach((list) => {
    ;[...list].sort((a, b) => a.order - b.order).forEach((n, i) => order.set(n.key, i))
  })
  return {
    items: s.items.map((n) => ({
      ...n,
      title: n.title,
      dueDate: n.dueDate || null,
      order: order.get(n.key) ?? n.order,
      kpi: n.kpi && n.kpi.name.trim() === '' && n.kpi.target === null && !n.kpi.unit ? null : n.kpi,
      dependsOn: [...n.dependsOn],
    })),
    milestones: s.milestones.map((m) => ({ ...m })),
  }
}
