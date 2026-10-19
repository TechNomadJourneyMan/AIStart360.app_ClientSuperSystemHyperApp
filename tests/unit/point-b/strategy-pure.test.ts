/**
 * Pure modules of the strategy (Point B Ф5, task 2): validation of the tree, the impact × effort
 * matrix and the progress from task statuses. No IO.
 */
import { describe, expect, it } from 'vitest'
import { buildMatrix } from '@/lib/point-b/strategy/matrix'
import { computeProgress, type TaskStatus } from '@/lib/point-b/strategy/progress'
import { EMPTY_STRATEGY, type Milestone, type StrategyNode } from '@/lib/point-b/strategy/types'
import { validateStrategy } from '@/lib/point-b/strategy/validate'

let n = 0
const key = (p: string) => `${p}-${String(++n).padStart(8, '0')}`

const node = (kind: StrategyNode['kind'], parentKey: string | null, over: Partial<StrategyNode> = {}): StrategyNode => ({
  key: key(kind.slice(0, 3)), kind, parentKey, title: `Узел ${n}`, description: null, ownerLabel: null, dueDate: null,
  impact: kind === 'task' ? null : 3, effort: kind === 'task' ? null : 3, metricId: null, block: null, kpi: null,
  dependsOn: [], delayRisk: null, order: 0, ...over,
})
const milestone = (over: Partial<Milestone> = {}): Milestone => ({ key: key('mil'), title: 'Запуск', date: '2026-12-01', description: null, kpi: null, ...over })

/** strategy → 2 initiatives → 2 tasks each. */
function tree() {
  const s = node('strategy', null, { title: 'Рост выручки' })
  const i1 = node('initiative', s.key, { title: 'Реклама' })
  const i2 = node('initiative', s.key, { title: 'Повторные продажи' })
  const t1 = node('task', i1.key, { title: 'Запустить кампанию' })
  const t2 = node('task', i1.key, { title: 'Настроить пиксель' })
  const t3 = node('task', i2.key, { title: 'Рассылка' })
  const t4 = node('task', i2.key, { title: 'Скидка постоянным' })
  return { s, i1, i2, t1, t2, t3, t4, items: [s, i1, i2, t1, t2, t3, t4] }
}

const bad = (raw: unknown) => {
  const r = validateStrategy(raw)
  if (r.ok) throw new Error('expected a rejection')
  return r
}

