/**
 * lib/point-b/strategy/validate.ts — validation and normalisation of the strategy tree of a plan
 * version. Pure, no IO. Everything that comes from a person (the PUT route, the editor's pre-check) and
 * everything about to be stored goes through here, so the stored JSON always has the same shape.
 *
 *   levels         strategy (root) → initiative (child of a strategy) → task (child of an initiative)
 *   limits         12 strategies, 60 initiatives, 300 tasks, 24 milestones; title ≤ 200, text ≤ 2000;
 *                  the whole JSON ≤ 400 KB
 *   keys           8–64 characters [A-Za-z0-9_-], unique among the nodes (and among the milestones)
 *   impact/effort  integers 1..5, only on strategies and initiatives (null = not rated)
 *   dependsOn      keys of nodes of the SAME level, no self-reference, no cycle
 *   dates          YYYY-MM-DD, a real calendar day
 *   moderation     profanity in any text a person writes is refused with the field
 *
 * A refusal names the field (`items[3].dependsOn[0]`, `milestones[1].date`) and says in Russian what is
 * wrong. `{}` (the stored default of the column) is an empty strategy. Unknown properties are dropped.
 */
import { hasProfanity, ProfanityError } from '@/lib/moderation/profanity'
import { STRATEGY_LIMITS, type Milestone, type PlanStrategy, type StrategyKind, type StrategyNode } from './types'

export type StrategyValidation =
  | { ok: true; strategy: PlanStrategy }
  | { ok: false; error: string; field: string; /** The refusal is about profanity (the route answers code «profanity»). */ profanity?: true }

/** A stored / submitted strategy that does not pass validation (the store throws it as the second line of defence). */
export class StrategyError extends Error {
  constructor(message: string, public readonly field: string, public readonly profanity = false) {
    super(message)
    this.name = 'StrategyError'
  }
}

class Refusal extends Error {
  constructor(public readonly field: string, message: string, public readonly profanity = false) {
    super(message)
  }
}

const KINDS: readonly StrategyKind[] = ['strategy', 'initiative', 'task']
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const PROFANITY_TEXT = new ProfanityError().message
const SHORT = 200
const UNIT_MAX = 40

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k)

function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (y < 2000 || y > 2100) return false
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

interface Ctx { moderation: boolean }

/** An optional text: undefined / null / blank → null; a non-string, too long or profane → refusal. */
function text(c: Ctx, o: Record<string, unknown>, k: string, field: string, label: string, max: number): string | null {
  const v = o[k]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') throw new Refusal(field, `${label}: нужен текст`)
  const t = v.trim()
  if (t.length > max) throw new Refusal(field, `${label}: не больше ${max} символов`)
  if (!t) return null
  if (c.moderation && hasProfanity(t)) throw new Refusal(field, PROFANITY_TEXT, true)
  return t
}

function requiredText(c: Ctx, o: Record<string, unknown>, k: string, field: string, label: string, max: number): string {
  const t = text(c, o, k, field, label, max)
  if (t === null) throw new Refusal(field, `${label}: заполните`)
  return t
}

function date(o: Record<string, unknown>, k: string, field: string, label: string): string | null {
  const v = o[k]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string' || !isRealDate(v)) throw new Refusal(field, `${label}: дата в формате ГГГГ-ММ-ДД (например 2026-12-31)`)
  return v
}

function score(o: Record<string, unknown>, k: string, field: string, label: string, kind: StrategyKind): number | null {
  const v = o[k]
  if (v === undefined || v === null) return null
  if (kind === 'task') throw new Refusal(field, `${label}: у задачи нет оценки — оценивается стратегия или инициатива`)
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) throw new Refusal(field, `${label}: целое число от 1 до 5`)
  return v
}

function kpiOf(c: Ctx, o: Record<string, unknown>, field: string): StrategyNode['kpi'] {
  const v = o.kpi
  if (v === undefined || v === null) return null
  if (!isObject(v)) throw new Refusal(field, 'KPI: нужны название, цель и единица')
  const name = requiredText(c, v, 'name', `${field}.name`, 'Название KPI', SHORT)
  let target: number | null = null
  if (v.target !== undefined && v.target !== null) {
    if (typeof v.target !== 'number' || !Number.isFinite(v.target)) throw new Refusal(`${field}.target`, 'Цель KPI: нужно число')
    target = v.target
  }
  return { name, target, unit: text(c, v, 'unit', `${field}.unit`, 'Единица KPI', UNIT_MAX) }
}

