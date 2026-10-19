/**
 * Expert strategy editor in a plan draft (plan Ф5 Task 6). The repo has no jsdom, so the behaviour lives in a
 * framework-free controller (components/giga-panel/user360/point-b/strategyController.ts) driven with a fetch double,
 * and the markup is checked with react-dom/server. The PUT route (plan Task 4) is built separately: the doubles follow the
 * contract of the plan. The pre-validation is the real pure `validateStrategy` (the same module as the server's).
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fixtureStrategyTree } from '@/lib/point-b/fixtures'
import type { PlanStrategy, StrategyNode } from '@/lib/point-b/strategy/types'
import {
  StrategyEditor, canAdd, dependencyCandidates, descendantKeys, limitRows, locateField, parseNumberInput, prepareForSave, strategyFromRaw,
} from '@/components/giga-panel/user360/point-b/strategyController'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => React.createElement('a', { href: p.href }, p.children) }))

const { StrategyPanelView, actionsOf } = await import('@/components/giga-panel/user360/point-b/StrategyPanel')
const { PlanPanelView } = await import('@/components/giga-panel/user360/point-b/PlanPanel')

const USER = 'cccccccc-0000-4000-8000-000000000001'
const VERSION = 'v-1'
const URL = `/api/giga-admin/users/${USER}/point-b/plan/versions/${VERSION}/strategy`

interface Call { method: string; url: string; body: unknown }
type Reply = { status: number; body: unknown }

function harness(replies: Reply[] = []) {
  const calls: Call[] = []
  const queue = [...replies]
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const r = queue.shift() ?? { status: 200, body: { ok: true, data: { strategy: calls[calls.length - 1].body && (calls[calls.length - 1].body as { strategy: unknown }).strategy, version: {} } } }
    return { ok: r.status < 400, status: r.status, json: async () => r.body }
  })
  return { fetchFn: fetchFn as unknown as typeof fetch, calls }
}

let counter = 0
const newKey = () => `key-${String(++counter).padStart(8, '0')}`

function editor(initial: unknown = {}, opts: { replies?: Reply[]; editable?: boolean; onSaved?: () => void } = {}) {
  const h = harness(opts.replies)
  const ctl = new StrategyEditor(USER, VERSION, initial, h.fetchFn, { editable: opts.editable, onSaved: opts.onSaved, deps: { newKey } })
  return { ctl, ...h }
}

const flat = (html: string) => html.replace(/&#x27;|&quot;/g, '"').replace(/[  ]/g, ' ')
const noop = () => undefined
function view(ctl: StrategyEditor, over: { editable?: boolean; versionNumber?: number | null } = {}) {
  return flat(renderToStaticMarkup(React.createElement(StrategyPanelView, {
    snap: ctl.getSnapshot(), actions: actionsOf(ctl), editable: over.editable ?? ctl.editable, versionNumber: over.versionNumber ?? 3, matrix: ctl.matrix(),
  })))
}

const byTitle = (s: PlanStrategy, title: string): StrategyNode => s.items.find((n) => n.title === title)!

/** A small valid tree: one strategy, one initiative, one task. */
function filled() {
  const e = editor()
  const s = e.ctl.addStrategy()!
  e.ctl.update(s, { title: 'Рост' })
  const i = e.ctl.addInitiative(s)!
  e.ctl.update(i, { title: 'Лояльность', impact: 4, effort: 2 })
  const t = e.ctl.addTask(i)!
  e.ctl.update(t, { title: 'Описать условия' })
  return { ...e, s, i, t }
}