describe('validateStrategy', () => {
  it('an empty strategy is valid', () => {
    expect(validateStrategy({ items: [], milestones: [] })).toEqual({ ok: true, strategy: { items: [], milestones: [] } })
    // the stored default of the column
    expect(validateStrategy({})).toEqual({ ok: true, strategy: { items: [], milestones: [] } })
    expect(validateStrategy(EMPTY_STRATEGY).ok).toBe(true)
    for (const raw of [null, undefined, 'x', 3, []]) expect(bad(raw).field).toBe('strategy')
  })

  it('a valid 3-level tree passes and comes back normalised', () => {
    const t = tree()
    t.i2.dependsOn = [t.i1.key]
    t.t2.dependsOn = [t.t1.key]
    t.t1.kpi = { name: ' Заказы ', target: 120, unit: 'шт' }
    t.t1.dueDate = '2026-11-30'
    t.t1.title = '  Запустить кампанию  '
    t.t2.description = '   '
    const r = validateStrategy({ items: t.items, milestones: [milestone({ kpi: '100 заказов' })] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.strategy.items).toHaveLength(7)
    const t1 = r.strategy.items.find((x) => x.key === t.t1.key)!
    expect(t1.title).toBe('Запустить кампанию')
    expect(t1.kpi).toEqual({ name: 'Заказы', target: 120, unit: 'шт' })
    expect(r.strategy.items.find((x) => x.key === t.t2.key)!.description).toBeNull()
    // JSON-safe and idempotent
    expect(JSON.parse(JSON.stringify(r.strategy))).toEqual(r.strategy)
    expect(validateStrategy(r.strategy)).toEqual(r)
  })

  it('an initiative without a strategy parent, a task without an initiative, a duplicate key, a self-dependency, a cross-level dependency and a dependency cycle are rejected with the field', () => {
    const base = () => tree()

    // an initiative without a parent / with a parent that is not a strategy / with an unknown parent
    let t = base()
    t.i1.parentKey = null
    expect(bad({ items: t.items, milestones: [] })).toMatchObject({ field: 'items[1].parentKey' })
    t = base()
    t.i1.parentKey = t.i2.key
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[1].parentKey')
    t = base()
    t.i1.parentKey = 'missing-key-1'
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[1].parentKey')

    // a task without an initiative, or directly under a strategy
    t = base()
    t.t1.parentKey = null
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[3].parentKey')
    t = base()
    t.t1.parentKey = t.s.key
    expect(bad({ items: t.items, milestones: [] })).toMatchObject({ field: 'items[3].parentKey' })
    // a task under a task (too deep)
    t = base()
    t.t2.parentKey = t.t1.key
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[4].parentKey')
    // a strategy with a parent
    t = base()
    t.s.parentKey = t.s.key
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[0].parentKey')

    // a duplicate key
    t = base()
    t.i2.key = t.i1.key
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[2].key')

    // a self-dependency
    t = base()
    t.i1.dependsOn = [t.i1.key]
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[1].dependsOn[0]')

    // a dependency on another level, and on an unknown key
    t = base()
    t.i1.dependsOn = [t.t1.key]
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[1].dependsOn[0]')
    t = base()
    t.t1.dependsOn = ['nobody-1234']
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[3].dependsOn[0]')

    // a cycle i1 → i2 → i1: the error names the edge that closes it
    t = base()
    t.i1.dependsOn = [t.i2.key]
    t.i2.dependsOn = [t.i1.key]
    const cycle = bad({ items: t.items, milestones: [] })
    expect(cycle.field).toMatch(/^items\[[12]\]\.dependsOn\[0\]$/)
    expect(cycle.error).toMatch(/цикл/i)
    // a longer cycle among tasks
    t = base()
    t.t1.dependsOn = [t.t2.key]
    t.t2.dependsOn = [t.t3.key]
    t.t3.dependsOn = [t.t1.key]
    expect(bad({ items: t.items, milestones: [] }).field).toMatch(/^items\[[345]\]\.dependsOn\[0\]$/)
    // a chain without a cycle is fine
    t = base()
    t.t1.dependsOn = [t.t2.key]
    t.t2.dependsOn = [t.t3.key]
    expect(validateStrategy({ items: t.items, milestones: [] }).ok).toBe(true)

    // a bad kind and a key of a wrong shape
    t = base()
    ;(t.i1 as unknown as { kind: string }).kind = 'epic'
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[1].kind')
    t = base()
    t.i1.key = 'short'
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[1].key')
    t = base()
    t.i1.title = '   '
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[1].title')
    expect(bad({ items: 'x', milestones: [] }).field).toBe('items')
    expect(bad({ items: [null], milestones: [] }).field).toBe('items[0]')
  })

  it('limits: 13 strategies, 61 initiatives, 301 tasks, 25 milestones are rejected', () => {
    const many = (k: StrategyNode['kind'], count: number) => {
      const parents = k === 'strategy' ? [] : k === 'initiative' ? [node('strategy', null)] : (() => { const s = node('strategy', null); return [s, node('initiative', s.key)] })()
      const parent = parents[parents.length - 1] ?? null
      const list = Array.from({ length: count }, () => node(k, parent?.key ?? null))
      return [...parents, ...list]
    }
    // at the limit: valid
    expect(validateStrategy({ items: many('strategy', 12), milestones: [] }).ok).toBe(true)
    expect(validateStrategy({ items: many('initiative', 60), milestones: [] }).ok).toBe(true)
    expect(validateStrategy({ items: many('task', 300), milestones: [] }).ok).toBe(true)
    expect(validateStrategy({ items: [], milestones: Array.from({ length: 24 }, () => milestone()) }).ok).toBe(true)
    // over it
    expect(bad({ items: many('strategy', 13), milestones: [] })).toMatchObject({ field: 'items', error: expect.stringMatching(/12/) })
    expect(bad({ items: many('initiative', 61), milestones: [] })).toMatchObject({ field: 'items', error: expect.stringMatching(/60/) })
    expect(bad({ items: many('task', 301), milestones: [] })).toMatchObject({ field: 'items', error: expect.stringMatching(/300/) })
    expect(bad({ items: [], milestones: Array.from({ length: 25 }, () => milestone()) })).toMatchObject({ field: 'milestones', error: expect.stringMatching(/24/) })
  })

  it('texts: a title over 200 and a description over 2000 characters are rejected', () => {
    let t = tree()
    t.s.title = 'я'.repeat(201)
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[0].title')
    t = tree()
    t.s.description = 'я'.repeat(2001)
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[0].description')
    t = tree()
    t.s.title = 'я'.repeat(200)
    t.s.description = 'я'.repeat(2000)
    expect(validateStrategy({ items: t.items, milestones: [] }).ok).toBe(true)
    expect(bad({ items: [], milestones: [milestone({ title: 'я'.repeat(201) })] }).field).toBe('milestones[0].title')
  })

  it('impact 0, 6 or 2.5, and impact on a task are rejected', () => {
    for (const v of [0, 6, 2.5, -1, Number.NaN, '3']) {
      const t = tree()
      ;(t.i1 as unknown as { impact: unknown }).impact = v
      expect(bad({ items: t.items, milestones: [] }).field, String(v)).toBe('items[1].impact')
    }
    for (const v of [0, 6, 2.5]) {
      const t = tree()
      ;(t.s as unknown as { effort: unknown }).effort = v
      expect(bad({ items: t.items, milestones: [] }).field).toBe('items[0].effort')
    }
    let t = tree()
    t.t1.impact = 3
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[3].impact')
    t = tree()
    t.t1.effort = 2
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[3].effort')
    // 1 and 5 and null are fine
    t = tree()
    t.i1.impact = 1
    t.i1.effort = 5
    t.i2.impact = null
    t.i2.effort = null
    expect(validateStrategy({ items: t.items, milestones: [] }).ok).toBe(true)
  })

  it('bad dates are rejected, including 2026-02-30', () => {
    for (const d of ['2026-02-30', '2026-13-01', '2026-00-10', '26-01-01', '2026/01/01', '2026-1-1', 'tomorrow', '2026-04-31', 20260101]) {
      const t = tree()
      ;(t.t1 as unknown as { dueDate: unknown }).dueDate = d
      expect(bad({ items: t.items, milestones: [] }).field, String(d)).toBe('items[3].dueDate')
      expect(bad({ items: [], milestones: [milestone({ date: d as string })] }).field, String(d)).toBe('milestones[0].date')
    }
    const t = tree()
    t.t1.dueDate = '2028-02-29' // a leap day
    expect(validateStrategy({ items: t.items, milestones: [milestone({ date: '2026-12-31' })] }).ok).toBe(true)
    // a milestone must have a date and a title
    expect(bad({ items: [], milestones: [{ ...milestone(), date: undefined }] }).field).toBe('milestones[0].date')
    expect(bad({ items: [], milestones: [milestone({ title: '' })] }).field).toBe('milestones[0].title')
    // milestone keys are unique
    const m = milestone()
    expect(bad({ items: [], milestones: [m, { ...m }] }).field).toBe('milestones[1].key')
  })

  it('kpi: a name is required, a target is a finite number', () => {
    let t = tree()
    t.t1.kpi = { name: ' ', target: 1, unit: null }
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[3].kpi.name')
    t = tree()
    t.t1.kpi = { name: 'Заказы', target: Number.POSITIVE_INFINITY, unit: null }
    // Infinity does not survive JSON; the value itself is refused
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[3].kpi.target')
    t = tree()
    ;(t.t1 as unknown as { kpi: unknown }).kpi = 'x'
    expect(bad({ items: t.items, milestones: [] }).field).toBe('items[3].kpi')
    t = tree()
    t.t1.kpi = { name: 'Заказы', target: null, unit: null }
    expect(validateStrategy({ items: t.items, milestones: [] }).ok).toBe(true)
  })

  it('profanity in title/description/delayRisk/kpi.name/ownerLabel/milestone is rejected with the field', () => {
    const swear = 'ты хуй'
    const cases: Array<[string, (t: ReturnType<typeof tree>) => void]> = [
      ['items[1].title', (t) => { t.i1.title = swear }],
      ['items[2].description', (t) => { t.i2.description = swear }],
      ['items[3].delayRisk', (t) => { t.t1.delayRisk = swear }],
      ['items[3].kpi.name', (t) => { t.t1.kpi = { name: swear, target: 1, unit: null } }],
      ['items[4].ownerLabel', (t) => { t.t2.ownerLabel = swear }],
    ]
    for (const [field, mutate] of cases) {
      const t = tree()
      mutate(t)
      const r = bad({ items: t.items, milestones: [] })
      expect(r.field).toBe(field)
      expect(r.error).toMatch(/нецензурн/)
    }
    for (const [field, m] of [
      ['milestones[0].title', milestone({ title: swear })],
      ['milestones[0].description', milestone({ description: swear })],
      ['milestones[0].kpi', milestone({ kpi: swear })],
    ] as const) {
      expect(bad({ items: [], milestones: [m] }).field).toBe(field)
    }
    // ordinary business words are not flagged
    const t = tree()
    t.s.title = 'Страхуй риски и снижай рубля потери'
    expect(validateStrategy({ items: t.items, milestones: [] }).ok).toBe(true)
  })

  it('JSON over 400 KB is rejected', () => {
    const t = tree()
    const fat = { ...t.s, junk: 'x'.repeat(401 * 1024) }
    const r = bad({ items: [fat, ...t.items.slice(1)], milestones: [] })
    expect(r.field).toBe('strategy')
    expect(r.error).toMatch(/400/)
    // unknown fields are dropped from a valid tree
    const ok = validateStrategy({ items: [{ ...t.s, junk: 'x' }, ...t.items.slice(1)], milestones: [] })
    expect(ok.ok && 'junk' in ok.strategy.items[0]).toBe(false)
    // a value that cannot be serialised
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    expect(bad(cyc).field).toBe('strategy')
  })
})

describe('buildMatrix', () => {
  it('matrix: quadrants by the rule, unrated initiatives counted and left out', () => {
    const s = node('strategy', null, { impact: 5, effort: 5, title: 'S' })
    const mk = (impact: number | null, effort: number | null, title: string) => node('initiative', s.key, { impact, effort, title })
    const items = [
      s,
      mk(3, 3, 'qw-edge'), mk(5, 1, 'qw'), mk(3, 4, 'bb-edge'), mk(5, 5, 'bb'),
      mk(2, 3, 'fi-edge'), mk(1, 1, 'fi'), mk(2, 4, 'av-edge'), mk(1, 5, 'av'),
      mk(null, 3, 'no-impact'), mk(3, null, 'no-effort'), mk(null, null, 'none'),
      node('task', null, { title: 'task' }),
    ]
    const m = buildMatrix(items)
    const q = Object.fromEntries(m.points.map((p) => [p.title, p.quadrant]))
    expect(q).toEqual({
      S: 'big_bets',
      'qw-edge': 'quick_wins', qw: 'quick_wins', 'bb-edge': 'big_bets', bb: 'big_bets',
      'fi-edge': 'fill_ins', fi: 'fill_ins', 'av-edge': 'avoid', av: 'avoid',
    })
    expect(m.points.find((p) => p.title === 'S')).toMatchObject({ kind: 'strategy', impact: 5, effort: 5 })
    expect(m.points.find((p) => p.title === 'qw')).toMatchObject({ kind: 'initiative', key: expect.any(String), impact: 5, effort: 1 })
    // initiatives without BOTH numbers are counted, never plotted; tasks are ignored
    expect(m.unrated).toBe(3)
    expect(m.points.some((p) => ['no-impact', 'no-effort', 'none', 'task'].includes(p.title))).toBe(false)
  })

  it('an empty list or a tree without ratings gives no points and no NaN', () => {
    expect(buildMatrix([])).toEqual({ points: [], unrated: 0 })
    const t = tree()
    for (const i of t.items) { i.impact = null; i.effort = null }
    expect(buildMatrix(t.items)).toEqual({ points: [], unrated: 2 })
  })
})

describe('computeProgress', () => {
  const st = (m: Record<string, TaskStatus>) => m as Record<string, TaskStatus | undefined>

  it('progress: no tasks → no_tasks and percent null; 1 of 4 done → 25 and in_progress; all done → done; tasks missing from the statuses are ignored; strategy progress aggregates its initiatives’ tasks', () => {
    const t = tree()
    // no statuses at all: nothing counts
    let p = computeProgress(t.items, {})
    expect(p[t.i1.key]).toEqual({ key: t.i1.key, tasks: 0, done: 0, inProgress: 0, percent: null, state: 'no_tasks' })
    expect(p[t.s.key]).toMatchObject({ tasks: 0, percent: null, state: 'no_tasks' })

    // an initiative with no tasks in the tree at all
    const lonely = node('initiative', t.s.key)
    expect(computeProgress([t.s, lonely], {})[lonely.key]).toMatchObject({ tasks: 0, percent: null, state: 'no_tasks' })

    // t1 done, t2 missing (deleted by the client): 1 of 1 → done for i1; i2 not started
    p = computeProgress(t.items, st({ [t.t1.key]: 'done', [t.t3.key]: 'open', [t.t4.key]: 'open' }))
    expect(p[t.i1.key]).toMatchObject({ tasks: 1, done: 1, percent: 100, state: 'done' })
    expect(p[t.i2.key]).toMatchObject({ tasks: 2, done: 0, inProgress: 0, percent: 0, state: 'not_started' })
    // the strategy pools the tasks of its initiatives: 1 done of 3
    expect(p[t.s.key]).toMatchObject({ tasks: 3, done: 1, percent: 33, state: 'in_progress' })

    // 1 of 4 done → 25 and in_progress
    p = computeProgress(t.items, st({ [t.t1.key]: 'done', [t.t2.key]: 'open', [t.t3.key]: 'open', [t.t4.key]: 'open' }))
    expect(p[t.s.key]).toEqual({ key: t.s.key, tasks: 4, done: 1, inProgress: 0, percent: 25, state: 'in_progress' })

    // in progress counts as started but not as done
    p = computeProgress(t.items, st({ [t.t1.key]: 'in_progress', [t.t2.key]: 'open', [t.t3.key]: 'open', [t.t4.key]: 'open' }))
    expect(p[t.s.key]).toMatchObject({ tasks: 4, done: 0, inProgress: 1, percent: 0, state: 'in_progress' })

    // all done → done
    p = computeProgress(t.items, st({ [t.t1.key]: 'done', [t.t2.key]: 'done', [t.t3.key]: 'done', [t.t4.key]: 'done' }))
    expect(p[t.s.key]).toMatchObject({ tasks: 4, done: 4, percent: 100, state: 'done' })
    expect(p[t.i1.key].state).toBe('done')

    // a status for a key that is not a task of the tree is ignored; an undefined entry is ignored
    p = computeProgress(t.items, { stranger: 'done', [t.t1.key]: undefined })
    expect(p[t.s.key].tasks).toBe(0)
  })

  it('rounds the percent to a whole number and is JSON-safe', () => {
    const s = node('strategy', null)
    const i = node('initiative', s.key)
    const ts = [node('task', i.key), node('task', i.key), node('task', i.key)]
    const p = computeProgress([s, i, ...ts], st({ [ts[0].key]: 'done', [ts[1].key]: 'done', [ts[2].key]: 'open' }))
    expect(p[i.key].percent).toBe(67)
    expect(JSON.parse(JSON.stringify(p))).toEqual(p)
    expect(computeProgress([], {})).toEqual({})
  })

  it('a task node itself reports its own status (the page shows it); a deleted task is «no_tasks»', () => {
    const t = tree()
    const p = computeProgress(t.items, st({ [t.t1.key]: 'done', [t.t2.key]: 'in_progress', [t.t3.key]: 'open' }))
    expect(p[t.t1.key]).toMatchObject({ tasks: 1, done: 1, percent: 100, state: 'done' })
    expect(p[t.t2.key]).toMatchObject({ tasks: 1, inProgress: 1, percent: 0, state: 'in_progress' })
    expect(p[t.t3.key]).toMatchObject({ tasks: 1, done: 0, percent: 0, state: 'not_started' })
    expect(p[t.t4.key]).toEqual({ key: t.t4.key, tasks: 0, done: 0, inProgress: 0, percent: null, state: 'no_tasks' })
  })
})