function nodeOf(c: Ctx, raw: unknown, i: number): StrategyNode {
  const f = `items[${i}]`
  if (!isObject(raw)) throw new Refusal(f, 'Узел стратегии должен быть объектом')
  const kind = raw.kind
  if (typeof kind !== 'string' || !KINDS.includes(kind as StrategyKind)) {
    throw new Refusal(`${f}.kind`, 'Уровень узла: стратегия, инициатива или задача')
  }
  const k = kind as StrategyKind
  if (typeof raw.key !== 'string' || !KEY_RE.test(raw.key)) {
    throw new Refusal(`${f}.key`, 'Ключ узла: 8–64 символа (латиница, цифры, «-», «_»)')
  }
  if (raw.parentKey !== undefined && raw.parentKey !== null && typeof raw.parentKey !== 'string') {
    throw new Refusal(`${f}.parentKey`, 'Родитель узла: ключ или пусто')
  }
  let dependsOn: string[] = []
  if (raw.dependsOn !== undefined && raw.dependsOn !== null) {
    if (!Array.isArray(raw.dependsOn)) throw new Refusal(`${f}.dependsOn`, 'Зависимости: список ключей')
    if (raw.dependsOn.length > 60) throw new Refusal(`${f}.dependsOn`, 'Зависимостей не больше 60')
    raw.dependsOn.forEach((d, j) => {
      if (typeof d !== 'string' || !d) throw new Refusal(`${f}.dependsOn[${j}]`, 'Зависимость: ключ узла')
    })
    dependsOn = [...new Set(raw.dependsOn as string[])]
  }
  let order = i
  if (raw.order !== undefined && raw.order !== null) {
    if (typeof raw.order !== 'number' || !Number.isInteger(raw.order) || raw.order < 0 || raw.order > 100_000) {
      throw new Refusal(`${f}.order`, 'Порядок: целое число от 0')
    }
    order = raw.order
  }
  return {
    key: raw.key,
    kind: k,
    parentKey: (raw.parentKey as string | null | undefined) ?? null,
    title: requiredText(c, raw, 'title', `${f}.title`, 'Название', STRATEGY_LIMITS.title),
    description: text(c, raw, 'description', `${f}.description`, 'Описание', STRATEGY_LIMITS.description),
    ownerLabel: text(c, raw, 'ownerLabel', `${f}.ownerLabel`, 'Ответственный', SHORT),
    dueDate: date(raw, 'dueDate', `${f}.dueDate`, 'Срок'),
    impact: score(raw, 'impact', `${f}.impact`, 'Влияние', k),
    effort: score(raw, 'effort', `${f}.effort`, 'Усилие', k),
    metricId: text({ moderation: false }, raw, 'metricId', `${f}.metricId`, 'Метрика', SHORT),
    block: text({ moderation: false }, raw, 'block', `${f}.block`, 'Блок', SHORT),
    kpi: kpiOf(c, raw, `${f}.kpi`),
    dependsOn,
    delayRisk: text(c, raw, 'delayRisk', `${f}.delayRisk`, 'Риск задержки', STRATEGY_LIMITS.description),
    order,
  }
}

function milestoneOf(c: Ctx, raw: unknown, i: number): Milestone {
  const f = `milestones[${i}]`
  if (!isObject(raw)) throw new Refusal(f, 'Контрольная точка должна быть объектом')
  if (typeof raw.key !== 'string' || !KEY_RE.test(raw.key)) {
    throw new Refusal(`${f}.key`, 'Ключ контрольной точки: 8–64 символа (латиница, цифры, «-», «_»)')
  }
  const title = requiredText(c, raw, 'title', `${f}.title`, 'Название контрольной точки', STRATEGY_LIMITS.title)
  const d = date(raw, 'date', `${f}.date`, 'Дата контрольной точки')
  if (d === null) throw new Refusal(`${f}.date`, 'Дата контрольной точки: заполните (ГГГГ-ММ-ДД)')
  return {
    key: raw.key,
    title,
    date: d,
    description: text(c, raw, 'description', `${f}.description`, 'Описание', STRATEGY_LIMITS.description),
    kpi: text(c, raw, 'kpi', `${f}.kpi`, 'KPI', SHORT),
  }
}

/** Parents, dependencies and cycles — after every node is read. */
function checkLinks(items: StrategyNode[]): void {
  const byKey = new Map<string, { node: StrategyNode; index: number }>()
  items.forEach((node, index) => {
    if (byKey.has(node.key)) throw new Refusal(`items[${index}].key`, 'Ключ узла повторяется — у каждого узла свой ключ')
    byKey.set(node.key, { node, index })
  })

  items.forEach((node, index) => {
    const f = `items[${index}]`
    if (node.kind === 'strategy') {
      if (node.parentKey !== null) throw new Refusal(`${f}.parentKey`, 'Стратегия — корень дерева, у неё нет родителя')
    } else {
      const want: StrategyKind = node.kind === 'initiative' ? 'strategy' : 'initiative'
      const parent = node.parentKey ? byKey.get(node.parentKey)?.node : undefined
      if (!parent) {
        throw new Refusal(`${f}.parentKey`, node.kind === 'initiative' ? 'Инициатива должна входить в стратегию' : 'Задача должна входить в инициативу')
      }
      if (parent.kind !== want) {
        throw new Refusal(
          `${f}.parentKey`,
          node.kind === 'initiative' ? 'Инициатива входит только в стратегию' : 'Задача входит только в инициативу — глубже вложенность не поддерживается',
        )
      }
    }
    node.dependsOn.forEach((dep, j) => {
      const field = `${f}.dependsOn[${j}]`
      if (dep === node.key) throw new Refusal(field, 'Узел не может зависеть от самого себя')
      const target = byKey.get(dep)
      if (!target) throw new Refusal(field, 'Зависимость указывает на несуществующий узел')
      if (target.node.kind !== node.kind) throw new Refusal(field, 'Зависимость возможна только между узлами одного уровня')
    })
  })

  // A cycle among the dependencies (depth-first, iterative; the edge that closes the cycle is named).
  const state = new Map<string, 1 | 2>()
  for (const { node: start } of byKey.values()) {
    if (state.has(start.key)) continue
    const stack: Array<{ key: string; next: number }> = [{ key: start.key, next: 0 }]
    state.set(start.key, 1)
    while (stack.length) {
      const top = stack[stack.length - 1]
      const { node, index } = byKey.get(top.key)!
      if (top.next >= node.dependsOn.length) {
        state.set(top.key, 2)
        stack.pop()
        continue
      }
      const j = top.next++
      const dep = node.dependsOn[j]
      const s = state.get(dep)
      if (s === 1) throw new Refusal(`items[${index}].dependsOn[${j}]`, 'Зависимости образуют цикл — укажите, что за чем идёт, без петли')
      if (s === undefined) {
        state.set(dep, 1)
        stack.push({ key: dep, next: 0 })
      }
    }
  }
}