describe('strategy editor: structure', () => {
  it('adds nodes with generated stable keys and keeps keys on edits', () => {
    const { ctl, s, i, t } = filled()
    const snap = ctl.getSnapshot().strategy
    expect(snap.items.map((n) => [n.kind, n.parentKey])).toEqual([['strategy', null], ['initiative', s], ['task', i]])
    expect(new Set([s, i, t]).size).toBe(3)
    for (const k of [s, i, t]) expect(k.length).toBeGreaterThanOrEqual(8)
    // edits never change the key, the level or the parent
    ctl.update(i, { title: 'Другое', ownerLabel: 'Анна', dueDate: '2027-03-31', impact: 5, description: 'x' })
    ctl.updateKpi(i, { name: 'Участники', target: 200, unit: 'чел.' })
    ctl.update(t, { impact: 5, effort: 5 }) // a task has no rating
    const after = ctl.getSnapshot().strategy
    expect(after.items.map((n) => n.key)).toEqual([s, i, t])
    expect(after.items[1]).toMatchObject({ kind: 'initiative', parentKey: s, title: 'Другое', ownerLabel: 'Анна', dueDate: '2027-03-31', impact: 5, kpi: { name: 'Участники', target: 200, unit: 'чел.' } })
    expect(after.items[2]).toMatchObject({ impact: null, effort: null })
    // blank optional texts become null; an empty KPI is no KPI
    ctl.update(i, { ownerLabel: '  ', description: '' })
    ctl.updateKpi(i, { name: '', target: null, unit: '' })
    expect(ctl.getSnapshot().strategy.items[1]).toMatchObject({ ownerLabel: null, description: null, kpi: null })
    expect(ctl.getSnapshot().dirty).toBe(true)
  })

  it('refuses a node at the wrong level and respects the limits', () => {
    const { ctl, s, i, t } = filled()
    expect(ctl.add('task', s)).toBeNull() // a task goes under an initiative
    expect(ctl.add('initiative', null)).toBeNull()
    expect(ctl.add('strategy', s)).toBeNull()
    expect(ctl.add('initiative', t)).toBeNull()
    expect(ctl.getSnapshot().strategy.items).toHaveLength(3)
    const full: PlanStrategy = { items: Array.from({ length: 12 }, (_, n) => ({ ...ctl.getSnapshot().strategy.items[0], key: `strategy-${String(n).padStart(8, '0')}`, order: n })), milestones: [] }
    expect(canAdd(full, 'strategy')).toBe(false)
    expect(canAdd(ctl.getSnapshot().strategy, 'strategy')).toBe(true)
    expect(limitRows(full)[0]).toMatchObject({ label: 'Стратегий', used: 12, max: 12 })
    const e2 = editor(full)
    expect(e2.ctl.addStrategy()).toBeNull()
    expect(e2.ctl.getSnapshot().serverError?.message).toContain('не больше 12')
    void i
  })

  it('moves a node up and down among its siblings only', () => {
    const { ctl, s } = filled()
    const a = ctl.addInitiative(s)!
    ctl.update(a, { title: 'Вторая' })
    const titles = () => ctl.getSnapshot().strategy.items.filter((n) => n.kind === 'initiative').sort((x, y) => x.order - y.order).map((n) => n.title)
    expect(titles()).toEqual(['Лояльность', 'Вторая'])
    ctl.move(a, 'up')
    expect(titles()).toEqual(['Вторая', 'Лояльность'])
    ctl.move(a, 'up') // already first: nothing happens
    expect(titles()).toEqual(['Вторая', 'Лояльность'])
    ctl.move(a, 'down')
    expect(titles()).toEqual(['Лояльность', 'Вторая'])
    expect(ctl.getSnapshot().strategy.items.find((n) => n.key === s)!.order).toBe(0)
  })

  it('deleting a strategy removes its initiatives and tasks after confirmation', () => {
    const { ctl, s, i, t } = filled()
    const other = ctl.addStrategy()!
    ctl.update(other, { title: 'Другая' })
    ctl.addDependency(other, s)
    ctl.requestRemove(s)
    // asked, not done yet
    expect(ctl.getSnapshot().strategy.items).toHaveLength(4)
    expect(ctl.getSnapshot().pendingRemove).toMatchObject({ key: s, kind: 'strategy', title: 'Рост', descendants: 2 })
    ctl.cancelRemove()
    expect(ctl.getSnapshot().pendingRemove).toBeNull()
    expect(ctl.getSnapshot().strategy.items).toHaveLength(4)
    ctl.requestRemove(s)
    ctl.confirmRemove()
    const left = ctl.getSnapshot().strategy.items
    expect(left.map((n) => n.key)).toEqual([other])
    expect(left.some((n) => [s, i, t].includes(n.key))).toBe(false)
    // whoever waited for the removed strategy does not wait for it any more
    expect(left[0].dependsOn).toEqual([])
    expect(descendantKeys(ctl.getSnapshot().strategy.items, other)).toEqual([])
  })

  it('the confirmation dialog names what will go', () => {
    const { ctl, s } = filled()
    ctl.requestRemove(s)
    const html = view(ctl)
    expect(html).toContain('Удалить стратегию?')
    expect(html).toContain('вместе со всем, что внутри (2 узлов)')
  })
})

