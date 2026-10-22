/**
 * Client «Стратегия» and «Дорожная карта» tabs (plan Ф5 Task 5). The repo has no jsdom, so the behaviour lives in
 * framework-free modules (strategyModel.ts, pointBStateController.ts) and the markup is checked with react-dom/server.
 * The server modules of the strategy (validate, progress, tasks) are NOT imported: the state is the hand-made fixture
 * that follows the contract of the plan («PointBState.plan.strategy»).
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fixtureModelResult, fixtureStrategy, fixtureStrategyTree } from '@/lib/point-b/fixtures'
import { POINT_B_TABS, isTabKey } from '@/components/point-b/overviewModel'
import { PointBStateController } from '@/components/point-b/pointBStateController'
import {
  buildCards, buildRoadmap, coerceNodes, dependencyLines, fmtDay, isoDay, kpiText, matrixGeometry, matrixGroups, parseStrategyFromBody,
  parseStrategyState, progressView, quadrantOf, strategyCounts, strategyMode, taskStatusView, timelineGeometry, todayIso,
  type PointBStrategyState,
} from '@/components/point-b/strategyModel'
import type { NodeProgress } from '@/lib/point-b/strategy/progress'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => React.createElement('a', { href: p.href }, p.children) }))

const { StrategyView, default: StrategyTab } = await import('@/components/point-b/tabs/StrategyTab')
const { RoadmapView, default: RoadmapTab } = await import('@/components/point-b/tabs/RoadmapTab')
const { default: MatrixChart } = await import('@/components/point-b/MatrixChart')
const { default: TimelineChart } = await import('@/components/point-b/TimelineChart')

const TODAY = '2026-10-19'
const flat = (html: string) => html.replace(/&#x27;|&quot;/g, '"').replace(/[  ]/g, ' ')
const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const strategyHtml = (s: PointBStrategyState = fixtureStrategy()) => flat(renderToStaticMarkup(React.createElement(StrategyView, { strategy: s, today: TODAY, planVersion: 2 })))
const roadmapHtml = (s: PointBStrategyState = fixtureStrategy(), today = TODAY) => flat(renderToStaticMarkup(React.createElement(RoadmapView, { strategy: s, today })))

const byTitle = (s: PointBStrategyState, title: string) => s.items.find((n) => n.title === title)!

// ── the fixture itself ──────────────────────────────────────────────────

describe('strategy fixture', () => {
  it('is consistent: 2 strategies, 4 initiatives, 8 tasks, 3 milestones, one dependency, one unrated initiative', () => {
    const s = fixtureStrategy()
    expect(strategyCounts(s)).toEqual({ strategies: 2, initiatives: 4, tasks: 8, milestones: 3 })
    expect(s.items.reduce((n, i) => n + i.dependsOn.length, 0)).toBe(1)
    expect(s.matrix.unrated).toBe(1)
    expect(s.matrix.points).toHaveLength(5)
    expect(JSON.stringify(s)).not.toMatch(/NaN|Infinity|undefined/)
    expect(json(s)).toEqual(s)
    // every node has a progress entry; the unrated initiative has no tasks
    expect(Object.keys(s.progress)).toHaveLength(s.items.length)
    expect(s.progress[byTitle(s, 'Пересмотр прайса').key].state).toBe('no_tasks')
    // keys are unique
    expect(new Set(s.items.map((n) => n.key)).size).toBe(s.items.length)
  })
})

// ── «Стратегия» ─────────────────────────────────────────────────────────

describe('«Стратегия»', () => {
  it('strategy cards show progress bars and the four states', () => {
    const s = fixtureStrategy()
    const html = strategyHtml(s)
    // bars: strategies and initiatives with tasks; the percent and the detail are in the text too
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="17"') // strategy 1: 1 of 6
    expect(html).toContain('17% · 1 из 6 задач выполнено')
    expect(html).toContain('25% · 1 из 4 задач выполнено, в работе 1') // the loyalty programme
    expect(html).toContain('50% · 1 из 2 задач выполнено, в работе 1') // the channel test
    // the states are words
    expect(html).toContain('в работе')
    expect(html).toContain('не начато')
    expect(html).toContain('нет задач')
    // a node without tasks has no bar and no 0 %
    const noTasks = progressView(s.progress[byTitle(s, 'Пересмотр прайса').key])
    expect(noTasks).toMatchObject({ state: 'no_tasks', percent: null, label: 'нет задач' })
    // the four states, including «выполнено»
    const done: NodeProgress = { key: 'k', tasks: 2, done: 2, inProgress: 0, percent: 100, state: 'done' }
    expect(progressView(done)).toMatchObject({ state: 'done', label: 'выполнено', percent: 100 })
    expect(progressView({ ...done, done: 0, percent: 0, state: 'not_started' })).toMatchObject({ state: 'not_started', label: 'не начато', percent: 0 })
    expect(progressView({ ...done, done: 1, percent: 50, state: 'in_progress' })).toMatchObject({ state: 'in_progress', label: 'в работе', percent: 50 })
    // nothing known about a node → «—», never a bar
    expect(progressView(undefined)).toMatchObject({ state: 'unknown', label: '—', percent: null })
    const all = { ...s, progress: { ...s.progress, [byTitle(s, 'Тест двух новых каналов привлечения').key]: done } }
    expect(strategyHtml(all)).toContain('выполнено')
  })

  it('initiatives show impact and effort, KPI, due date and delay risk; tasks show the owner, due date and status with the link to the action plan', () => {
    const html = strategyHtml()
    expect(html).toContain('Программа лояльности')
    expect(html).toContain('Влияние 4 из 5')
    expect(html).toContain('Усилие 2 из 5')
    expect(html).toContain('Участники программы → 200 чел.')
    expect(html).toContain('31 мар. 2027')
    expect(html).toContain('Риск задержки')
    expect(html).toContain('Нужна интеграция с кассой')
    // a task
    expect(html).toContain('Описать условия программы')
    expect(html).toContain('Ответственный: <span class="text-on-surface">Маркетолог</span>')
    expect(html).toContain('15 нояб. 2026')
    expect(html).toContain('Выполнена')
    expect(html).toContain('В работе')
    expect(html).toContain('Не начата')
    expect(html).toContain('Открыть в плане действий')
    // the unrated initiative says so instead of showing zeros
    expect(html).toContain('Влияние —')
    expect(html).not.toMatch(/NaN|undefined|null/)
  })

  it('marks an open task whose date has passed as overdue; a done task is never overdue; a deleted task says so', () => {
    const s = fixtureStrategy()
    const t1 = byTitle(s, 'Описать условия программы') // done, due 2026-11-15
    const t2 = byTitle(s, 'Настроить рассылки для участников') // in progress, due 2026-12-20
    const t3 = byTitle(s, 'Запустить пилот в двух точках') // open
    expect(taskStatusView(t1, s.progress, '2027-01-01')).toMatchObject({ key: 'done', overdue: false })
    expect(taskStatusView(t2, s.progress, '2027-01-01')).toMatchObject({ key: 'in_progress', overdue: true })
    expect(taskStatusView(t2, s.progress, TODAY).overdue).toBe(false)
    expect(taskStatusView(t3, s.progress, '2027-03-01')).toMatchObject({ key: 'open', overdue: true, label: 'Не начата' })
    // the client deleted the task: no row in the action plan → tasks 0
    const gone = { ...s.progress, [t3.key]: { key: t3.key, tasks: 0, done: 0, inProgress: 0, percent: null, state: 'no_tasks' } as NodeProgress }
    expect(taskStatusView(t3, gone, '2027-03-01')).toMatchObject({ key: 'missing', label: 'Нет в плане действий', overdue: false })
    expect(taskStatusView(t3, {}, TODAY)).toMatchObject({ key: 'unknown', label: '—' })
    expect(strategyHtml({ ...s, progress: gone })).toContain('Нет в плане действий')
  })

  it('matrix places rated initiatives in the right quadrants and shows the unrated count', () => {
    const s = fixtureStrategy()
    expect(quadrantOf(4, 2)).toBe('quick_wins')
    expect(quadrantOf(3, 3)).toBe('quick_wins')
    expect(quadrantOf(4, 4)).toBe('big_bets')
    expect(quadrantOf(2, 3)).toBe('fill_ins')
    expect(quadrantOf(1, 5)).toBe('avoid')
    const groups = matrixGroups(s.matrix.points)
    expect(groups.map((g) => g.quadrant)).toEqual(['quick_wins', 'big_bets', 'fill_ins', 'avoid'])
    expect(groups[0].points.map((p) => p.title)).toContain('Программа лояльности')
    expect(groups[1].points.map((p) => p.title)).toEqual(['Автоматизация работы с клиентской базой (CRM)'])
    expect(groups[2].points).toHaveLength(0)
    // numbers 1..N are shared by the chart and the list
    expect(groups.flatMap((g) => g.points.map((p) => p.n))).toEqual([1, 2, 3, 4, 5])
    const geo = matrixGeometry(groups)
    expect(geo.points).toHaveLength(5)
    for (const p of geo.points) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true) }
    // a pile in one cell is spread, not drawn on top of itself
    const piled = matrixGeometry(matrixGroups([
      { key: 'a', title: 'A', kind: 'initiative', impact: 4, effort: 2, quadrant: 'quick_wins' },
      { key: 'b', title: 'B', kind: 'initiative', impact: 4, effort: 2, quadrant: 'quick_wins' },
    ]))
    expect(new Set(piled.points.map((p) => `${p.x}:${p.y}`)).size).toBe(2)

    const html = flat(renderToStaticMarkup(React.createElement(MatrixChart, { matrix: s.matrix })))
    expect(html).toContain('role="img"')
    expect(html).toContain('Быстрые победы')
    expect(html).toContain('Крупные проекты')
    expect(html).toContain('Можно отложить')
    expect(html).toContain('Не стоит')
    expect(html).toContain('без оценки: 1')
    expect(html).toContain('Автоматизация работы с клиентской базой (CRM)')
    expect(html).not.toMatch(/NaN|Infinity/)
    // nothing rated: an honest placeholder instead of an empty grid
    const empty = flat(renderToStaticMarkup(React.createElement(MatrixChart, { matrix: { points: [], unrated: 3 } })))
    expect(empty).toContain('без оценки: 3')
    expect(empty).not.toContain('<svg')
  })

  it('empty states: no approved version vs an approved plan with no strategy', () => {
    const base = { phase: 'ready' as const, error: null, result: fixtureModelResult('full'), plan: { status: 'none' as const, version: null, selectedScenario: null, scenarios: [], approvedAt: null, authorName: null } }
    const snap = (over: Record<string, unknown>) => ({ ...base, ...over, plan: { ...base.plan, ...(over.plan as object | undefined) } })
    const render = (s: ReturnType<typeof snap>) => flat(renderToStaticMarkup(React.createElement(StrategyTab, { snap: s as never })))

    expect(strategyMode(snap({ strategy: null }))).toBe('preparing')
    expect(render(snap({ strategy: null }))).toContain('Эксперт готовит стратегию')
    expect(render(snap({ plan: { status: 'preparing' } }))).toContain('Эксперт готовит стратегию')

    const emptyTree = { items: [], milestones: [], progress: {}, matrix: { points: [], unrated: 0 } }
    expect(strategyMode(snap({ plan: { status: 'published' }, strategy: emptyTree }))).toBe('empty')
    expect(render(snap({ plan: { status: 'published' }, strategy: emptyTree }))).toContain('В плане пока нет стратегии')
    // approved, but the server sent nothing about the strategy
    expect(render(snap({ plan: { status: 'published' } }))).toContain('В плане пока нет стратегии')

    expect(strategyMode(snap({ phase: 'loading' }))).toBe('loading')
    expect(render(snap({ phase: 'loading' }))).toContain('aria-busy="true"')
    expect(strategyMode(snap({ phase: 'error', result: null, error: 'x' }))).toBe('error')
    expect(render(snap({ phase: 'error', result: null, error: 'Нет связи' }))).toContain('Нет связи')
    expect(strategyMode(snap({ plan: { status: 'published' }, strategy: fixtureStrategy() }))).toBe('ready')
  })

  it('a strategy without tasks and an initiative without ratings do not crash the page', () => {
    const tree = fixtureStrategyTree()
    const bare: PointBStrategyState = parseStrategyState({ items: tree.items.filter((n) => n.kind !== 'task'), milestones: [] })!
    for (const n of bare.items) bare.progress[n.key] = { key: n.key, tasks: 0, done: 0, inProgress: 0, percent: null, state: 'no_tasks' }
    const html = strategyHtml(bare)
    expect(html).toContain('нет задач')
    expect(html).not.toMatch(/NaN|undefined/)
    // the initiatives keep their own dates, so the timeline is drawn without tasks
    expect(roadmapHtml(bare)).not.toMatch(/NaN|undefined/)
  })
})

// ── «Дорожная карта» ────────────────────────────────────────────────────

describe('«Дорожная карта»', () => {
  it('timeline groups items by quarter, marks milestones and today, no NaN in the SVG', () => {
    const s = fixtureStrategy()
    const r = buildRoadmap(s, TODAY)
    expect(r.quarters.map((q) => q.label)).toEqual(['IV кв. 2026', 'I кв. 2027', 'II кв. 2027'])
    const titles = (key: string) => r.byQuarter.find((q) => q.quarter.key === key)!.items.map((i) => i.title)
    expect(titles('2026-Q4')).toEqual(expect.arrayContaining(['Описать условия программы', 'Подобрать каналы и бюджеты', 'Выбрать систему и подрядчика']))
    expect(titles('2027-Q1')).toEqual(expect.arrayContaining(['Пилот программы лояльности запущен', 'CRM принята в работу', 'Перенести клиентскую базу']))
    expect(titles('2027-Q2')).toEqual(expect.arrayContaining(['Итог полугодия: повторные покупки', 'Разобрать итоги пилота и поправить условия']))
    expect(r.byQuarter[0].isCurrent).toBe(true)
    expect(r.milestones).toHaveLength(3)
    expect(r.undated).toEqual([])
    expect(r.outside).toBe(0)
    // inside a quarter: by date
    const q1 = r.byQuarter[1].items.map((i) => i.date!)
    expect([...q1].sort()).toEqual(q1)

    const geo = timelineGeometry(r)!
    expect(geo.milestones).toHaveLength(3)
    expect(geo.todayX).not.toBeNull()
    expect(geo.rows).toHaveLength(6) // 2 strategies + 4 initiatives
    for (const row of geo.rows) if (row.bar) { expect(row.bar.x2).toBeGreaterThan(row.bar.x1); expect(row.bar.fillX).toBeGreaterThanOrEqual(row.bar.x1) }
    expect(geo.rows.find((x) => x.full === 'Пересмотр прайса')!.bar).toBeNull() // no tasks, no dates: «без срока»
    expect(geo.rows.find((x) => x.full === 'Программа лояльности')!.bar).not.toBeNull()
    expect(JSON.stringify(geo)).not.toMatch(/NaN|Infinity|null,null/)

    const svg = flat(renderToStaticMarkup(React.createElement(TimelineChart, { roadmap: r })))
    expect(svg).toContain('role="img"')
    expect(svg).toContain('IV кв. 2026')
    expect(svg).toContain('сегодня')
    expect(svg).toContain('Контрольные точки')
    expect(svg).not.toMatch(/NaN|Infinity|undefined/)

    // today outside the dates: no line, no crash
    const later = timelineGeometry(buildRoadmap(s, '2031-01-01'))!
    expect(JSON.stringify(later)).not.toMatch(/NaN|Infinity/)
  })

  it('the page lists milestones with the date and KPI, tasks by quarter with their statuses, and is a list on a phone', () => {
    const html = roadmapHtml()
    expect(html).toContain('Этапы и контрольные точки')
    expect(html).toContain('Пилот программы лояльности запущен')
    expect(html).toContain('15 янв. 2027')
    expect(html).toContain('KPI: <span class="text-on-surface">не менее 200 участников</span>')
    expect(html).toContain('По кварталам')
    expect(html).toContain('IV кв. 2026')
    expect(html).toContain('сейчас')
    expect(html).toContain('Выполнена')
    expect(html).toContain('Открыть в плане действий')
    // the chart is for wide screens, the list for a phone
    expect(html).toContain('hidden md:block')
    expect(html).toContain('md:hidden')
    expect(html).not.toMatch(/NaN|undefined/)
  })

  it('dependencies block lists «X ждёт Y»', () => {
    const s = fixtureStrategy()
    const lines = dependencyLines(s)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Инициатива «Автоматизация работы с клиентской базой (CRM)» ждёт «Программа лояльности»')
    expect(lines[0].resolved).toBe(false)
    expect(roadmapHtml(s)).toContain('Инициатива «Автоматизация работы с клиентской базой (CRM)» ждёт «Программа лояльности»')
    // the awaited initiative is done → the line says it can move
    const i1 = byTitle(s, 'Программа лояльности').key
    const done = { ...s, progress: { ...s.progress, [i1]: { key: i1, tasks: 4, done: 4, inProgress: 0, percent: 100, state: 'done' } as NodeProgress } }
    expect(dependencyLines(done)[0].resolved).toBe(true)
    expect(roadmapHtml(done)).toContain('выполнено, можно двигаться')
    // no dependencies → no block
    expect(roadmapHtml({ ...s, items: s.items.map((n) => ({ ...n, dependsOn: [] })) })).not.toContain('Зависимости')
    // a dependency on a node that is gone is skipped
    expect(dependencyLines({ ...s, items: s.items.map((n) => ({ ...n, dependsOn: n.dependsOn.length ? ['gone-key-0001'] : [] })) })).toEqual([])
  })

  it('no dates at all → an honest placeholder; undated tasks are listed; a huge span is cut and counted', () => {
    const tree = fixtureStrategyTree()
    const noDates = parseStrategyState({ items: tree.items.map((n) => ({ ...n, dueDate: null })), milestones: [] })!
    const r = buildRoadmap(noDates, TODAY)
    expect(r.hasDates).toBe(false)
    expect(timelineGeometry(r)).toBeNull()
    expect(r.undated).toHaveLength(8)
    const html = roadmapHtml(noDates)
    expect(html).toContain('На дорожной карте пока нет сроков')
    expect(html).toContain('Без срока')

    const far = parseStrategyState({ items: tree.items, milestones: [{ key: 'far-milestone-1', title: 'Далеко', date: '2060-01-01' }] })!
    const rf = buildRoadmap(far, TODAY)
    expect(rf.quarters.length).toBeLessThanOrEqual(12)
    expect(rf.outside).toBeGreaterThan(0)
    expect(JSON.stringify(timelineGeometry(rf))).not.toMatch(/NaN|Infinity/)
    expect(flat(renderToStaticMarkup(React.createElement(RoadmapView, { strategy: far, today: TODAY })))).toContain('Показаны не все кварталы')
  })

  it('RoadmapTab: preparing, empty and loading states', () => {
    const base = { phase: 'ready', error: null, result: fixtureModelResult('full'), plan: { status: 'none', version: null, selectedScenario: null, scenarios: [], approvedAt: null, authorName: null }, strategy: null }
    const render = (over: Record<string, unknown>) => flat(renderToStaticMarkup(React.createElement(RoadmapTab, { snap: { ...base, ...over } as never })))
    expect(render({})).toContain('Эксперт готовит стратегию')
    expect(render({ plan: { ...base.plan, status: 'published' } })).toContain('В плане пока нет стратегии')
    expect(render({ phase: 'loading' })).toContain('aria-busy="true"')
  })
})

// ── Tabs, parsing and the state controller ──────────────────────────────

describe('tabs and state', () => {
  it('tabs order includes Стратегия and Дорожная карта after Сценарии', () => {
    expect(POINT_B_TABS.map((t) => t.label)).toEqual(['Обзор', 'Сценарии', 'Стратегия', 'Дорожная карта', 'Рекомендации', 'Что если', 'Финмодель', 'Подробности'])
    expect(POINT_B_TABS.map((t) => t.key)).toEqual(['overview', 'scenarios', 'strategy', 'roadmap', 'recs', 'whatif', 'finmodel', 'details'])
    expect(isTabKey('strategy')).toBe(true)
    expect(isTabKey('roadmap')).toBe(true)
    expect(isTabKey('nope')).toBe(false)
  })

  it('the parser is tolerant: bad nodes dropped, bad dates and ratings become null, ratings on tasks are dropped, the matrix is derived when absent', () => {
    const tree = fixtureStrategyTree()
    const nodes = coerceNodes([
      ...tree.items.slice(0, 3),
      { key: tree.items[0].key, kind: 'strategy', title: 'дубль' },
      { key: 'x-1', kind: 'bogus', title: 'Z' },
      'junk', null,
      { key: 'bad-date-1', kind: 'initiative', parentKey: tree.items[0].key, title: 'Дата', dueDate: '2026-02-30', impact: 6, effort: 2.5 },
      { key: 'task-with-rating', kind: 'task', parentKey: tree.items[1].key, title: 'Задача', impact: 3, effort: 3 },
    ])
    expect(nodes.map((n) => n.key)).toEqual([tree.items[0].key, tree.items[1].key, tree.items[2].key, 'bad-date-1', 'task-with-rating'])
    const bad = nodes.find((n) => n.key === 'bad-date-1')!
    expect(bad).toMatchObject({ dueDate: null, impact: null, effort: null })
    expect(nodes.find((n) => n.key === 'task-with-rating')).toMatchObject({ impact: null, effort: null })

    const s = parseStrategyState({ items: tree.items })!
    expect(s.milestones).toEqual([])
    expect(s.progress).toEqual({})
    expect(s.matrix.points).toHaveLength(5)
    expect(s.matrix.unrated).toBe(1)
    expect(progressView(s.progress[tree.items[0].key])).toMatchObject({ state: 'unknown', label: '—' })
    expect(parseStrategyState(null)).toBeNull()
    expect(parseStrategyState([])).toBeNull()
    expect(isoDay('2026-02-30')).toBeNull()
    expect(isoDay('2026-02-28')).toBe('2026-02-28')
    expect(fmtDay('2026-11-15')).toBe('15 нояб. 2026')
    expect(fmtDay(null)).toBe('—')
    expect(fmtDay('2026-13-01')).toBe('—')
    expect(kpiText({ name: 'Выручка', target: 1500000, unit: '₸' })!.replace(/\s/g, ' ')).toBe('Выручка → 1 500 000 ₸')
    expect(kpiText({ name: 'Рейтинг', target: null, unit: null })).toBe('Рейтинг')
    expect(kpiText(null)).toBeNull()
    expect(todayIso(new Date(2026, 9, 5))).toBe('2026-10-05')
  })

  it('the cards follow the expert’s order and skip orphans', () => {
    const s = fixtureStrategy()
    const cards = buildCards({ ...s, items: [...s.items, { ...s.items[1], key: 'orphan-initiative', parentKey: 'missing-parent', title: 'Сирота' }] }, TODAY)
    expect(cards.map((c) => c.node.title)).toEqual(['Рост выручки за счёт повторных продаж', 'Меньше зависимости от одного канала'])
    expect(cards[0].initiatives.map((i) => i.node.title)).toEqual(['Программа лояльности', 'Автоматизация работы с клиентской базой (CRM)'])
    expect(cards[0].initiatives[0].tasks.map((t) => t.node.title)).toEqual(['Описать условия программы', 'Настроить рассылки для участников', 'Запустить пилот в двух точках', 'Разобрать итоги пилота и поправить условия'])
    expect(JSON.stringify(cards)).not.toContain('Сирота')
  })

  it('the state controller reads plan.strategy of the approved version; none → null', async () => {
    const result = fixtureModelResult('full')
    const body = (strategy: unknown) => ({ ok: true, data: { access: 'ok', overview: { result, labelledAutomatic: true }, plan: { status: 'published', version: 2, selectedScenario: null, scenarios: [], approvedAt: null, authorName: null, strategy } } })
    const ctl = (b: unknown) => new PointBStateController((async () => ({ ok: true, status: 200, json: async () => b })) as unknown as typeof fetch)

    const a = ctl(body(json(fixtureStrategy())))
    await a.load()
    expect(a.getSnapshot().phase).toBe('ready')
    expect(a.getSnapshot().strategy?.items).toHaveLength(14) // 2 + 4 + 8
    expect(a.getSnapshot().strategy?.progress).toBeTruthy()

    const b = ctl(body(null))
    await b.load()
    expect(b.getSnapshot().strategy).toBeNull()

    // a server that does not know about the strategy yet
    const old = ctl({ ok: true, data: { access: 'ok', overview: { result }, plan: { status: 'published' } } })
    await old.load()
    expect(old.getSnapshot().phase).toBe('ready')
    expect(old.getSnapshot().strategy).toBeNull()
    expect(parseStrategyFromBody({ ok: true, data: { plan: {} } })).toBeNull()
  })
})