/**
 * Validates and normalises a strategy tree. `moderation: false` skips the profanity filter — used only
 * to READ an already stored strategy (a word added to the filter later must not hide a published plan).
 */
export function validateStrategy(raw: unknown, opts: { moderation?: boolean } = {}): StrategyValidation {
  const c: Ctx = { moderation: opts.moderation !== false }
  try {
    if (!isObject(raw)) throw new Refusal('strategy', 'Стратегия должна быть объектом { items, milestones }')
    let json: string | undefined
    try {
      json = JSON.stringify(raw)
    } catch {
      throw new Refusal('strategy', 'Стратегию нельзя сохранить: данные не сериализуются')
    }
    if (json === undefined || new TextEncoder().encode(json).length > STRATEGY_LIMITS.jsonBytes) {
      throw new Refusal('strategy', 'Стратегия слишком большая: не больше 400 КБ')
    }

    const rawItems = has(raw, 'items') && raw.items !== undefined && raw.items !== null ? raw.items : []
    const rawMilestones = has(raw, 'milestones') && raw.milestones !== undefined && raw.milestones !== null ? raw.milestones : []
    if (!Array.isArray(rawItems)) throw new Refusal('items', 'Узлы стратегии: нужен список')
    if (!Array.isArray(rawMilestones)) throw new Refusal('milestones', 'Контрольные точки: нужен список')

    // Limits first: a tree that is far too big is refused before it is walked.
    const count = (kind: StrategyKind) => rawItems.filter((x) => isObject(x) && x.kind === kind).length
    if (count('strategy') > STRATEGY_LIMITS.strategies) throw new Refusal('items', `Стратегий не больше ${STRATEGY_LIMITS.strategies}`)
    if (count('initiative') > STRATEGY_LIMITS.initiatives) throw new Refusal('items', `Инициатив не больше ${STRATEGY_LIMITS.initiatives}`)
    if (count('task') > STRATEGY_LIMITS.tasks) throw new Refusal('items', `Задач не больше ${STRATEGY_LIMITS.tasks}`)
    if (rawMilestones.length > STRATEGY_LIMITS.milestones) throw new Refusal('milestones', `Контрольных точек не больше ${STRATEGY_LIMITS.milestones}`)

    const items = rawItems.map((x, i) => nodeOf(c, x, i))
    checkLinks(items)

    const seen = new Set<string>()
    const milestones = rawMilestones.map((x, i) => {
      const m = milestoneOf(c, x, i)
      if (seen.has(m.key)) throw new Refusal(`milestones[${i}].key`, 'Ключ контрольной точки повторяется')
      seen.add(m.key)
      return m
    })
    return { ok: true, strategy: { items, milestones } }
  } catch (err) {
    if (err instanceof Refusal) {
      return { ok: false, error: err.message, field: err.field, ...(err.profanity ? { profanity: true as const } : {}) }
    }
    throw err
  }
}

export interface StrategyCounts { strategies: number; initiatives: number; tasks: number; milestones: number }

/** Node counts by level of a stored or submitted strategy (tolerant: anything unexpected counts as nothing) — for the audit. */
export function strategyCounts(raw: unknown): StrategyCounts {
  const out: StrategyCounts = { strategies: 0, initiatives: 0, tasks: 0, milestones: 0 }
  if (!isObject(raw)) return out
  if (Array.isArray(raw.items)) {
    for (const n of raw.items) {
      const kind = isObject(n) ? n.kind : null
      if (kind === 'strategy') out.strategies++
      else if (kind === 'initiative') out.initiatives++
      else if (kind === 'task') out.tasks++
    }
  }
  if (Array.isArray(raw.milestones)) out.milestones = raw.milestones.length
  return out
}