describe('strategy editor: dependencies', () => {
  it('dependencies can be chosen only among nodes of the same level', () => {
    const tree = fixtureStrategyTree()
    const { ctl } = editor(tree)
    const s = ctl.getSnapshot().strategy
    const i2 = byTitle(s, 'Автоматизация работы с клиентской базой (CRM)')
    const i1 = byTitle(s, 'Программа лояльности')
    const i3 = byTitle(s, 'Тест двух новых каналов привлечения')
    const t1 = byTitle(s, 'Описать условия программы')
    // i2 already waits for i1; the other initiatives are candidates, strategies and tasks never
    const cands = dependencyCandidates(s.items, i2.key)
    expect(cands.every((c) => c.kind === 'initiative')).toBe(true)
    expect(cands.map((c) => c.title).sort()).toEqual(['Пересмотр прайса', 'Тест двух новых каналов привлечения'].sort())
    expect(cands.map((c) => c.key)).not.toContain(i2.key) // not itself
    expect(cands.map((c) => c.key)).not.toContain(i1.key) // not twice
    // a different level is refused
    expect(ctl.addDependency(i2.key, t1.key)).toBe(false)
    expect(ctl.addDependency(i2.key, byTitle(s, 'Меньше зависимости от одного канала').key)).toBe(false)
    expect(ctl.addDependency(i2.key, i2.key)).toBe(false)
    expect(ctl.addDependency(i2.key, i3.key)).toBe(true)
    expect(ctl.getSnapshot().strategy.items.find((n) => n.key === i2.key)!.dependsOn).toEqual([i1.key, i3.key])
    // i1 may not wait for i2 (i2 already waits for i1): that would be a cycle
    expect(dependencyCandidates(ctl.getSnapshot().strategy.items, i1.key).map((n) => n.key)).not.toContain(i2.key)
    expect(ctl.addDependency(i1.key, i2.key)).toBe(false)
    // and for a task: only tasks
    expect(dependencyCandidates(s.items, t1.key).every((c) => c.kind === 'task')).toBe(true)
    ctl.removeDependency(i2.key, i3.key)
    expect(ctl.getSnapshot().strategy.items.find((n) => n.key === i2.key)!.dependsOn).toEqual([i1.key])
  })

  it('the form offers only the candidates of the same level', () => {
    const { ctl } = editor(fixtureStrategyTree())
    const i2 = byTitle(ctl.getSnapshot().strategy, 'Автоматизация работы с клиентской базой (CRM)')
    ctl.toggleEditing(i2.key)
    const html = view(ctl)
    const select = html.match(/<select id="[^"]*-dep"[^>]*>([\s\S]*?)<\/select>/)![1]
    expect(select).toContain('Тест двух новых каналов привлечения')
    expect(select).toContain('Пересмотр прайса')
    expect(select).not.toContain('Описать условия программы') // a task
    expect(select).not.toContain('Рост выручки за счёт повторных продаж') // a strategy
    // the chosen one is a chip with a named remove button
    expect(html).toContain('Убрать зависимость от «Программа лояльности»')
  })
})

