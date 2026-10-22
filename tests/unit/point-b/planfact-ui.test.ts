/**
 * Point B Ф6b, Task 6: the client tab «План-факт и история» — the parser of `data.planFact`, the view models (verdict
 * strip, stale badge, checkpoints, revenue chart, goal progress without an aggregated percent, versions and their
 * comparison), the «Факт за месяц» controller with a fetch double, and the static render of the tab (react-dom/server,
 * no DOM). Mobile: the months are cards below `sm`, the table only from `sm`.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MonthlyFactController, parseNumber } from '@/components/point-b/monthlyFactController'
import { EMPTY_PLAN_STATE } from '@/components/point-b/overviewModel'
import {
  checkpointRows, compareView, defaultPair, factFields, parsePlanFact, parsePlanFactFromBody, progressRows, revenueChart, staleBadge, verdictStrip, versionItems,
} from '@/components/point-b/planFactModel'
import { PointBStateController, type PointBStateSnapshot } from '@/components/point-b/pointBStateController'
import PlanFactTab, { PLANFACT_EMPTY_NO_PLAN, PLANFACT_NO_AGGREGATE, PlanFactView } from '@/components/point-b/tabs/PlanFactTab'
import { MonthlyFactFormView } from '@/components/point-b/MonthlyFactForm'
import { fixturePlanFact } from '@/lib/point-b/fixtures'
import { summarizeVersion } from '@/lib/point-b/planfact/diff'
import type { PlanFactState } from '@/lib/point-b/planfact/types'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const snapWith = (over: Partial<PointBStateSnapshot>): PointBStateSnapshot => ({ phase: 'ready', error: null, result: null, plan: { ...EMPTY_PLAN_STATE, status: 'published', version: 2 }, ...over })
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('parsing data.planFact', () => {
  it('a round trip of the fixture keeps everything; junk is dropped, never NaN', () => {
    const pf = fixturePlanFact('full')
    const back = parsePlanFact(JSON.parse(JSON.stringify(pf)))!
    expect(back).toEqual(pf)
    const junk = parsePlanFact({ checkpoints: [null, { period: 'bad' }, { period: '2026-09', overall: 'weird', planned: { revenue: 'x', leads: 5 } }], kpis: ['revenue', 'nope'], progress: [{ metricKey: 'm' }], versions: [{ id: 'v' }], staleDays: 'x' })!
    expect(junk.checkpoints).toEqual([expect.objectContaining({ period: '2026-09', overall: 'no_data', planned: { leads: 5 } })])
    expect(junk.kpis).toEqual(['revenue'])
    expect(junk.progress).toEqual([])
    expect(junk.versions).toEqual([])
    expect(junk.staleDays).toBeNull()
    expect(parsePlanFact(null)).toBeNull()
  })

  it('the state controller keeps the plan-fact; an older server without the field gives null', async () => {
    const body = { ok: true, data: { access: 'ok', overview: { result: { level: 0, scenarios: [], gap: {}, forecast: { atCurrentPace: {} }, verdict: { key: 'no_data' }, missing: [], warnings: [] } }, plan: { status: 'published', version: 2, scenarios: [] }, planFact: fixturePlanFact('full') } }
    const ctl = new PointBStateController(vi.fn(async () => respond(200, body)) as unknown as typeof fetch)
    await ctl.load()
    expect(ctl.getSnapshot().planFact?.current?.period).toBe('2026-09')
    expect(parsePlanFactFromBody({ ok: true, data: {} })).toBeUndefined()
    const old = new PointBStateController(vi.fn(async () => respond(200, { ...body, data: { ...body.data, planFact: undefined } })) as unknown as typeof fetch)
    await old.load()
    expect(old.getSnapshot().planFact).toBeNull()
  })
})

describe('view models', () => {
  const pf = fixturePlanFact('full')

  it('the verdict strip of the newest month with data, its reason and the forecast', () => {
    const v = verdictStrip(pf)!
    expect(v).toMatchObject({ label: 'Отстаём', tone: 'bad', period: 'сентябрь 2026' })
    expect(v.reason).toMatch(/^Конверсия 10,5% при плане 12,8%; выручка .* при плане .*\.$/)
    expect(v.forecast).toContain('цель по выручке будет достигнута примерно')
    expect(verdictStrip({ ...pf, current: null })).toBeNull()
  })

  it('the stale badge: today, yesterday, N days, waiting for the recompute after 4 days', () => {
    const at = (d: number | null) => staleBadge({ ...pf, staleDays: d })
    expect(at(0)).toEqual({ text: 'Обновлено сегодня', stale: false })
    expect(at(1)).toEqual({ text: 'Обновлено вчера', stale: false })
    expect(at(3)).toEqual({ text: 'Обновлено 3 дня назад', stale: false })
    expect(at(5)).toEqual({ text: 'Обновлено 5 дней назад · ждёт пересчёта', stale: true })
    expect(at(21)).toEqual({ text: 'Обновлено 21 день назад · ждёт пересчёта', stale: true })
    expect(staleBadge({ ...pf, staleDays: null, checkpoints: [] })).toEqual({ text: 'Ещё не пересчитано', stale: true })
  })

  it('checkpoints newest first with plan · fact · verdict per KPI; October without facts is «нет данных»', () => {
    const rows = checkpointRows(pf)
    expect(rows.map((r) => [r.period, r.overall])).toEqual([['2026-10', 'no_data'], ['2026-09', 'behind'], ['2026-08', 'risk'], ['2026-07', 'on_track'], ['2026-06', 'on_track']])
    expect(rows[1].cells.map((c) => c.kpi)).toEqual(pf.kpis)
    expect(rows[1].cells[0]).toMatchObject({ label: 'Выручка за месяц', source: 'сверка' })
    expect(rows[0].cells.every((c) => c.actual === '—' && c.verdict === 'no_data')).toBe(true)
  })

  it('the revenue chart: plan with the corridor and the fact; none without a planned revenue', () => {
    const c = revenueChart(pf)!
    expect(c.bars.map((b) => b.short)).toEqual(['июн', 'июл', 'авг', 'сен', 'окт'])
    expect(c.bars[4].fact).toBeNull()
    expect(c.max).toBeGreaterThan(0)
    expect(c.summary).toBe('Выручка по месяцам: план и факт за 5 мес., факт есть за 4.')
    expect(revenueChart({ ...pf, checkpoints: [] })).toBeNull()
  })

  it('goal progress: the way and the time separately, the forecast date or why there is none — never one percent', () => {
    const [r] = progressRows(pf)
    expect(r.label).toBe('Выручка 120 млн ₸ в год')
    expect(r.path?.text).toMatch(/^-?\d+% пути$/)
    expect(r.time?.text).toMatch(/^\d+% времени$/)
    expect(r.factNote).toBe('факт за сентябрь 2026')
    expect(r.deadline).toBeTruthy()
    const empty = progressRows({ ...pf, progress: [{ ...pf.progress[0], fact: null, pathShare: null, forecastDate: null, forecastNote: 'Нет факта выручки — дату не оценить.' }] })[0]
    expect(empty).toMatchObject({ fact: '—', factNote: 'нет факта', path: null, forecast: 'Нет факта выручки — дату не оценить.' })
  })

  it('the form fields are the KPIs of the plan, with the value already entered', () => {
    expect(factFields(['revenue', 'conversion'], { conversion: 10.8 })).toEqual([
      expect.objectContaining({ kpi: 'revenue', label: 'Выручка за месяц', suffix: '₸', value: '', inputMode: 'decimal' }),
      expect.objectContaining({ kpi: 'conversion', suffix: '%', value: '10.8' }),
    ])
  })

  it('versions: the list with who approved and why; the client compares with a superseded version by its reasons', () => {
    expect(versionItems(pf)).toEqual([
      expect.objectContaining({ title: 'Версия 2', status: 'Действует', tone: 'good', reason: 'Выбрали умеренный темп и добавили стратегию продаж' }),
      expect.objectContaining({ title: 'Версия 1', status: 'Заменена', reason: 'Первый план эксперта' }),
    ])
    expect(versionItems(pf)[0].meta).toContain('одобрил Админ Главный')
    expect(defaultPair(pf)).toEqual(['fixture-v1', 'fixture-v2'])
    expect(compareView(pf, 'fixture-v1', 'fixture-v2')).toEqual({ mode: 'reasons', items: [{ title: 'Версия 2', reason: 'Выбрали умеренный темп и добавили стратегию продаж' }] })
    expect(compareView(pf, 'fixture-v2', 'fixture-v2')).toBeNull()
  })

  it('the staff (full content) get the diff', () => {
    const row = (id: string, version: number, target: number, reason: string) => ({
      id, version, status: version === 2 ? 'approved' : 'superseded', goals: { primary: null, items: [{ metricKey: 'biz.finansy.vyruchka_god', periodLabel: '12m', label: 'Цель', baselineValue: null, baselinePeriod: null, targetValue: target, deadline: null, reviewStatus: 'verified' as const }] },
      assumptions: {}, scenarios: [], selected_scenario: null, strategy: {}, change_reason: reason, author_name: 'А', approved_at: null, created_at: '2026-01-01T00:00:00Z',
    })
    const state = { versions: [summarizeVersion(row('b', 2, 100e6, 'Снизили цель')), summarizeVersion(row('a', 1, 120e6, 'Первый'))] }
    const v = compareView(state, 'a', 'b')!
    expect(v.mode).toBe('diff')
    if (v.mode === 'diff') expect(v.diff.goals[0]).toMatchObject({ before: '120 млн ₸', after: '100 млн ₸' })
  })
})

describe('«Факт за месяц» controller', () => {
  const make = (fetchFn: ReturnType<typeof vi.fn>, initial = {}) => new MonthlyFactController(fetchFn as unknown as typeof fetch, {
    url: '/api/v1/point-b/monthly-facts', kpis: ['revenue', 'leads', 'conversion'], period: '2026-09', initial, onSaved: vi.fn(),
  })

  it('reads Russian numbers', () => {
    expect(parseNumber('6 300 000')).toBe(6_300_000)
    expect(parseNumber('10,8')).toBe(10.8)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('десять')).toBeNaN()
  })

  it('checks the limits before sending; nothing is sent with an error', async () => {
    const f = vi.fn()
    const c = make(f)
    expect(await c.submit()).toBe(false)
    expect(c.getSnapshot()).toMatchObject({ phase: 'error', error: 'Внесите хотя бы одно значение', field: 'revenue' })
    c.setValue('conversion', '130')
    await c.submit()
    expect(c.getSnapshot()).toMatchObject({ field: 'conversion', error: 'Конверсия — от 0 до 100%' })
    c.setValue('conversion', '12')
    c.setValue('leads', '10,5')
    await c.submit()
    expect(c.getSnapshot()).toMatchObject({ field: 'leads', error: 'Лиды за месяц: нужно целое число' })
    expect(f).not.toHaveBeenCalled()
  })

  it('sends PUT with numbers; an emptied value that existed is cleared; a success says the verdict and reloads', async () => {
    const f = vi.fn(async () => respond(200, { ok: true, data: { period: '2026-09', saved: ['revenue'], cleared: ['leads'], checkpoint: { status: 'done', overall: 'risk' } } }))
    const onSaved = vi.fn()
    const c = new MonthlyFactController(f as unknown as typeof fetch, { url: '/x', kpis: ['revenue', 'leads', 'conversion'], period: '2026-09', initial: { leads: 300 }, onSaved })
    c.setValue('revenue', '6 300 000')
    c.setValue('leads', '')
    c.setNote('  Закрыли месяц  ')
    expect(await c.submit()).toBe(true)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/x')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ period: '2026-09', values: { revenue: 6_300_000, leads: null }, note: 'Закрыли месяц' })
    expect(c.getSnapshot()).toMatchObject({ phase: 'saved', message: 'Сохранено. Вердикт за сентябрь 2026: есть риск.' })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('server errors: the field of a 400, the text of a 409, PRO for a 402, the network', async () => {
    const c400 = make(vi.fn(async () => respond(400, { ok: false, error: 'Комментарий — не длиннее 500 символов', field: 'note' })))
    c400.setValue('revenue', '1')
    await c400.submit()
    expect(c400.getSnapshot()).toMatchObject({ phase: 'error', field: 'note', error: 'Комментарий — не длиннее 500 символов' })
    const c409 = make(vi.fn(async () => respond(409, { ok: false, error: 'План ещё не одобрен — сверять факт пока не с чем', code: 'no_plan' })))
    c409.setValue('revenue', '1')
    await c409.submit()
    expect(c409.getSnapshot().error).toBe('План ещё не одобрен — сверять факт пока не с чем')
    const c402 = make(vi.fn(async () => respond(402, { ok: false, error: 'upgrade_required' })))
    c402.setValue('revenue', '1')
    await c402.submit()
    expect(c402.getSnapshot().error).toBe('План-факт доступен в тарифе PRO')
    const net = make(vi.fn(async () => { throw new Error('offline') }))
    net.setValue('revenue', '1')
    await net.submit()
    expect(net.getSnapshot().error).toBe('Нет связи с сервером. Проверьте соединение и повторите.')
  })
})

describe('render of the tab', () => {
  it('without an approved plan: an honest empty state', () => {
    const out = html(createElement(PlanFactTab, { snap: snapWith({ plan: { ...EMPTY_PLAN_STATE, status: 'preparing' } }) }))
    expect(out).toContain(PLANFACT_EMPTY_NO_PLAN)
    expect(html(createElement(PlanFactTab, { snap: snapWith({ planFact: null }) }))).toContain('План-факт готовится')
    expect(html(createElement(PlanFactTab, { snap: snapWith({ phase: 'loading' }) }))).toContain('aria-busy="true"')
  })

  it('the full tab: verdict with the reason and the badge, progress (way and time, no single percent), months, the form, versions', () => {
    const out = html(createElement(PlanFactTab, { snap: snapWith({ planFact: fixturePlanFact('level2') }) }))
    for (const text of ['Отстаём', 'сентябрь 2026', 'Обновлено вчера', 'Прогресс по целям', PLANFACT_NO_AGGREGATE, 'Пройдено пути', 'Прошло времени',
      'План и факт по месяцам', 'Факт за месяц · сентябрь 2026', 'Деньги на счетах', 'Версии плана', 'Версия 2', 'Действует', 'Заменена',
      'Содержание прежних версий хранится у эксперта', 'role="img"', 'Источник значений: «ежемесячная сверка»']) {
      expect(out, text).toContain(text)
    }
    expect(out).not.toMatch(/NaN|undefined|Infinity/)
    // a phone: cards below sm, the table from sm; no fixed wide widths
    expect(out).toContain('space-y-3 sm:hidden')
    expect(out).toContain('hidden w-full table-fixed border-collapse text-sm sm:table')
    expect(out).not.toMatch(/min-w-\[(\d{3,})px\]|w-\[(\d{3,})px\]/)
  })

  it('an approved plan without checkpoints yet', () => {
    const out = html(createElement(PlanFactView, { state: fixturePlanFact('full', 'empty') }))
    expect(out).toContain('Сверок ещё не было')
    expect(out).toContain('Ещё не пересчитано')
    expect(out).toContain('Сверок по месяцам пока нет.')
  })

  it('the form view: errors next to the field, the saving state, the staff wording', () => {
    const snap = { period: '2026-09', values: { revenue: 'x' }, note: '', phase: 'error' as const, error: 'Выручка за месяц: нужно число', field: 'revenue', message: null }
    const out = html(createElement(MonthlyFactFormView, { snap, kpis: ['revenue', 'leads'], audience: 'staff', done: false }))
    expect(out).toContain('aria-invalid="true"')
    expect(out).toContain('Выручка за месяц: нужно число')
    expect(out).toContain('Сохраняются как факт с источником «ежемесячная сверка»')
    const saving = html(createElement(MonthlyFactFormView, { snap: { ...snap, phase: 'saving', error: null, field: null }, kpis: ['revenue'], audience: 'client', done: true }))
    expect(saving).toContain('Сохраняем…')
    expect(saving).toContain('Сверка за месяц внесена')
  })

  it('the fixture is deterministic', () => {
    const a: PlanFactState = fixturePlanFact('full')
    expect(JSON.stringify(fixturePlanFact('full'))).toBe(JSON.stringify(a))
  })
})
