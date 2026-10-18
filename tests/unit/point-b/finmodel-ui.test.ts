/**
 * Client «Финмодель» tab, «Цена достижения» and the money rows of «Сценарии» (plan Ф3 Task 5). The repo has
 * no jsdom, so the behaviour lives in framework-free modules (finmodelController.ts, overviewModel.ts,
 * cashChartModel.ts) driven here with a fetch double, and the markup is checked with react-dom/server.
 * The finmodel routes (plan Task 4) are built separately: the doubles follow the contract of the plan.
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fixtureFinmodel, fixtureFinmodelStatus, fixtureModelResult, POINT_B_FIXTURE_VARIANTS } from '@/lib/point-b/fixtures'
import { FINMODEL_DEFS, FINMODEL_KEYS } from '@/lib/point-b/finmodel/keys'
import type { ModelResult } from '@/lib/point-b/model/types'
import {
  FinmodelController, INITIAL_FINMODEL_SNAPSHOT, changedKeys, canVerify, finmodelGroups, formFromState, originBadge, parseFinmodelResponse,
  parseInput, planSave, previewFetch, toInputText, type FinmodelSnapshot, type FinmodelStateView,
} from '@/components/point-b/finmodelController'
import {
  comparisonGroups, comparisonRows, costOfGoalView, finmodelProgress, missingFinmodelKeys, parsePointBState, parseScenarios, scenarioCards,
  type PointBPlanState,
} from '@/components/point-b/overviewModel'
import { cashGeometry, cashReadout, nearestCashMonth } from '@/components/point-b/cashChartModel'
import { PointBStateController } from '@/components/point-b/pointBStateController'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode; className?: string }) => React.createElement('a', { href: p.href, className: p.className }, p.children) }))

const { FinmodelFormView } = await import('@/components/point-b/tabs/FinmodelTab')
const { OverviewView } = await import('@/components/point-b/tabs/OverviewTab')
const { ScenariosReady } = await import('@/components/point-b/tabs/ScenariosTab')
const { default: CashChart } = await import('@/components/point-b/CashChart')
const { default: DataGapBanner } = await import('@/components/point-b/DataGapBanner')

const flat = (html: string) => html.replace(/&#x27;|&quot;/g, '"').replace(/[  ]/g, ' ')
const NO_PLAN: PointBPlanState = { status: 'none', version: null, selectedScenario: null, scenarios: [], approvedAt: null, authorName: null }
const published = (result: ModelResult): PointBPlanState => ({ status: 'published', version: 2, selectedScenario: 'moderate', scenarios: result.scenarios, approvedAt: '2026-10-14T10:00:00.000Z', authorName: 'Анна Ким' })

// ── a fetch double ──────────────────────────────────────────────────────

interface Call { method: string; url: string; body: unknown }
type Reply = { status: number; body: unknown }

function harness(replies: Reply[], onSaved?: () => void) {
  const calls: Call[] = []
  const queue = [...replies]
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const r = queue.shift() ?? { status: 200, body: { ok: true } }
    return { ok: r.status < 400, status: r.status, json: async () => r.body }
  })
  return { ctl: new FinmodelController(fetchFn as unknown as typeof fetch, { onSaved }), calls }
}

const stateBody = (state: FinmodelStateView): Reply => ({ status: 200, body: { ok: true, data: { defs: [], state } } })
const URL_FM = '/api/v1/point-b/finmodel'

const filled = () => fixtureFinmodel('level2')
const partial = () => fixtureFinmodel('full')

const snapOf = (state: FinmodelStateView, over: Partial<FinmodelSnapshot> = {}): FinmodelSnapshot => ({
  ...INITIAL_FINMODEL_SNAPSHOT, phase: 'ready', state, form: formFromState(state), ...over,
})
const noop = () => undefined
const formHtml = (snap: FinmodelSnapshot) => flat(renderToStaticMarkup(React.createElement(FinmodelFormView, { snap, onField: noop, onNote: noop, onSave: noop, onRetry: noop })))

// ── the form ────────────────────────────────────────────────────────────

describe('«Финмодель»: the form', () => {
  it('shows 11 fields grouped with hints and origin badges', () => {
    const html = formHtml(snapOf(filled()))
    for (const g of ['Деньги', 'Расходы и люди', 'Долги', 'Оборотный капитал и налог']) expect(html).toContain(`>${g}</h3>`)
    expect(finmodelGroups().flatMap((g) => g.keys).sort()).toEqual([...FINMODEL_KEYS].sort())
    for (const k of FINMODEL_KEYS) {
      expect(html).toContain(FINMODEL_DEFS[k].label)
      expect(html).toContain(FINMODEL_DEFS[k].hint.slice(0, 40))
    }
    // every field label is tied to its input, and the hint is linked with aria-describedby
    expect(html.match(/<input /g)).toHaveLength(11)
    expect(html.match(/<label for="/g)!.length).toBe(12) // 11 fields + the note
    for (const m of html.matchAll(/<label for="([^"]+)"/g)) expect(html).toContain(`id="${m[1]}"`)
    expect(html.match(/aria-describedby="[^"]*-hint/g)).toHaveLength(11)
    for (const badge of ['введено вами', 'из анкеты', 'допущение по отрасли', 'проверено экспертом']) expect(html).toContain(badge)
    expect(html).toContain('Деньги считаются')
    expect(html).not.toMatch(/NaN|undefined/)
  })

  it('percent fields are entered as % and sent as fractions', async () => {
    const state = filled()
    expect(toInputText(FINMODEL_DEFS.tax_rate, 0.1)).toBe('10')
    expect(toInputText(FINMODEL_DEFS.interest_rate_annual, 0.185)).toBe('18.5')
    expect(formFromState(state).tax_rate).toBe('10')
    const { ctl, calls } = harness([stateBody(state), stateBody({ ...state, values: { ...state.values, tax_rate: { ...state.values.tax_rate!, value: 0.125, origin: 'owner', status: 'entered' } } })])
    await ctl.load()
    ctl.setField('tax_rate', '12,5')
    expect(await ctl.save()).toBe(true)
    expect(calls[1]).toMatchObject({ method: 'PUT', url: URL_FM, body: { values: [{ key: 'tax_rate', value: 0.125 }] } })
    expect(parseInput(FINMODEL_DEFS.tax_rate, '100')).toEqual({ ok: true, value: 1 })
    expect(parseInput(FINMODEL_DEFS.tax_rate, '101').ok).toBe(false)
  })

  it('only changed fields are sent (and a reformatted number is not a change)', async () => {
    const state = filled()
    const { ctl, calls } = harness([stateBody(state), stateBody(state)])
    await ctl.load()
    expect(ctl.hasChanges()).toBe(false)
    expect(await ctl.save()).toBe(false) // nothing to send: no request
    expect(calls).toHaveLength(1)
    expect(ctl.getSnapshot().notice).toBe('Изменений нет')
    ctl.setField('cash_balance', '4 200 000') // the same number with spaces
    expect(changedKeys(ctl.getSnapshot().form, state)).toEqual([])
    ctl.setField('payroll_month', '1500000')
    ctl.setField('capex_year', '0') // zero is a valid answer
    ctl.setNote('  новая ведомость  ')
    await ctl.save()
    expect(calls[1].body).toEqual({ values: [
      { key: 'payroll_month', value: 1_500_000, note: 'новая ведомость' },
      { key: 'capex_year', value: 0, note: 'новая ведомость' },
    ] })
  })

  it('a missing value stays empty: no zero is shown or sent for it', async () => {
    const state = partial()
    const form = formFromState(state)
    expect(form.cash_balance).toBe('')
    expect(form.debt_total).toBe('')
    const html = formHtml(snapOf(state))
    expect(html).not.toMatch(/id="[^"]*-cash_balance"[^>]*value="0"/)
    expect(planSave(form, state, '').values).toEqual([]) // empty is "unchanged", not "0"
    // a cleared value that existed is an invalid change, not a silent zero
    const cleared = { ...form, fixed_costs_month: '' }
    expect(planSave(cleared, state, '').errors.fixed_costs_month).toBe('Введите число')
  })

  it('validates on the client: a value out of range or negative never reaches the server', async () => {
    const { ctl, calls } = harness([stateBody(filled())])
    await ctl.load()
    ctl.setField('dso_days', '400')
    ctl.setField('payroll_month', '-5')
    ctl.setField('dpo_days', 'abc')
    expect(await ctl.save()).toBe(false)
    expect(calls).toHaveLength(1)
    const errs = ctl.getSnapshot().fieldErrors
    expect(errs.dso_days).toContain('от 0 до 365')
    expect(errs.payroll_month).toBe('Значение не может быть отрицательным')
    expect(errs.dpo_days).toContain('цифрами')
    // typing in a field clears only its error
    ctl.setField('dso_days', '30')
    expect(ctl.getSnapshot().fieldErrors.dso_days).toBeUndefined()
    expect(ctl.getSnapshot().fieldErrors.payroll_month).toBeDefined()
  })

  it('server field errors are shown under the field, the profanity error under the note', async () => {
    const state = filled()
    const { ctl } = harness([
      stateBody(state),
      { status: 400, body: { ok: false, error: 'Значение вне допустимого диапазона', code: 'invalid_value', field: 'payroll_month' } },
      { status: 400, body: { ok: false, error: 'Уберите грубые слова из комментария', field: 'note' } },
    ])
    await ctl.load()
    ctl.setField('payroll_month', '1500000')
    expect(await ctl.save()).toBe(false)
    let snap = ctl.getSnapshot()
    expect(snap.fieldErrors.payroll_month).toBe('Значение вне допустимого диапазона')
    expect(snap.form.payroll_month).toBe('1500000') // what was typed stays
    let html = formHtml(snap)
    expect(html).toContain('role="alert"')
    expect(html).toMatch(/aria-invalid="true"[^>]*aria-describedby="[^"]*-payroll_month-hint [^"]*-payroll_month-err"/)
    expect(html).toContain('Значение вне допустимого диапазона')
    ctl.setNote('плохо')
    expect(await ctl.save()).toBe(false)
    snap = ctl.getSnapshot()
    expect(snap.fieldErrors.note).toBe('Уберите грубые слова из комментария')
    html = formHtml(snap)
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"[^>]*aria-describedby="[^"]*-note-err"/)
  })

  it('non-field failures: the server text, or a Russian text by status (429, 403 while impersonating, no network)', async () => {
    const state = filled()
    const { ctl } = harness([
      stateBody(state),
      { status: 429, body: { ok: false, error: 'Too many requests' } },
      { status: 403, body: { ok: false, error: 'В режиме «от имени» менять финмодель нельзя.' } },
    ])
    await ctl.load()
    ctl.setField('payroll_month', '1')
    await ctl.save()
    expect(ctl.getSnapshot().saveError).toBe('Слишком много запросов. Подождите немного и повторите.')
    await ctl.save()
    expect(ctl.getSnapshot().saveError).toBe('В режиме «от имени» менять финмодель нельзя.')
    expect(ctl.getSnapshot().saving).toBe(false)
    const down = new FinmodelController((async () => { throw new Error('offline') }) as unknown as typeof fetch)
    await down.load()
    expect(down.getSnapshot()).toMatchObject({ phase: 'error', error: 'Нет связи с сервером. Проверьте соединение и повторите.' })
    expect(formHtml(down.getSnapshot())).toContain('Повторить')
  })

  it('a saved form is refreshed from the answer and reports back (the overview recalculates)', async () => {
    const state = partial()
    const after: FinmodelStateView = {
      ...state,
      values: { ...state.values, cash_balance: { key: 'cash_balance', value: 3_000_000, origin: 'owner', status: 'entered', note: null, verifiedByName: null, verifiedAt: null, updatedAt: '2026-10-18T10:00:00Z' } },
      missing: state.missing.filter((k) => k !== 'cash_balance'),
    }
    const onSaved = vi.fn()
    const { ctl } = harness([stateBody(state), stateBody(after)], onSaved)
    await ctl.load()
    ctl.setField('cash_balance', '3000000')
    ctl.setNote('по выписке')
    expect(await ctl.save()).toBe(true)
    const snap = ctl.getSnapshot()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(snap.state.missing).not.toContain('cash_balance')
    expect(snap.form.cash_balance).toBe('3000000')
    expect(snap.note).toBe('')
    expect(snap.notice).toContain('Сохранено')
    expect(changedKeys(snap.form, snap.state)).toEqual([])
  })

  it('missing keys get the frame, unlocks text and the two actions', () => {
    const html = formHtml(snapOf(partial()))
    expect(html.match(/Нужно для расчёта денег<\/p>/g)).toHaveLength(4)
    expect(html).toContain(`После заполнения откроется: ${FINMODEL_DEFS.cash_balance.unlocks}`)
    expect(html).toContain(`После заполнения откроется: ${FINMODEL_DEFS.payroll_month.unlocks}`)
    expect(html.match(/href="\/client\/onboarding\/documents"/g)).toHaveLength(4)
    expect(html.match(/href="\/client\/messages"/g)).toHaveLength(4)
    expect(html).toContain('Загрузить файл')
    expect(html).toContain('Попросить эксперта')
    expect(html).toContain('Заполнено 1 из 5')
    // a filled form has no frames
    expect(formHtml(snapOf(filled()))).not.toContain('Нужно для расчёта денег')
  })

  it('verified badge shows the expert name and date; a re-entered value is the owner\'s again', () => {
    const v = filled().values.cash_balance!
    const b = originBadge(v)!
    expect(b.label).toBe('проверено экспертом · Анна Ким · 16 октября 2026 г.')
    expect(b.tone).toBe('good')
    expect(originBadge({ ...v, status: 'entered', origin: 'owner', verifiedByName: null, verifiedAt: null })!.label).toBe('введено вами')
    expect(originBadge({ ...v, status: 'entered', origin: 'expert' })!.label).toBe('введено экспертом, не проверено')
    expect(originBadge(undefined)).toBeNull()
    expect(canVerify(v)).toBe(false) // already verified
    expect(canVerify({ ...v, status: 'entered', origin: 'owner' })).toBe(true)
    expect(canVerify(filled().values.tax_rate)).toBe(false) // default
    expect(canVerify(filled().values.debt_total)).toBe(false) // from the questionnaire
    expect(formHtml(snapOf(filled()))).toContain('проверено экспертом · Анна Ким · 16 октября 2026 г.')
  })

  it('402 renders the paywall and the form is not drawn; loading is a skeleton', async () => {
    const { ctl } = harness([{ status: 402, body: { ok: false, error: 'upgrade_required' } }])
    await ctl.load()
    expect(ctl.getSnapshot().phase).toBe('locked')
    const html = formHtml(ctl.getSnapshot())
    expect(html).toContain('Точка Б — на тарифе Pro')
    expect(html).not.toContain('<input')
    expect(formHtml(INITIAL_FINMODEL_SNAPSHOT)).toContain('aria-busy="true"')
    // a 402 on save locks too
    const saving = harness([stateBody(filled()), { status: 402, body: { ok: false, error: 'upgrade_required' } }])
    await saving.ctl.load()
    saving.ctl.setField('payroll_month', '1')
    await saving.ctl.save()
    expect(saving.ctl.getSnapshot().phase).toBe('locked')
  })

  it('parses the response tolerantly: unknown keys and non-finite numbers are dropped, never turned into zero', () => {
    const parsed = parseFinmodelResponse({ ok: true, data: { state: { values: { cash_balance: { value: 'x', origin: 'owner', status: 'entered' }, bogus: { value: 1 }, payroll_month: { value: 5, origin: 'weird', status: 'whatever' } }, missing: ['cash_balance', 'nope'], complete: false, defaulted: [] } } })!
    expect(parsed.state.values.cash_balance).toBeUndefined()
    expect(parsed.state.values.payroll_month).toMatchObject({ value: 5, origin: 'owner', status: 'entered' })
    expect(parsed.state.missing).toEqual(['cash_balance'])
    expect(parseFinmodelResponse({ ok: true, data: {} })).toBeNull()
    expect(parseFinmodelResponse({ ok: false })).toBeNull()
  })

  it('the dev preview fetch serves the fixture and applies a save in memory', async () => {
    const f = previewFetch(partial())
    const ctl = new FinmodelController(f)
    await ctl.load()
    expect(ctl.getSnapshot().state.missing).toContain('cash_balance')
    ctl.setField('cash_balance', '2000000')
    expect(await ctl.save()).toBe(true)
    expect(ctl.getSnapshot().state.missing).not.toContain('cash_balance')
    expect(ctl.getSnapshot().state.values.cash_balance).toMatchObject({ value: 2_000_000, origin: 'owner', status: 'entered' })
  })
})

// ── cost of the goal ────────────────────────────────────────────────────

describe('«Цена достижения»', () => {
  it('shows the level-2 numbers for the chosen pace, with the range where there is one', () => {
    const r = fixtureModelResult('level2')
    const html = flat(renderToStaticMarkup(React.createElement(OverviewView, { result: r, plan: published(r), finmodel: fixtureFinmodelStatus('level2') })))
    expect(html).toContain('Цена достижения')
    for (const l of ['Инвестиции', 'Срок выхода на цель', 'Минимальная касса', 'Нехватка денег', 'Резерв ликвидности']) expect(html).toContain(l)
    expect(html).toContain('Темп: Умеренный')
    expect(html).not.toContain('Откроется после заполнения финмодели')
    const view = costOfGoalView(r, null, 'moderate')
    expect(view.mode).toBe('ready')
    const moderate = r.scenarios.find((s) => s.key === 'moderate')!
    expect(view.cells.find((c) => c.label === 'Минимальная касса')!.note).toBe(`в месяце ${moderate.finance!.minCash.month}`)
    expect(view.cells.find((c) => c.label === 'Срок выхода на цель')!.note).toMatch(/^диапазон \d+–\d+ мес\.$/)
    // the chosen pace changes the numbers; the aggressive one has a cash gap and says so
    const aggressive = costOfGoalView(r, null, 'aggressive')
    expect(aggressive.scenarioLabel).toBe('Ускоренный')
    expect(aggressive.cells.find((c) => c.label === 'Нехватка денег')!.note).toMatch(/^Кассовый разрыв в месяце \d+$/)
    expect(aggressive.caveat).toContain('не достигает цели')
    expect(html).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('at level 1 it is a grey card with «заполнено N из M» and the way to fill the finmodel', () => {
    const r = fixtureModelResult('full')
    const html = flat(renderToStaticMarkup(React.createElement(OverviewView, { result: r, plan: NO_PLAN, finmodel: fixtureFinmodelStatus('full') })))
    expect(html).toContain('Цена достижения')
    expect(html).toContain('Откроется после заполнения финмодели')
    expect(html).toContain('Заполнено 1 из 5')
    expect(html).toContain('border-dashed')
    expect(html).toContain('Заполнить финмодель')
    // no numbers of money are invented
    expect(html).not.toContain('Минимальная касса')
    const view = costOfGoalView(r, null, null)
    expect(view.mode).toBe('locked')
    // without PointBState.finmodel the progress falls back to the `finmodel:*` items of the result
    expect(missingFinmodelKeys(r, null)).toEqual(['cash_balance', 'payroll_month', 'debt_total', 'capex_year'])
    expect(view.progress).toEqual({ filled: 1, total: 5 })
    // conditional keys count only when the server asks for them (a debt exists)
    expect(finmodelProgress(['debt_service_month', 'interest_rate_annual'])).toEqual({ filled: 5, total: 7 })
    expect(finmodelProgress(null)).toBeNull()
  })

  it('level 0 says there is nothing to price yet and offers no button', () => {
    const r = fixtureModelResult('no-goal')
    const html = flat(renderToStaticMarkup(React.createElement(OverviewView, { result: r, plan: NO_PLAN, finmodel: null })))
    expect(html).toContain('Появится после того, как будут заданы цель и данные')
    expect(html).not.toContain('Заполнить финмодель')
  })

  it('the data-gap banner sends money items to the «Финмодель» tab and the survey to step 9', () => {
    const r = fixtureModelResult('full')
    const html = flat(renderToStaticMarkup(React.createElement(DataGapBanner, { missing: r.missing })))
    expect(html).toContain('Заполнить финмодель')
    expect(html).toContain('href="/client/onboarding?step=9"')
    expect(html).not.toContain('href="/client/onboarding"')
    // an item of level 1 keeps the plain survey link and has no finmodel button
    const plain = flat(renderToStaticMarkup(React.createElement(DataGapBanner, { missing: fixtureModelResult('no-goal').missing })))
    expect(plain).toContain('href="/client/onboarding"')
    expect(plain).not.toContain('Заполнить финмодель')
  })
})

// ── scenarios: money rows ───────────────────────────────────────────────

describe('«Сценарии»: money', () => {
  it('the table has the money rows and flags the cash gap month', () => {
    const r = fixtureModelResult('level2')
    const rows = comparisonRows(r.scenarios)
    const keys = rows.map((x) => x.key)
    for (const k of ['netProfit', 'cfo', 'minCash', 'cashGap', 'funding', 'reserve']) expect(keys).toContain(k)
    const gap = rows.find((x) => x.key === 'cashGap')!
    const aggressive = r.scenarios.findIndex((s) => s.key === 'aggressive')
    expect(gap.cells[aggressive][0]).toBe(`В месяце ${r.scenarios[aggressive].finance!.cashGapMonth}`)
    expect(gap.tones![aggressive]).toBe('bad')
    expect(gap.cells[0]).toEqual(['Нет'])
    expect(gap.tones![0]).toBeUndefined()
    expect(rows.find((x) => x.key === 'funding')!.tones![aggressive]).toBe('warn')

    const html = flat(renderToStaticMarkup(React.createElement(ScenariosReady, { plan: published(r), target: r.gap.targetAnnual })))
    for (const l of ['Чистая прибыль за период', 'Операционный денежный поток', 'Минимальная касса (месяц)', 'Кассовый разрыв', 'Нужно финансирование', 'Резерв ликвидности']) expect(html).toContain(l)
    expect(html).toContain(`В месяце ${r.scenarios[aggressive].finance!.cashGapMonth}`)
    expect(html).toContain(`Кассовый разрыв в месяце ${r.scenarios[aggressive].finance!.cashGapMonth}.`) // the plaque in the card
    expect(html).toContain('Допущения денежной модели')
    expect(html).not.toContain('здесь не оцениваются')
    // the money table is also a card per scenario on a phone
    expect(html).toContain('md:hidden')
    expect(html).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('profit and cash are different lines, and a profitable pace can still run out of cash', () => {
    const r = fixtureModelResult('level2')
    const f = r.scenarios.find((s) => s.key === 'aggressive')!.finance!
    expect(f.totals.netProfit).toBeGreaterThan(0)
    expect(f.cashGapMonth).not.toBeNull()
    expect(f.minCash.value).toBeLessThan(0)
    expect(f.fundingNeed).toBeGreaterThanOrEqual(0)
  })

  it('without money the table is unchanged and the note sends the owner to the finmodel', () => {
    const r = fixtureModelResult('full')
    expect(comparisonRows(r.scenarios).map((x) => x.key)).toEqual(['time', 'revenue', 'feasible', 'uplift', 'marketing', 'invest', 'staff', 'investNote'])
    expect(comparisonGroups(r.scenarios)).toHaveLength(7)
    expect(scenarioCards(r.scenarios, null, null).every((c) => c.money === null)).toBe(true)
    const html = flat(renderToStaticMarkup(React.createElement(ScenariosReady, { plan: published(r), target: r.gap.targetAnnual })))
    expect(html).toContain('заполните вкладку «Финмодель»')
    expect(html).not.toContain('Деньги по месяцам')
    expect(html).not.toContain('Чистая прибыль за период')
  })

  it('the state response carries finance through the parser; a broken finance block is dropped, not zeroed', () => {
    const r = fixtureModelResult('level2')
    const body = { ok: true, data: { overview: { result: r }, plan: { status: 'published', scenarios: r.scenarios }, finmodel: { complete: true, missing: [], defaulted: ['tax_rate', 'nope'] } } }
    const ok = parsePointBState(body)!
    expect(ok.result.level).toBe(2)
    expect(ok.result.scenarios[0].finance?.cash).toEqual(r.scenarios[0].finance!.cash)
    expect(ok.finmodel).toEqual({ complete: true, missing: [], defaulted: ['tax_rate'] })
    const broken = parseScenarios([{ ...r.scenarios[0], finance: { ...r.scenarios[0].finance, cash: [1, 'x'] } }])
    expect(broken).toHaveLength(1)
    expect(broken[0].finance).toBeUndefined()
    expect(parsePointBState({ ok: true, data: { overview: { result: r } } })!.finmodel).toBeNull()
  })

  it('the state controller keeps the finmodel status next to the result', async () => {
    const r = fixtureModelResult('full')
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { overview: { result: r }, plan: {}, finmodel: fixtureFinmodelStatus('full') } }) }))
    const ctl = new PointBStateController(fetchFn as unknown as typeof fetch)
    await ctl.load()
    expect(ctl.getSnapshot().finmodel?.missing).toContain('cash_balance')
  })
})

// ── the cash chart ──────────────────────────────────────────────────────

describe('CashChart', () => {
  const scenario = (key: 'cautious' | 'moderate' | 'aggressive') => fixtureModelResult('level2').scenarios.find((s) => s.key === key)!

  it('has no NaN and marks zero, the reserve, the lowest point and the first month below zero', () => {
    const s = scenario('aggressive')
    const html = flat(renderToStaticMarkup(React.createElement(CashChart, { finance: s.finance!, scenarioLabel: s.label })))
    expect(html).toContain('<svg')
    expect(html).toContain('role="img"')
    expect(html).toContain('Резерв ')
    expect(html).toContain('>0</text>')
    expect(html).toContain(`разрыв: мес. ${s.finance!.cashGapMonth}`)
    expect(html).toContain('clip-path')
    expect(html).toContain('Ниже нуля')
    expect(html).toContain(`кассовый разрыв в месяце ${s.finance!.cashGapMonth}`)
    expect(html).not.toMatch(/NaN|undefined|Infinity/)
    // a pace without a gap has no gap mark
    const fine = scenario('cautious')
    const calm = flat(renderToStaticMarkup(React.createElement(CashChart, { finance: fine.finance!, scenarioLabel: fine.label })))
    expect(calm).not.toContain('разрыв: мес.')
    expect(calm).toContain('кассового разрыва нет')
  })

  it('geometry stays finite for odd series: zero and negative cash, no reserve, a flat line, one point', () => {
    const base = scenario('moderate').finance!
    const odd = [
      { ...base, cash: [-5, -3, -1, -2], netProfit: [1, 1, 1, 1], minCash: { value: -5, month: 1 }, cashGapMonth: 1, reserveRequired: 0 },
      { ...base, cash: [0, 0, 0], netProfit: [0, 0, 0], minCash: { value: 0, month: 1 }, cashGapMonth: null, reserveRequired: 0 },
      { ...base, cash: [7, 7, 7], netProfit: [0, 0, 0], minCash: { value: 7, month: 1 }, cashGapMonth: null, reserveRequired: 100 },
    ]
    for (const f of odd) {
      const g = cashGeometry(f, 320, 240)!
      expect(g).not.toBeNull()
      expect(JSON.stringify(g)).not.toMatch(/NaN|Infinity|null,"x"/)
      expect(Number.isFinite(g.zeroY) && g.zeroY >= g.plot.top && g.zeroY <= g.plot.bottom).toBe(true)
    }
    expect(cashGeometry({ ...base, cash: [5] }, 320, 240)).toBeNull()
    expect(cashGeometry({ ...base, cash: [1, Number.NaN, 3] }, 320, 240)).toBeNull()
    // the reserve line is drawn only when there is a reserve
    expect(cashGeometry(odd[0], 320, 240)!.reserveY).toBeNull()
    expect(cashGeometry(odd[2], 320, 240)!.reserveY).not.toBeNull()
    // unusable series: an honest placeholder, not an empty frame
    const html = flat(renderToStaticMarkup(React.createElement(CashChart, { finance: { ...base, cash: [] }, scenarioLabel: 'X' })))
    expect(html).toContain('График кассы недоступен')
  })

  it('a pointer reads the cash AND the profit of the nearest month', () => {
    const f = scenario('aggressive').finance!
    const g = cashGeometry(f, 640, 240)!
    expect(nearestCashMonth(g, g.plot.left)).toBe(1)
    expect(nearestCashMonth(g, g.plot.right)).toBe(g.months)
    expect(nearestCashMonth(g, Number.NaN)).toBeNull()
    const text = cashReadout(f, 7)
    expect(text).toContain('Месяц 7: касса')
    expect(text).toContain('прибыль за месяц')
    expect(text).toContain('касса ниже нуля')
  })
})

describe('fixtures: level 2', () => {
  it('is listed as a variant and is consistent: Σ CF = cash_end − cash_start, no NaN, funding need ≥ 0', () => {
    expect(POINT_B_FIXTURE_VARIANTS).toContain('level2')
    const r = fixtureModelResult('level2')
    expect(r.level).toBe(2)
    expect(r.modelVersion).toBe('pb-model-2')
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/)
    for (const s of r.scenarios) {
      const f = s.finance!
      expect(f.cash).toHaveLength(f.ebitda.length)
      expect(f.cash.length).toBeLessThanOrEqual(60)
      expect(f.fundingNeed).toBeGreaterThanOrEqual(0)
      expect(f.minCash.value).toBe(Math.min(...f.cash))
      expect(f.cash[f.minCash.month - 1]).toBe(f.minCash.value)
      const gap = f.cash.findIndex((c) => c < 0)
      expect(f.cashGapMonth).toBe(gap === -1 ? null : gap + 1)
      // cash_end − cash_start = operating cash flow − debt service − capex (cash_start is the one of the finmodel fixture)
      const cash0 = filled().values.cash_balance!.value
      expect(f.cash[f.cash.length - 1] - cash0).toBe(f.totals.operatingCashFlow - f.totals.debtService - f.totals.capex)
    }
    const need = (k: string) => r.scenarios.find((s) => s.key === k)!.finance!.fundingNeed
    expect(need('aggressive')).toBeGreaterThanOrEqual(need('moderate'))
    expect(need('moderate')).toBeGreaterThanOrEqual(need('cautious'))
    // the other variants stay at level 1 or 0 without money
    for (const v of ['full', 'stale-base', 'no-goal'] as const) expect(fixtureModelResult(v).scenarios.every((s) => !s.finance)).toBe(true)
  })

  it('the finmodel fixtures follow the keys: complete for level2, partial with the rest missing otherwise', () => {
    const full = filled()
    expect(full.complete).toBe(true)
    expect(full.missing).toEqual([])
    for (const k of FINMODEL_KEYS) expect(full.values[k], k).toBeDefined()
    const part = partial()
    expect(part.complete).toBe(false)
    for (const k of part.missing) expect(part.values[k]).toBeUndefined()
    expect(fixtureFinmodelStatus('full').missing).toEqual(part.missing)
  })
})