describe('strategy editor: pre-validation and save', () => {
  it('pre-validation shows the error under the field and blocks the save', async () => {
    const { ctl, s, calls } = filled()
    ctl.update(s, { title: '' })
    expect(await ctl.save()).toBe(false)
    expect(calls).toHaveLength(0) // nothing sent
    const snap = ctl.getSnapshot()
    expect(snap.errors.nodes[s]?.title).toMatch(/Название/)
    expect(snap.editing.has(s)).toBe(true) // the form with the mistake is opened
    expect(snap.attempted).toBe(true)
    const html = view(ctl)
    const m = /id="([^"]*-title-err)"/.exec(html)
    expect(m).toBeTruthy()
    expect(html).toContain(`aria-describedby="${m![1]}"`)
    expect(html).toContain('aria-invalid="true"')
    // fixing it clears the error at once
    ctl.update(s, { title: 'Рост' })
    expect(ctl.getSnapshot().errors.nodes[s]).toBeUndefined()
    expect(view(ctl)).not.toContain('-title-err')
  })

  it('shows a mistake of a deep field (a KPI without a name, a milestone without a date) at the right node', async () => {
    const { ctl, i, calls } = filled()
    ctl.updateKpi(i, { target: 10 })
    expect(await ctl.save()).toBe(false)
    expect(ctl.getSnapshot().errors.nodes[i]?.kpi).toMatch(/KPI/)
    expect(calls).toHaveLength(0)
    ctl.updateKpi(i, { name: 'Рост' })
    const m = ctl.addMilestone()!
    ctl.updateMilestone(m, { title: 'Пилот' })
    expect(await ctl.save()).toBe(false)
    expect(ctl.getSnapshot().errors.milestones[m]?.date).toMatch(/Дата/)
    expect(view(ctl)).toContain('-date-err')
    // the ancestors of a failing node are opened
    const e = editor()
    const s2 = e.ctl.addStrategy()!
    e.ctl.update(s2, { title: 'A' })
    const i2 = e.ctl.addInitiative(s2)!
    e.ctl.update(i2, { title: 'B' })
    const t2 = e.ctl.addTask(i2)!
    e.ctl.toggleExpanded(s2)
    e.ctl.toggleExpanded(i2)
    expect(e.ctl.getSnapshot().expanded.has(i2)).toBe(false)
    expect(await e.ctl.save()).toBe(false) // the task has no title
    expect(e.ctl.getSnapshot().expanded.has(i2)).toBe(true)
    expect(e.ctl.getSnapshot().expanded.has(s2)).toBe(true)
    expect(e.ctl.getSnapshot().editing.has(t2)).toBe(true)
  })

  it('profanity and other refusals of the validation block the save with the field', async () => {
    const e = editor({ items: [], milestones: [] })
    const s = e.ctl.addStrategy()!
    e.ctl.update(s, { title: 'Это хуйня' })
    expect(await e.ctl.save()).toBe(false)
    expect(e.ctl.getSnapshot().errors.nodes[s]?.title).toBeTruthy()
    expect(e.calls).toHaveLength(0)
  })

  it('save sends the whole strategy and shows server errors', async () => {
    const onSaved = vi.fn()
    const { ctl, s, i, t, calls } = filled()
    // 1) a refusal with a field → under that field
    const bad = editor(ctl.getSnapshot().strategy, { replies: [{ status: 400, body: { ok: false, error: 'Срок: дата в формате ГГГГ-ММ-ДД', field: 'items[1].dueDate' } }], onSaved })
    bad.ctl.update(i, { dueDate: '2027-03-31' })
    expect(await bad.ctl.save()).toBe(false)
    expect(bad.ctl.getSnapshot().errors.nodes[i]?.dueDate).toBe('Срок: дата в формате ГГГГ-ММ-ДД')
    expect(bad.ctl.getSnapshot().dirty).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
    // 2) a 409 → the server's text
    const conflict = editor(ctl.getSnapshot().strategy, { replies: [{ status: 409, body: { ok: false, error: 'Версия уже на проверке — стратегию менять нельзя' } }] })
    conflict.ctl.update(s, { title: 'Рост!' })
    expect(await conflict.ctl.save()).toBe(false)
    expect(conflict.ctl.getSnapshot().serverError).toEqual({ message: 'Версия уже на проверке — стратегию менять нельзя', status: 409 })
    expect(view(conflict.ctl)).toContain('Версия уже на проверке')
    // 3) no connection
    const offline = editor(ctl.getSnapshot().strategy)
    offline.ctl.update(s, { title: 'Рост!' })
    const dead = new StrategyEditor(USER, VERSION, ctl.getSnapshot().strategy, (async () => { throw new Error('offline') }) as unknown as typeof fetch, { deps: { newKey } })
    dead.update(s, { title: 'Рост!' })
    expect(await dead.save()).toBe(false)
    expect(dead.getSnapshot().serverError?.message).toMatch(/Нет связи/)
    // 4) success: PUT of the WHOLE tree, replaced not merged; clean afterwards; the parent is told
    const ok = editor(ctl.getSnapshot().strategy, { onSaved })
    ok.ctl.update(t, { dueDate: '2026-12-01', ownerLabel: 'Маркетолог' })
    const m = ok.ctl.addMilestone()!
    ok.ctl.updateMilestone(m, { title: 'Пилот', date: '2027-01-15', kpi: '200 участников' })
    expect(await ok.ctl.save()).toBe(true)
    expect(ok.calls).toHaveLength(1)
    expect(ok.calls[0].method).toBe('PUT')
    expect(ok.calls[0].url).toBe(URL)
    const sent = (ok.calls[0].body as { strategy: PlanStrategy }).strategy
    expect(Object.keys(ok.calls[0].body as object)).toEqual(['strategy'])
    expect(sent.items.map((n) => n.key)).toEqual([s, i, t])
    expect(sent.items[2]).toMatchObject({ dueDate: '2026-12-01', ownerLabel: 'Маркетолог', parentKey: i })
    expect(sent.milestones).toEqual([{ key: m, title: 'Пилот', date: '2027-01-15', description: null, kpi: '200 участников' }])
    const after = ok.ctl.getSnapshot()
    expect(after.dirty).toBe(false)
    expect(after.busy).toBe(false)
    expect(after.notice).toMatch(/Стратегия сохранена/)
    expect(onSaved).toHaveBeenCalledTimes(1)
    void calls
  })

  it('a removed node is gone from the sent tree (the server replaces, not merges)', async () => {
    const { ctl, s, i, calls } = filled()
    const other = ctl.addStrategy()!
    ctl.update(other, { title: 'Вторая' })
    ctl.requestRemove(s)
    ctl.confirmRemove()
    expect(await ctl.save()).toBe(true)
    const sent = (calls[0].body as { strategy: PlanStrategy }).strategy
    expect(sent.items.map((n) => n.key)).toEqual([other])
    expect(sent.items.some((n) => n.key === i)).toBe(false)
  })

  it('does not send twice while a save is running, and does nothing when not editable', async () => {
    let release: () => void = noop
    const gate = new Promise<void>((r) => { release = r })
    const f = vi.fn(async () => { await gate; return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }) } })
    const ctl = new StrategyEditor(USER, VERSION, {}, f as unknown as typeof fetch, { deps: { newKey } })
    const s = ctl.addStrategy()!
    ctl.update(s, { title: 'Рост' })
    const first = ctl.save()
    expect(ctl.getSnapshot().busy).toBe(true)
    expect(await ctl.save()).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)

    const ro = editor(fixtureStrategyTree(), { editable: false })
    expect(ro.ctl.addStrategy()).toBeNull()
    ro.ctl.update(ro.ctl.getSnapshot().strategy.items[0].key, { title: 'x' })
    ro.ctl.requestRemove(ro.ctl.getSnapshot().strategy.items[0].key)
    expect(ro.ctl.getSnapshot().strategy.items[0].title).not.toBe('x')
    expect(ro.ctl.getSnapshot().pendingRemove).toBeNull()
    expect(await ro.ctl.save()).toBe(false)
    expect(ro.calls).toHaveLength(0)
  })

  it('sync takes the stored tree only when there are no unsaved edits', () => {
    const { ctl, s } = filled()
    const stored = fixtureStrategyTree()
    ctl.sync(stored) // dirty: ignored
    expect(ctl.getSnapshot().strategy.items.map((n) => n.key)).toContain(s)
    const clean = editor({})
    clean.ctl.sync(stored)
    expect(clean.ctl.getSnapshot().strategy.items).toHaveLength(stored.items.length)
    expect(clean.ctl.getSnapshot().dirty).toBe(false)
  })
})

