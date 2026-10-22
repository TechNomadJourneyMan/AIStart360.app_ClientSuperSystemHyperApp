/**
 * Client «Что если» tab (plan Ф4 Task 4). The repo has no jsdom, so the behaviour lives in framework-free modules
 * (whatIfController.ts, whatIfModel.ts) driven here with a fetch double and fake timers, and the markup is checked
 * with react-dom/server. The routes (plan Task 3) are built separately: the doubles follow the contract of the plan.
 * The engine is NOT imported: results come from the hand-made fixture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fixtureModelResult, fixtureWhatIf, fixtureWhatIfChanges, fixtureWhatIfSaved } from '@/lib/point-b/fixtures'
import type { WhatIfChange, WhatIfResult } from '@/lib/point-b/model/whatif'
import { POINT_B_TABS } from '@/components/point-b/overviewModel'
import {
  INITIAL_WHATIF_SNAPSHOT, WhatIfController, whatIfPreviewFetch, type WhatIfSnapshot,
} from '@/components/point-b/whatIfController'
import {
  CALCULATORS, MONEY_LOCKED_TEXT, WHATIF_DISCLAIMER, WHATIF_KINDS, buildChanges, chartReadout, compareRows, defaultDraft, describeChange,
  draftFromChanges, mapServerField, nearestPoint, parseSavedList, parseWhatIfResult, validateParam, whatIfChartGeometry,
} from '@/components/point-b/whatIfModel'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode; className?: string }) => React.createElement('a', { href: p.href, className: p.className }, p.children) }))

const { WhatIfView } = await import('@/components/point-b/tabs/WhatIfTab')
const { default: WhatIfChart } = await import('@/components/point-b/WhatIfChart')

const flat = (html: string) => html.replace(/&#x27;|&quot;/g, '"').replace(/[  ]/g, ' ')
const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

// ── a fetch double ──────────────────────────────────────────────────────

interface Call { method: string; url: string; body: unknown; signal?: AbortSignal | null }
type Reply = { status: number; body: unknown }
type Handler = (call: Call) => Reply | Promise<Reply>

function harness(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined, signal: init?.signal }
    calls.push(call)
    const key = `${call.method} ${url.replace('/api/v1/point-b/whatif', '')}`
    const handler = routes[key]
    const r = handler ? await handler(call) : { status: 404, body: { ok: false, error: 'Не найдено' } }
    return { ok: r.status < 400, status: r.status, json: async () => r.body }
  })
  return { fetchFn: fetchFn as unknown as typeof fetch, calls }
}

const okResult = (result: WhatIfResult): Reply => ({ status: 200, body: { ok: true, data: json(result) } })
const savedBody = (list = fixtureWhatIfSaved('level2')): Reply => ({ status: 200, body: { ok: true, data: json(list) } })

const snapOf = (over: Partial<WhatIfSnapshot> = {}): WhatIfSnapshot => ({ ...INITIAL_WHATIF_SNAPSHOT, savedPhase: 'ready', ...over })

const noop = () => undefined
const ACTIONS = {
  setEnabled: noop, setParam: noop, resetCard: noop, resetAll: noop, setName: noop, setNote: noop, save: noop,
  loadScenario: noop, remove: noop, openProposal: noop, closeProposal: noop, setProposalComment: noop, propose: noop, retrySaved: noop,
}
const viewHtml = (snap: WhatIfSnapshot, level: number | null = 2, missing = fixtureModelResult('no-goal').missing, loading = false) =>
  flat(renderToStaticMarkup(React.createElement(WhatIfView, { snap, actions: ACTIONS, level, missing, loading })))

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

// ── the page ────────────────────────────────────────────────────────────

describe('«Что если»: the calculators', () => {
  it('six calculators render with ranges, units and the label «не рекомендация»', () => {
    const html = viewHtml(snapOf({ draft: draftFromChanges(WHATIF_KINDS.map((k) => ({ kind: k, ...Object.fromEntries(CALCULATORS[k].params.map((p) => [p.key, p.default])) }) as WhatIfChange)) }))
    expect(html).toContain(WHATIF_DISCLAIMER)
    for (const k of WHATIF_KINDS) expect(html).toContain(CALCULATORS[k].title)
    expect(html.match(/role="switch"/g)).toHaveLength(6)
    // every parameter has a range slider with a value text and a text field with its own label
    const params = WHATIF_KINDS.flatMap((k) => CALCULATORS[k].params)
    const sliders = params.filter((p) => p.max - p.min <= 1_000_000)
    expect(html.match(/type="range"/g)).toHaveLength(sliders.length)
    expect(html.match(/aria-valuetext="/g)).toHaveLength(sliders.length)
    for (const m of html.matchAll(/<label for="([^"]+)"/g)) expect(html).toContain(`id="${m[1]}"`)
    for (const p of params) expect(html).toContain(p.label)
    expect(html).toContain('п.п.')
    expect(html).toContain('чел.')
    expect(html).toContain('Допустимо от -50 до 100') // sr-only range of the marketing budget
    // hints of the explicit assumptions
    expect(html).toContain('Допущение: какая доля прироста бюджета превращается в прирост заявок')
    // the inputs are 16px on a phone
    expect(html).toContain('text-base sm:text-sm')
  })

  it('unavailable calculators are greyed with the reason from applicable', () => {
    const r = fixtureWhatIf('stale-base')
    const html = viewHtml(snapOf({ applicable: r.applicable, level: 1 }), 1)
    expect(html).toContain('Недоступно: Нет данных воронки')
    expect(html).toContain('Недоступно: Нужны фонд оплаты труда')
    // the greyed ones are disabled switches; the two that work are not
    expect(html.match(/role="switch"[^>]*disabled/g)).toHaveLength(4)
    expect(html.match(/opacity-60/g)!.length).toBeGreaterThanOrEqual(4)
    expect(html).toContain('aria-describedby')
  })

  it('a not applicable calculator cannot be switched on', () => {
    const { fetchFn } = harness({})
    const ctl = new WhatIfController(fetchFn)
    ctl['snap'] = { ...ctl.getSnapshot(), applicable: fixtureWhatIf('stale-base').applicable }
    ctl.setEnabled('conversion', true)
    expect(ctl.getSnapshot().draft.conversion.enabled).toBe(false)
    ctl.setEnabled('revenue_shock', true)
    expect(ctl.getSnapshot().draft.revenue_shock.enabled).toBe(true)
  })

  it('level 0 shows the explanation and what is missing instead of calculators', () => {
    const html = viewHtml(snapOf({ level: 0 }), 0)
    expect(html).toContain('Пока не из чего считать')
    expect(html).toContain('Цель по выручке') // the missing item from the level-0 result
    expect(html).not.toContain('role="switch"')
    expect(html).not.toContain('Сохранить сценарий')
    expect(html).toContain(WHATIF_DISCLAIMER)
  })

  it('402 renders the paywall, and the controller locks on a 402', async () => {
    expect(viewHtml(snapOf({ access: 'locked' }))).toContain('Точка Б — на тарифе Pro')
    const { fetchFn } = harness({ 'POST ': () => ({ status: 402, body: { error: 'upgrade_required' } }), 'GET /saved': () => savedBody() })
    const ctl = new WhatIfController(fetchFn)
    ctl.setEnabled('conversion', true)
    await vi.advanceTimersByTimeAsync(400)
    expect(ctl.getSnapshot().access).toBe('locked')
  })

  it('shows the skeleton while nothing says what the data allows', () => {
    expect(viewHtml(snapOf(), null, [], true)).toContain('aria-busy="true"')
  })
})

// ── the request flow ────────────────────────────────────────────────────

describe('«Что если»: requests', () => {
  it('the first answer of an empty probe greys the calculators and sets the level; saved list is loaded', async () => {
    const stale = fixtureWhatIf('stale-base', [])
    const { fetchFn, calls } = harness({ 'POST ': () => okResult(stale), 'GET /saved': () => savedBody([]) })
    const ctl = new WhatIfController(fetchFn)
    await ctl.init()
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({ changes: [] })
    const s = ctl.getSnapshot()
    expect(s.level).toBe(1)
    expect(s.applicable!.conversion.ok).toBe(false)
    expect(s.result).toBeNull() // the probe is not a result to show
    expect(s.savedPhase).toBe('ready')
  })

  it('a change triggers one debounced request and an outdated request is ignored', async () => {
    const first = fixtureWhatIf('level2', [{ kind: 'conversion', pp: 2 }])
    const second = fixtureWhatIf('level2', [{ kind: 'conversion', pp: 5 }])
    let release: (r: Reply) => void = () => undefined
    const pending = new Promise<Reply>((res) => { release = res })
    let n = 0
    const { fetchFn, calls } = harness({ 'POST ': () => (++n === 1 ? pending : okResult(second)) })
    const ctl = new WhatIfController(fetchFn)

    ctl.setEnabled('conversion', true)
    ctl.setParam('conversion', 'pp', '3')
    ctl.setParam('conversion', 'pp', '2')
    expect(ctl.getSnapshot().calc).toBe('waiting')
    await vi.advanceTimersByTimeAsync(399)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    // three edits in the window → ONE request with the last value
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ changes: [{ kind: 'conversion', pp: 2 }] })
    expect(ctl.getSnapshot().calc).toBe('loading')

    // a newer edit aborts the request in flight
    ctl.setParam('conversion', 'pp', '5')
    expect(calls[0].signal!.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(400)
    expect(calls).toHaveLength(2)
    expect(calls[1].body).toEqual({ changes: [{ kind: 'conversion', pp: 5 }] })
    expect(ctl.getSnapshot().result!.changed.annualRunRateAtDeadline).toBe(second.changed.annualRunRateAtDeadline)

    // the late answer of the first request changes nothing
    release(okResult(first))
    await vi.advanceTimersByTimeAsync(0)
    expect(ctl.getSnapshot().result!.changed.annualRunRateAtDeadline).toBe(second.changed.annualRunRateAtDeadline)
    expect(ctl.getSnapshot().calc).toBe('ready')
  })

  it('invalid input is not sent: the field says why', async () => {
    const { fetchFn, calls } = harness({})
    const ctl = new WhatIfController(fetchFn)
    ctl.setEnabled('conversion', true)
    ctl.setParam('conversion', 'pp', '30')
    await vi.advanceTimersByTimeAsync(400)
    expect(calls).toHaveLength(0)
    const s = ctl.getSnapshot()
    expect(s.calc).toBe('invalid')
    expect(s.cardErrors.conversion!.params.pp).toMatch(/Допустимо от -?10 до 20/)
    const html = viewHtml(s)
    expect(html).toMatch(/role="alert"[^>]*>Допустимо от/)
    // typing again clears the error of that field
    ctl.setParam('conversion', 'pp', '3')
    expect(ctl.getSnapshot().cardErrors.conversion).toBeUndefined()
  })

  it('server field errors are shown near the right calculator', async () => {
    const { fetchFn, calls } = harness({
      'POST ': () => ({ status: 400, body: { ok: false, error: 'Конверсия: не больше 20 п.п.', field: 'changes[1].pp' } }),
    })
    const ctl = new WhatIfController(fetchFn)
    ctl.setEnabled('conversion', true) // sent second, after the average check
    ctl.setEnabled('avg_check', true)
    ctl.setParam('conversion', 'pp', '5')
    await vi.advanceTimersByTimeAsync(400)
    expect((calls[0].body as { changes: Array<{ kind: string }> }).changes.map((c) => c.kind)).toEqual(['avg_check', 'conversion'])
    const s = ctl.getSnapshot()
    expect(s.calc).toBe('invalid')
    expect(s.cardErrors.conversion!.params.pp).toBe('Конверсия: не больше 20 п.п.')
    expect(s.cardErrors.avg_check).toBeUndefined()
    expect(viewHtml(s)).toContain('Конверсия: не больше 20 п.п.')
  })

  it('a server error without a field goes to the result area; a network failure too', async () => {
    const down = harness({ 'POST ': () => ({ status: 429, body: { error: 'rate' } }) })
    const ctl = new WhatIfController(down.fetchFn)
    ctl.setEnabled('conversion', true)
    await vi.advanceTimersByTimeAsync(400)
    expect(ctl.getSnapshot().calc).toBe('error')
    expect(ctl.getSnapshot().calcError).toMatch(/Слишком много/)
    const offline = new WhatIfController((async () => { throw new Error('offline') }) as unknown as typeof fetch)
    offline.setEnabled('conversion', true)
    await vi.advanceTimersByTimeAsync(400)
    expect(offline.getSnapshot().calcError).toMatch(/Нет связи/)
  })

  it('reset restores defaults and clears the result', async () => {
    const r = fixtureWhatIf('level2')
    const { fetchFn, calls } = harness({ 'POST ': () => okResult(r) })
    const ctl = new WhatIfController(fetchFn)
    ctl.setEnabled('conversion', true)
    ctl.setParam('conversion', 'pp', '7')
    ctl.setEnabled('revenue_shock', true)
    await vi.advanceTimersByTimeAsync(400)
    expect(ctl.getSnapshot().result).not.toBeNull()
    // one card back to defaults, then everything
    ctl.resetCard('conversion')
    expect(ctl.getSnapshot().draft.conversion).toEqual(defaultDraft().conversion)
    ctl.resetAll()
    const s = ctl.getSnapshot()
    expect(s.draft).toEqual(defaultDraft())
    expect(s.result).toBeNull()
    expect(s.calc).toBe('idle')
    const before = calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls.length).toBe(before) // nothing is sent for an empty set
  })

  it('stops the timer and the request when the tab is closed, and starts again after a remount', async () => {
    const { fetchFn, calls } = harness({ 'POST ': () => okResult(fixtureWhatIf('level2')), 'GET /saved': () => savedBody([]) })
    const ctl = new WhatIfController(fetchFn)
    ctl.setEnabled('conversion', true)
    ctl.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toHaveLength(0)
    await ctl.init() // strict mode: mount → unmount → mount
    expect(calls.length).toBeGreaterThan(0)
  })
})

// ── the result ──────────────────────────────────────────────────────────

describe('«Что если»: the result', () => {
  it('shows now → changed → Δ, contributions and interaction; money rows at level 2', () => {
    const r = fixtureWhatIf('level2')
    const html = viewHtml(snapOf({ result: r, calc: 'ready', level: 2 }))
    for (const t of ['Сейчас', 'При изменении', 'Изменение', 'Выручка к сроку цели', 'Срок достижения цели', 'Минимальная касса', 'Кассовый разрыв', 'Потребность в финансировании']) expect(html).toContain(t)
    expect(html).toContain('Вклад каждого изменения')
    expect(html).toContain('Эффект взаимодействия')
    expect(html).toContain('Конверсия')
    expect(html).toContain('Падение выручки')
    expect(html).toContain('Допущения')
    expect(html).toContain('<details')
    expect(html).not.toContain(MONEY_LOCKED_TEXT)
    // the cash gap of the stress test is reported in words, not only in colour
    expect(html).toMatch(/появляется в месяце \d+/)
    expect(html).toContain('Кассовый разрыв в месяце')
    expect(html).not.toMatch(/NaN|Infinity|undefined/)
    // numbers are the result's own
    const rows = compareRows(r)
    expect(rows.find((x) => x.id === 'annualRunRateAtDeadline')!.changed).not.toBe('—')
  })

  it('at level 1 the money rows are replaced by the finmodel hint', () => {
    const r = fixtureWhatIf('full')
    const html = viewHtml(snapOf({ result: r, calc: 'ready', level: 1 }), 1)
    expect(html).toContain(MONEY_LOCKED_TEXT)
    expect(html).toContain('Заполнить финмодель')
    expect(html).not.toContain('Минимальная касса')
    expect(html).not.toContain('Потребность в финансировании</p>')
    expect(html).toContain('Выручка к сроку цели')
    expect(html).not.toMatch(/NaN|Infinity/)
  })

  it('a missing value shows a dash with the reason, never 0', () => {
    const r = json(fixtureWhatIf('level2'))
    r.baseline.fundingNeed = null
    r.changed.fundingNeed = null
    delete r.delta.fundingNeed
    const row = compareRows(r).find((x) => x.id === 'fundingNeed')!
    expect(row.now).toBe('—')
    expect(row.changed).toBe('—')
    expect(row.delta).toBe('—')
    expect(row.note).toMatch(/Не хватает данных/)
  })

  it('the goal that is not reached is said in words', () => {
    const r = fixtureWhatIf('level2')
    const row = compareRows(r).find((x) => x.id === 'timeToGoalMonths')!
    expect(row.now).toMatch(/не достигается за 24 мес\./)
    expect(row.changed).toMatch(/^\d+ мес\.$/)
    expect(row.delta).toBe('цель становится достижимой')
  })

  it('shows the waiting state without dropping the previous result', () => {
    const html = viewHtml(snapOf({ result: fixtureWhatIf('level2'), calc: 'loading', level: 2 }))
    expect(html).toContain('Считаем…')
    expect(html).toContain('Вклад каждого изменения')
    expect(html).toContain('aria-busy="true"')
  })
})

// ── the chart ───────────────────────────────────────────────────────────

describe('«Что если»: the chart', () => {
  it('has no NaN and marks the goal line', () => {
    const r = fixtureWhatIf('level2')
    const geo = whatIfChartGeometry(r.series, 560, 260)!
    expect(geo).not.toBeNull()
    for (const v of [geo.baseLine, geo.changedLine, geo.targetY, ...geo.xs, ...geo.yTicks.map((t) => t.y)]) expect(String(v)).not.toMatch(/NaN|Infinity/)
    expect(geo.targetY).not.toBeNull()
    expect(geo.targetY!).toBeGreaterThanOrEqual(geo.plot.top)
    expect(geo.targetY!).toBeLessThanOrEqual(geo.plot.bottom)
    const html = flat(renderToStaticMarkup(React.createElement(WhatIfChart, { series: r.series })))
    expect(html).toContain('Цель')
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Годовой темп выручки по месяцам')
    expect(html).not.toMatch(/NaN|Infinity/)
    expect(chartReadout(r.series, 6)).toContain('Месяц 6')
    expect(nearestPoint(geo, geo.xs[3] + 0.2)).toBe(3)
  })

  it('refuses a series that cannot be drawn', () => {
    expect(whatIfChartGeometry({ months: [0], baseline: [1], changed: [1], target: null }, 500, 260)).toBeNull()
    expect(whatIfChartGeometry({ months: [0, 1], baseline: [1, Number.NaN], changed: [1, 2], target: null }, 500, 260)).toBeNull()
    const html = renderToStaticMarkup(React.createElement(WhatIfChart, { series: { months: [], baseline: [], changed: [], target: null } }))
    expect(html).toContain('График недоступен')
  })
})

// ── saved scenarios ─────────────────────────────────────────────────────

describe('«Что если»: saved scenarios', () => {
  const routes = (store: { list: ReturnType<typeof fixtureWhatIfSaved> }, extra: Record<string, Handler> = {}): Record<string, Handler> => ({
    'POST ': () => okResult(fixtureWhatIf('level2')),
    'GET /saved': () => savedBody(store.list),
    ...extra,
  })

  it('save posts name and changes (no summary), shows the saved list; propose and delete update it', async () => {
    const store = { list: [] as ReturnType<typeof fixtureWhatIfSaved> }
    const { fetchFn, calls } = harness(routes(store, {
      'POST /saved': () => { store.list = fixtureWhatIfSaved('level2').slice(0, 1); return { status: 200, body: { ok: true } } },
      [`POST /saved/${fixtureWhatIfSaved('level2')[0].id}/propose`]: () => ({ status: 200, body: { ok: true } }),
      [`DELETE /saved/${fixtureWhatIfSaved('level2')[0].id}`]: () => ({ status: 200, body: { ok: true } }),
    }))
    const ctl = new WhatIfController(fetchFn, { now: () => '2026-10-18T09:00:00.000Z' })
    await ctl.loadSaved()
    ctl.setEnabled('conversion', true)
    ctl.setParam('conversion', 'pp', '2')

    // an empty name is refused on the client
    expect(await ctl.save()).toBe(false)
    expect(ctl.getSnapshot().saveErrors.name).toBe('Введите название сценария')

    ctl.setName('  Рост конверсии  ')
    ctl.setNote('Если скрипт сработает')
    expect(await ctl.save()).toBe(true)
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/saved'))!
    expect(post.body).toEqual({ name: 'Рост конверсии', note: 'Если скрипт сработает', changes: [{ kind: 'conversion', pp: 2 }] })
    expect(Object.keys(post.body as object)).not.toContain('summary')
    let s = ctl.getSnapshot()
    expect(s.saved).toHaveLength(1)
    expect(s.name).toBe('')
    expect(s.notice).toBe('Сценарий сохранён')
    let html = viewHtml(s)
    expect(html).toContain('Рост конверсии на 2 п.п.')
    expect(html).toContain('Конверсия +2 п.п.')
    expect(html).toContain('Загрузить')
    expect(html).toContain('Предложено эксперту') // the fixture's first item is already proposed
    expect(html).toContain('1 из 20')

    // propose a not yet proposed one
    const id = s.saved[0].id
    ctl['snap'] = { ...ctl.getSnapshot(), saved: ctl.getSnapshot().saved.map((x) => ({ ...x, proposedAt: null })) }
    ctl.openProposal(id)
    ctl.setProposalComment('Прошу учесть в плане')
    html = viewHtml(ctl.getSnapshot())
    expect(html).toContain('Комментарий для эксперта')
    expect(html).toContain('Отправить эксперту')
    expect(await ctl.propose(id)).toBe(true)
    const proposeCall = calls.find((c) => c.url.endsWith('/propose'))!
    expect(proposeCall.body).toEqual({ comment: 'Прошу учесть в плане' })
    s = ctl.getSnapshot()
    expect(s.saved[0].proposedAt).toBe('2026-10-18T09:00:00.000Z')
    expect(s.proposal).toBeNull()
    html = viewHtml(s)
    expect(html).toContain('Предложено эксперту')
    expect(html).not.toContain('>Предложить эксперту<')

    expect(await ctl.remove(id)).toBe(true)
    expect(ctl.getSnapshot().saved).toHaveLength(0)
    expect(viewHtml(ctl.getSnapshot())).toContain('Пока ничего не сохранено')
  })

  it('loads a saved scenario into the calculators and calculates it', async () => {
    const store = { list: fixtureWhatIfSaved('level2') }
    const { fetchFn, calls } = harness(routes(store))
    const ctl = new WhatIfController(fetchFn)
    await ctl.loadSaved()
    ctl.loadScenario(store.list[1].id)
    const d = ctl.getSnapshot().draft
    expect(d.revenue_shock.enabled).toBe(true)
    expect(d.revenue_shock.values.pct).toBe('-40')
    expect(d.revenue_shock.values.durationMonths).toBe('4')
    expect(d.conversion.enabled).toBe(false)
    await vi.advanceTimersByTimeAsync(400)
    expect(calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/saved')).at(-1)!.body).toEqual({ changes: [{ kind: 'revenue_shock', pct: -40, startMonth: 2, durationMonths: 4 }] })
  })

  it('profane or long name from the server shows under the field; a 409 limit and a failed delete show their text', async () => {
    const store = { list: [] as ReturnType<typeof fixtureWhatIfSaved> }
    let mode: 'name' | 'limit' | 'forbidden' = 'name'
    const { fetchFn } = harness(routes(store, {
      'POST /saved': () => (mode === 'name'
        ? { status: 400, body: { ok: false, error: 'Название содержит недопустимые слова', field: 'name' } }
        : mode === 'limit' ? { status: 409, body: { ok: false, error: 'limit', code: 'limit' } } : { status: 403, body: { ok: false, error: 'forbidden' } }),
      'DELETE /saved/x': () => ({ status: 404, body: { ok: false, error: 'not found' } }),
    }))
    const ctl = new WhatIfController(fetchFn)
    ctl.setEnabled('conversion', true)
    ctl.setName('плохое')
    await ctl.save()
    expect(ctl.getSnapshot().saveErrors.name).toBe('Название содержит недопустимые слова')
    expect(viewHtml(ctl.getSnapshot())).toContain('Название содержит недопустимые слова')
    mode = 'limit'
    await ctl.save()
    expect(ctl.getSnapshot().saveErrors.general).toMatch(/не более 20/)
    // name longer than the limit is cut by the field itself
    ctl.setName('я'.repeat(120))
    expect(ctl.getSnapshot().name).toHaveLength(80)
  })

  it('«от имени»: a 403 hides the save and propose buttons', async () => {
    const store = { list: fixtureWhatIfSaved('level2').map((s) => ({ ...s, proposedAt: null })) }
    const { fetchFn } = harness(routes(store, { 'POST /saved': () => ({ status: 403, body: { ok: false, error: 'forbidden' } }) }))
    const ctl = new WhatIfController(fetchFn)
    await ctl.loadSaved()
    ctl.setEnabled('conversion', true)
    ctl.setName('x')
    await ctl.save()
    const s = ctl.getSnapshot()
    expect(s.readOnly).toBe(true)
    const html = viewHtml(s)
    expect(html).toContain('В режиме просмотра от имени пользователя')
    expect(html).not.toContain('Сохранить сценарий</button>')
    expect(html).not.toContain('Предложить эксперту')
    expect(html).not.toContain('>Удалить<')
    expect(html).toContain('Загрузить') // reading is still allowed
    expect(await ctl.propose(s.saved[0].id)).toBe(false)
  })

  it('a repeated proposal (409 already_proposed) marks the scenario as proposed without an error', async () => {
    const store = { list: fixtureWhatIfSaved('level2').map((s) => ({ ...s, proposedAt: null })) }
    const id = store.list[0].id
    const { fetchFn } = harness(routes(store, { [`POST /saved/${id}/propose`]: () => ({ status: 409, body: { ok: false, error: 'already', code: 'already_proposed' } }) }))
    const ctl = new WhatIfController(fetchFn)
    await ctl.loadSaved()
    ctl.openProposal(id)
    await ctl.propose(id)
    expect(ctl.getSnapshot().saved[0].proposedAt).not.toBeNull()
    expect(ctl.getSnapshot().rowErrors[id]).toBeUndefined()
  })

  it('a failed saved list shows the text and a retry', async () => {
    const { fetchFn } = harness({ 'GET /saved': () => ({ status: 500, body: { ok: false, error: 'boom' } }) })
    const ctl = new WhatIfController(fetchFn)
    await ctl.loadSaved()
    const html = viewHtml(ctl.getSnapshot())
    expect(ctl.getSnapshot().savedPhase).toBe('error')
    expect(html).toContain('Повторить')
  })
})

// ── the model ───────────────────────────────────────────────────────────

describe('«Что если»: input rules and parsing', () => {
  it('validates the ranges of the contract with a text', () => {
    const pp = CALCULATORS.conversion.params[0]
    expect(validateParam(pp, '2,5')).toEqual({ ok: true, value: 2.5 })
    expect(validateParam(pp, '−10')).toEqual({ ok: true, value: -10 })
    expect(validateParam(pp, '30')).toMatchObject({ ok: false })
    expect(validateParam(pp, 'abc')).toEqual({ ok: false, error: 'Введите число' })
    const count = CALCULATORS.hire.params[0]
    expect(validateParam(count, '0')).toMatchObject({ ok: false })
    expect(validateParam(count, '1000')).toMatchObject({ ok: false })
    expect(validateParam(count, '1,5')).toEqual({ ok: false, error: 'Введите целое число' })
    const budget = CALCULATORS.marketing.params[0]
    expect(validateParam(budget, '-100')).toMatchObject({ ok: false })
    expect(validateParam(budget, '500')).toMatchObject({ ok: false })
  })

  it('builds the changes in a fixed order with numbers and all explicit assumptions', () => {
    const d = defaultDraft()
    d.revenue_shock.enabled = true
    d.avg_check.enabled = true
    d.avg_check.values.pct = '+10'
    const built = buildChanges(d)
    expect(built.kinds).toEqual(['avg_check', 'revenue_shock'])
    expect(built.changes).toEqual([
      { kind: 'avg_check', pct: 10, demandElasticity: 0.3 },
      { kind: 'revenue_shock', pct: -20, startMonth: 2, durationMonths: 3 },
    ])
    // a calculator the server called not applicable is left out
    expect(buildChanges(d, { avg_check: { ok: false } }).kinds).toEqual(['revenue_shock'])
    // an invalid card blocks only itself
    d.revenue_shock.values.durationMonths = '99'
    const bad = buildChanges(d)
    expect(bad.kinds).toEqual(['avg_check'])
    expect(bad.errors.revenue_shock!.params.durationMonths).toMatch(/Допустимо/)
  })

  it('maps a server field to the calculator that was sent at that index', () => {
    expect(mapServerField('changes[1].pp', ['avg_check', 'conversion'])).toEqual({ kind: 'conversion', param: 'pp' })
    expect(mapServerField('changes[0]', ['hire'])).toEqual({ kind: 'hire', param: null })
    expect(mapServerField('changes[0].nonsense', ['hire'])).toEqual({ kind: 'hire', param: null })
    expect(mapServerField('changes[3].pp', ['hire'])).toBeNull()
    expect(mapServerField('name', ['hire'])).toBeNull()
    expect(mapServerField(undefined, ['hire'])).toBeNull()
  })

  it('wording of changes', () => {
    expect(describeChange({ kind: 'marketing', budgetPct: 30 })).toBe('Маркетинг +30%')
    expect(describeChange({ kind: 'hire', count: 2, startMonth: 3 })).toBe('Найм: 2 чел. с месяца 3')
    expect(describeChange({ kind: 'avg_check', pct: -5 })).toBe('Средний чек −5%')
    expect(describeChange({ kind: 'revenue_shock', pct: -20, startMonth: 2, durationMonths: 3 })).toBe('Падение выручки −20% на 3 мес. с месяца 2')
    expect(describeChange({ kind: 'fixed_costs', cutPct: 10, startMonth: 1 })).toBe('Постоянные расходы −10% с месяца 1')
  })

  it('parses tolerantly: no NaN, no crash on a partial answer', () => {
    expect(parseWhatIfResult(null)).toBeNull()
    expect(parseWhatIfResult({ baseline: {}, changed: {} })!.series.months).toEqual([])
    const r = parseWhatIfResult({ baseline: { annualRunRateAtDeadline: 'x', minCash: { value: 1 } }, changed: {}, series: { months: [0, 1], baseline: [1, Number.NaN], changed: [1, 2] }, level: 7, applicable: { hire: { ok: false, reason: 'нет' } } })!
    expect(r.baseline.annualRunRateAtDeadline).toBeNull()
    expect(r.baseline.minCash).toBeNull()
    expect(r.series.months).toEqual([]) // lengths disagree after the NaN is dropped
    expect(r.level).toBe(0)
    expect(r.applicable.hire).toEqual({ ok: false, reason: 'нет' })
    expect(r.applicable.marketing.ok).toBe(true)
    const list = parseSavedList({ ok: true, data: [
      { id: 'a', name: 'А', changes: [{ kind: 'conversion', pp: 2 }, { kind: 'nonsense' }, { kind: 'hire', count: 'x' }], summary: { level: 2, delta: { annualRunRateAtDeadline: 5 } } },
      { id: 'b', name: 'Б', changes: [], summary: { annualRunRateAtDeadline: 7 } },
      { name: 'без id' },
    ] })!
    expect(list.map((s) => s.id)).toEqual(['a', 'b'])
    expect(list[0].changes).toEqual([{ kind: 'conversion', pp: 2 }])
    expect(list[0].summary).toEqual({ level: 2, delta: { annualRunRateAtDeadline: 5 } })
    expect(list[1].summary.delta.annualRunRateAtDeadline).toBe(7)
    expect(parseSavedList({ ok: false })).toBeNull()
  })

  it('«Что если» sits between «Рекомендации» and «Финмодель»', () => {
    expect(POINT_B_TABS.map((t) => t.key)).toEqual(['overview', 'scenarios', 'strategy', 'roadmap', 'recs', 'whatif', 'finmodel', 'details'])
    expect(POINT_B_TABS.find((t) => t.key === 'whatif')!.label).toBe('Что если')
  })
})

// ── the fixture and the preview ─────────────────────────────────────────

describe('«Что если»: fixtures for the preview', () => {
  it('are consistent: sum of contributions + interaction = combined, JSON-safe, no NaN', () => {
    for (const variant of ['full', 'level2', 'stale-base', 'no-goal'] as const) {
      const r = fixtureWhatIf(variant)
      expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity|null,null/)
      expect(json(r)).toEqual(r)
      if (variant === 'no-goal') { expect(r.level).toBe(0); continue }
      for (const key of Object.keys(r.delta) as Array<keyof WhatIfResult['delta']>) {
        const whole = r.delta[key]
        const parts = r.contributions.map((c) => c.delta[key])
        if (typeof whole === 'number' && parts.every((p) => typeof p === 'number') && r.contributions.length > 1) {
          expect((parts as number[]).reduce((a, b) => a + b, 0) + (r.interaction[key] as number)).toBeCloseTo(whole, 6)
        }
      }
    }
    const empty = fixtureWhatIf('level2', [])
    expect(empty.changed).toEqual(empty.baseline)
    const lvl2 = fixtureWhatIf('level2')
    expect(lvl2.changed.cashGapMonth).not.toBeNull() // the stress case shows a cash gap
    expect(lvl2.baseline.cashGapMonth).toBeNull()
    expect(fixtureWhatIf('full').changed.minCash).toBeNull() // no money at level 1
    expect(fixtureWhatIf('stale-base').applicable.conversion.ok).toBe(false)
    expect(fixtureWhatIfChanges('stale-base').map((c) => c.kind)).toEqual(['revenue_shock'])
  })

  it('the preview fetch answers the calculation, the probe and the saved list in memory', async () => {
    const data = { result: fixtureWhatIf('level2'), baseline: fixtureWhatIf('level2', []), saved: fixtureWhatIfSaved('level2'), changes: fixtureWhatIfChanges('level2') }
    const ctl = new WhatIfController(whatIfPreviewFetch(data), { initialChanges: data.changes })
    expect(ctl.getSnapshot().draft.conversion.enabled).toBe(true)
    expect(ctl.getSnapshot().draft.revenue_shock.enabled).toBe(true)
    await ctl.init()
    const s = ctl.getSnapshot()
    expect(s.result!.changed.cashGapMonth).toBe(data.result.changed.cashGapMonth)
    expect(s.saved).toHaveLength(2)
    ctl.setName('Мой')
    expect(await ctl.save()).toBe(true)
    expect(ctl.getSnapshot().saved).toHaveLength(3)
    const id = ctl.getSnapshot().saved[0].id
    expect(await ctl.remove(id)).toBe(true)
    expect(ctl.getSnapshot().saved).toHaveLength(2)
  })
})