describe('strategy editor: helpers', () => {
  it('locates a field of the refusal', () => {
    const s = fixtureStrategyTree()
    expect(locateField('items[3].dependsOn[0]', s)).toEqual({ scope: 'node', key: s.items[3].key, name: 'dependsOn' })
    expect(locateField('items[1].kpi.name', s)).toEqual({ scope: 'node', key: s.items[1].key, name: 'kpi' })
    expect(locateField('items[1]', s)).toEqual({ scope: 'node', key: s.items[1].key, name: 'node' })
    expect(locateField('milestones[1].date', s)).toEqual({ scope: 'milestone', key: s.milestones[1].key, name: 'date' })
    expect(locateField('items', s)).toEqual({ scope: 'general' })
    expect(locateField('strategy', s)).toEqual({ scope: 'general' })
    expect(locateField('items[99].title', s)).toEqual({ scope: 'general' })
  })

  it('parses a typed number', () => {
    expect(parseNumberInput('')).toEqual({ ok: true, value: null })
    expect(parseNumberInput(' 2,5 ')).toEqual({ ok: true, value: 2.5 })
    expect(parseNumberInput('-3')).toEqual({ ok: true, value: -3 })
    expect(parseNumberInput('1 500')).toEqual({ ok: true, value: 1500 })
    expect(parseNumberInput('1.')).toEqual({ ok: false })
    expect(parseNumberInput('abc')).toEqual({ ok: false })
  })

  it('reads a stored tree tolerantly and renumbers siblings before sending', () => {
    expect(strategyFromRaw({})).toEqual({ items: [], milestones: [] })
    expect(strategyFromRaw(null)).toEqual({ items: [], milestones: [] })
    expect(strategyFromRaw([])).toEqual({ items: [], milestones: [] })
    const tree = fixtureStrategyTree()
    const shuffled = { ...tree, items: tree.items.map((n) => ({ ...n, order: n.order * 10 + 7 })) }
    const prepared = prepareForSave(strategyFromRaw(shuffled))
    const roots = prepared.items.filter((n) => n.kind === 'strategy').map((n) => n.order).sort()
    expect(roots).toEqual([0, 1])
  })
})

describe('strategy editor: markup', () => {
  it('the tree has the tree roles, levels and aria-expanded; every input has a label', () => {
    const { ctl } = editor(fixtureStrategyTree())
    const i1 = byTitle(ctl.getSnapshot().strategy, 'Программа лояльности')
    ctl.toggleEditing(i1.key)
    const html = view(ctl)
    expect(html).toContain('role="tree"')
    expect(html).toContain('role="treeitem"')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-level="1"')
    expect(html).toContain('aria-level="2"')
    expect(html).toContain('aria-level="3"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Свернуть: Программа лояльности')
    expect(html).toContain('Выше: Программа лояльности')
    expect(html).toContain('Удалить: Программа лояльности')
    // each control of the open form has its label
    const ids = Array.from(html.matchAll(/<(?:input|textarea|select) [^>]*?id="([^"]+)"/g)).map((m) => m[1])
    expect(ids.length).toBeGreaterThan(8)
    for (const id of ids) expect(html).toContain(`for="${id}"`)
    // phone: 16 px inputs
    expect(html).toContain('text-base')
    // counters of the limits
    expect(html).toContain('Стратегий: 2 из 12')
    expect(html).toContain('Задач: 8 из 300')
    expect(html).toContain('Контрольных точек: 3 из 24')
    // collapsing hides the children and flips aria-expanded
    const s1 = byTitle(ctl.getSnapshot().strategy, 'Рост выручки за счёт повторных продаж')
    ctl.toggleExpanded(s1.key)
    const closed = view(ctl)
    expect(closed).not.toContain('Описать условия программы')
    expect(closed).toContain('Развернуть: Рост выручки за счёт повторных продаж')
  })

  it('read-only for in_review and approved versions', () => {
    const { ctl } = editor(fixtureStrategyTree(), { editable: false })
    for (const html of [view(ctl, { editable: false }), view(ctl, { editable: false, versionNumber: 4 })]) {
      expect(html).toContain('Только чтение')
      expect(html).toContain('role="tree"')
      expect(html).toContain('Программа лояльности')
      expect(html).not.toContain('<input')
      expect(html).not.toContain('<textarea')
      expect(html).not.toContain('<select')
      expect(html).not.toContain('Сохранить стратегию')
      expect(html).not.toContain('Добавить')
      expect(html).not.toContain('Удалить')
      expect(html).not.toContain('Изменить')
    }
  })

  it('an empty draft says what to do; the panel opens inside the plan view for the open version', () => {
    const { ctl } = editor()
    expect(view(ctl)).toContain('Стратегии пока нет')
    expect(view(ctl)).toContain('Добавить стратегию')
    // slotted into the plan panel under the scenarios
    const strategy = React.createElement(StrategyPanelView, { snap: ctl.getSnapshot(), actions: actionsOf(ctl), editable: true, versionNumber: 3, matrix: ctl.matrix() })
    const plan = {
      versions: [], open: { id: VERSION, status: 'draft', version: 3 }, published: null, goals: { primary: null, items: [] }, canApprove: true,
    }
    const html = flat(renderToStaticMarkup(React.createElement(PlanPanelView, {
      snap: { phase: 'ready', plan, loadError: null, busy: null, error: null, exception: null, notice: null, scope: 'plan' } as never,
      notes: '', reason: '', onNotes: noop, onReason: noop, onCreate: noop, onSave: noop, onSubmit: noop, onAskApprove: noop, onAskReject: noop, onRetry: noop,
      approveTarget: null, onApproveClose: noop, onApproveConfirm: noop, rejectTarget: null, rejectText: '', onRejectText: noop, onRejectClose: noop, onRejectConfirm: noop,
      exceptionText: '', onExceptionText: noop, onExceptionClose: noop, onExceptionConfirm: noop, strategy,
    })))
    expect(html).toContain('Стратегия и дорожная карта · версия 3')
  })

  it('matrix preview counts the unrated initiatives', () => {
    const { ctl } = editor(fixtureStrategyTree())
    expect(ctl.matrix().unrated).toBe(1)
    expect(ctl.matrix().points).toHaveLength(5)
    const html = view(ctl)
    expect(html).toContain('Предпросмотр матрицы')
    expect(html).toContain('без оценки: 1')
    expect(html).toContain('Быстрые победы')
    // rating the last initiative moves it into the matrix at once
    const i4 = byTitle(ctl.getSnapshot().strategy, 'Пересмотр прайса')
    ctl.update(i4.key, { impact: 2, effort: 5 })
    expect(ctl.matrix().unrated).toBe(0)
    expect(ctl.matrix().points.find((p) => p.key === i4.key)?.quadrant).toBe('avoid')
    expect(view(ctl)).toContain('все оценены')
    // an empty tree: an honest placeholder
    expect(view(editor().ctl)).toContain('ни у одной стратегии или инициативы нет оценки')
  })
})
