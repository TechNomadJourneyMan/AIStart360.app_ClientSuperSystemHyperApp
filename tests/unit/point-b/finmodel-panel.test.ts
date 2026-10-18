/**
 * Expert «Финмодель» panel in User 360 → «Точка Б» and the money totals in the scenarios panel
 * (plan Ф3 Task 6). The repo has no jsdom, so the behaviour lives in a framework-free controller
 * (components/giga-panel/user360/point-b/finmodelPanelController.ts) driven with a fetch double, and
 * the markup is checked with react-dom/server. The routes of plan Task 4 are built separately: the
 * doubles follow the contract of the plan.
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fixtureFinmodel, fixtureModelResult } from '@/lib/point-b/fixtures'
import { FINMODEL_DEFS, FINMODEL_KEYS } from '@/lib/point-b/finmodel/keys'
import { DEFAULT_PROFILES, profileToForm } from '@/components/giga-panel/user360/point-b/scenariosController'
import {
  FinmodelPanelController, INITIAL_PANEL_SNAPSHOT, isMismatchWarning, rowStatus, verifiableSelection, type PanelSnapshot,
} from '@/components/giga-panel/user360/point-b/finmodelPanelController'
import { formFromState, type FinmodelStateView } from '@/components/point-b/finmodelController'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => React.createElement('a', { href: p.href }, p.children) }))

const { FinmodelPanelView } = await import('@/components/giga-panel/user360/point-b/FinmodelPanel')
const { ScenariosPanelView } = await import('@/components/giga-panel/user360/point-b/ScenariosPanel')

const USER = 'cccccccc-0000-4000-8000-000000000001'
const URL_FM = `/api/giga-admin/users/${USER}/point-b/finmodel`
const flat = (html: string) => html.replace(/&#x27;|&quot;/g, '"').replace(/[  ]/g, ' ')

interface Call { method: string; url: string; body: unknown }
type Reply = { status: number; body: unknown }

function harness(replies: Reply[]) {
  const calls: Call[] = []
  const queue = [...replies]
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const r = queue.shift() ?? { status: 200, body: { ok: true } }
    return { ok: r.status < 400, status: r.status, json: async () => r.body }
  })
  return { ctl: new FinmodelPanelController(USER, fetchFn as unknown as typeof fetch), calls }
}

const stateBody = (state: FinmodelStateView, warnings?: string[]): Reply => ({ status: 200, body: { ok: true, data: { defs: [], state, ...(warnings ? { warnings } : {}) } } })

/** The level-2 fixture: cash verified by an expert, debt from the questionnaire, four industry assumptions, the rest typed by the owner. */
const state = (): FinmodelStateView => fixtureFinmodel('level2')

const snapOf = (s: FinmodelStateView, over: Partial<PanelSnapshot> = {}): PanelSnapshot => ({
  ...INITIAL_PANEL_SNAPSHOT, phase: 'ready', state: s, form: formFromState(s), ...over,
})
const noop = () => undefined
const viewHtml = (snap: PanelSnapshot) => flat(renderToStaticMarkup(React.createElement(FinmodelPanelView, {
  snap, onField: noop, onNote: noop, onToggle: noop, onSave: noop, onVerify: noop, onRetry: noop,
})))

describe('FinmodelPanel', () => {
  it('lists keys with origin and status and the expert can edit and save', async () => {
    const s = state()
    const saved: FinmodelStateView = { ...s, values: { ...s.values, payroll_month: { ...s.values.payroll_month!, value: 1_500_000, origin: 'expert', status: 'entered' } } }
    const { ctl, calls } = harness([stateBody(s), stateBody(saved)])
    await ctl.load()
    const html = viewHtml(ctl.getSnapshot())
    for (const k of FINMODEL_KEYS) expect(html).toContain(FINMODEL_DEFS[k].label)
    for (const g of ['Деньги', 'Расходы и люди', 'Долги', 'Оборотный капитал и налог']) expect(html).toContain(g)
    expect(html.match(/type="text"/g)).toHaveLength(11)
    expect(html.match(/<label for="/g)!.length).toBe(12) // 11 values + the note
    expect(html).toContain('проверено экспертом · Анна Ким · 16 октября 2026 г.')
    expect(html).toContain('введено владельцем')
    expect(html).toContain('из анкеты')
    expect(html).toContain('Уровень данных: 2')
    expect(html).not.toMatch(/NaN|undefined/)

    ctl.setField('payroll_month', '1 500 000')
    ctl.setNote('сверил по ведомости')
    expect(ctl.hasChanges()).toBe(true)
    expect(await ctl.save()).toBe(true)
    expect(calls[1]).toMatchObject({ method: 'PUT', url: URL_FM, body: { values: [{ key: 'payroll_month', value: 1_500_000, note: 'сверил по ведомости' }] } })
    const after = ctl.getSnapshot()
    expect(after.state.values.payroll_month).toMatchObject({ origin: 'expert', status: 'entered' })
    expect(after.note).toBe('')
    expect(after.notice).toContain('Сохранено')
    expect(viewHtml(after)).toContain('введено экспертом')
    // percent: typed as %, sent as a fraction
    ctl.setField('tax_rate', '12')
    await ctl.save()
    expect((calls[2].body as { values: Array<{ key: string; value: number }> }).values).toEqual([{ key: 'tax_rate', value: 0.12 }])
  })

  it('verify is offered only for values stored from people, not auto or default', async () => {
    const s = state()
    const { ctl, calls } = harness([stateBody(s), { status: 200, body: { ok: true } }, stateBody({ ...s, values: { ...s.values, payroll_month: { ...s.values.payroll_month!, status: 'verified', verifiedByName: 'Анна Ким', verifiedAt: '2026-10-18T10:00:00Z' } } })])
    await ctl.load()
    // nobody can verify what the platform filled in, what an expert has verified already, or an assumption
    for (const k of ['debt_total', 'cash_balance', 'tax_rate', 'dso_days'] as const) {
      ctl.toggle(k)
      expect(ctl.getSnapshot().selected, k).toEqual([])
    }
    const html = viewHtml(ctl.getSnapshot())
    expect(html.match(/type="checkbox"/g)).toHaveLength(11)
    // enabled: fixed costs, payroll, debt service, rate, capex (typed by the owner, not verified)
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(6)
    expect(html).toContain('Подставлено автоматически или принято по отрасли')
    expect(html).toContain('disabled=""') // «Подтвердить выбранные» is off with nothing ticked

    ctl.toggle('payroll_month')
    ctl.toggle('capex_year')
    ctl.toggle('payroll_month') // untick
    expect(ctl.getSnapshot().selected).toEqual(['capex_year'])
    ctl.toggle('payroll_month')
    expect(ctl.getSnapshot().selected).toEqual(['payroll_month', 'capex_year']) // in key order
    expect(viewHtml(ctl.getSnapshot())).toContain('Подтвердить выбранные (2)')
    expect(await ctl.verify()).toBe(true)
    expect(calls[1]).toMatchObject({ method: 'POST', url: `${URL_FM}/verify`, body: { keys: ['payroll_month', 'capex_year'] } })
    const snap = ctl.getSnapshot()
    expect(snap.selected).toEqual([])
    expect(snap.notice).toBe('Подтверждено значений: 2')
    expect(snap.state.values.payroll_month?.status).toBe('verified') // read again after the verification
    expect(rowStatus(snap.state, 'payroll_month')).toMatchObject({ label: 'Проверено', tone: 'green' })
  })

  it('does not verify a value with unsaved edits, and does not call the server with nothing ticked', async () => {
    const { ctl, calls } = harness([stateBody(state())])
    await ctl.load()
    expect(await ctl.verify()).toBe(false)
    expect(ctl.getSnapshot().actionError).toBe('Отметьте значения, которые вы проверили')
    ctl.toggle('payroll_month')
    ctl.setField('payroll_month', '2000000')
    const snap = ctl.getSnapshot()
    expect(verifiableSelection(snap.state, snap.form, snap.selected)).toEqual([])
    // a row being edited cannot be ticked in the markup either
    const html = viewHtml({ ...snap, selected: [] })
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)!.length).toBe(7)
    expect(await ctl.verify()).toBe(false)
    expect(ctl.getSnapshot().actionError).toContain('Сначала сохраните правки')
    expect(calls).toHaveLength(1)
  })

  it('server errors are shown: the field under its input, 403 / 409 / not_found as text', async () => {
    const { ctl } = harness([
      stateBody(state()),
      { status: 400, body: { ok: false, error: 'Значение вне допустимого диапазона', code: 'invalid_value', field: 'fixed_costs_month' } },
      { status: 403, body: { ok: false, error: 'Клиент не назначен вам' } },
      { status: 409, body: { ok: false, error: 'Значение уже изменено другим пользователем' } },
      { status: 400, body: { ok: false, error: 'По этому показателю нет сохранённого значения', code: 'not_found' } },
    ])
    await ctl.load()
    ctl.setField('fixed_costs_month', '999999999999999')
    // out of range on the client: nothing is sent
    expect(await ctl.save()).toBe(false)
    expect(ctl.getSnapshot().fieldErrors.fixed_costs_month).toContain('Допустимо')
    ctl.setField('fixed_costs_month', '800000')
    expect(await ctl.save()).toBe(false)
    let snap = ctl.getSnapshot()
    expect(snap.fieldErrors.fixed_costs_month).toBe('Значение вне допустимого диапазона')
    expect(snap.busy).toBeNull()
    let html = viewHtml(snap)
    expect(html).toMatch(/aria-invalid="true"[^>]*aria-describedby="[^"]*-fixed_costs_month-err"/)
    expect(html).toContain('Значение вне допустимого диапазона')
    expect(snap.form.fixed_costs_month).toBe('800000') // what was typed stays
    await ctl.save()
    expect(ctl.getSnapshot().actionError).toBe('Клиент не назначен вам')
    html = viewHtml(ctl.getSnapshot())
    expect(html).toContain('role="alert"')
    await ctl.save()
    expect(ctl.getSnapshot().actionError).toBe('Значение уже изменено другим пользователем')
    ctl.toggle('payroll_month')
    ctl.setField('fixed_costs_month', '650000') // back to the stored value: no edit
    expect(await ctl.verify()).toBe(false)
    snap = ctl.getSnapshot()
    expect(snap.actionError).toBe('По этому показателю нет сохранённого значения')
    expect(snap.busy).toBeNull()
    // a load that fails shows the retry state; a down network too
    const down = new FinmodelPanelController(USER, (async () => { throw new Error('offline') }) as unknown as typeof fetch)
    await down.load()
    expect(down.getSnapshot()).toMatchObject({ phase: 'error', error: 'Нет связи с сервером. Проверьте соединение и повторите.' })
    expect(viewHtml(down.getSnapshot())).toContain('Нет связи с сервером')
  })

  it('defaults are labelled as assumptions; a missing value is called out; the mismatch warning is highlighted', async () => {
    const s = state()
    expect(rowStatus(s, 'tax_rate')).toMatchObject({ label: 'Допущение по умолчанию', tone: 'amber' })
    expect(rowStatus(s, 'debt_total')).toMatchObject({ label: 'Из данных клиента', tone: 'neutral' })
    expect(rowStatus(s, 'payroll_month')).toMatchObject({ label: 'Не проверено', tone: 'amber' })
    const warnings = ['Расходы по модели расходятся с фактом на 34%', 'Оборотный капитал и налог — допущения по отрасли']
    expect(warnings.map(isMismatchWarning)).toEqual([true, false])
    const { ctl } = harness([stateBody(s, warnings)])
    await ctl.load()
    const html = viewHtml(ctl.getSnapshot())
    expect(html.match(/Допущение по умолчанию/g)).toHaveLength(4)
    expect(html).toContain('допущение по отрасли')
    expect(html).toContain('Допущения по отрасли: налоговая нагрузка')
    expect(html).toContain('Модель расходится с фактом')
    expect(html).toContain('Расходы по модели расходятся с фактом на 34%')
    expect(html).toContain('Предупреждения расчёта')
    // a client with a gap: the key has no value and says it is needed
    const partial = fixtureFinmodel('full')
    expect(rowStatus(partial, 'cash_balance')).toMatchObject({ label: 'Нет значения', tone: 'red' })
    const gapHtml = viewHtml(snapOf(partial))
    expect(gapHtml).toContain('Нужно для уровня 2')
    expect(gapHtml).toContain('Заполнено 1 из 5')
    expect(gapHtml).not.toContain('Уровень данных: 2')
  })
})

describe('ScenariosPanel: level and money', () => {
  type ViewProps = React.ComponentProps<typeof ScenariosPanelView>
  const baseView = (over: Partial<ViewProps> = {}): ViewProps => ({
    versionNumber: 3, editable: true, scenarios: [], model: null, selected: null, busy: null, error: null, notice: null,
    forms: DEFAULT_PROFILES.map(profileToForm), formErrors: {}, profilesReady: true,
    onField: noop, onMix: noop, onNormalize: noop, onResetForms: noop, onCompute: noop, onSelect: noop, ...over,
  })
  const html = (over: Partial<ViewProps> = {}) => flat(renderToStaticMarkup(React.createElement(ScenariosPanelView, baseView(over))))

  it('scenarios panel shows level and money totals', () => {
    const r = fixtureModelResult('level2')
    const out = html({ scenarios: r.scenarios, model: r })
    expect(out).toContain('Уровень данных: 2')
    for (const label of ['Чистая прибыль за период', 'Операционный денежный поток', 'Минимальная касса (месяц)', 'Кассовый разрыв', 'Нужно финансирование', 'Резерв ликвидности']) expect(out).toContain(label)
    const aggressive = r.scenarios.find((s) => s.key === 'aggressive')!.finance!
    expect(out).toContain(`В месяце ${aggressive.cashGapMonth}`)
    expect(out).toContain('font-semibold text-red-300') // the cash gap stands out
    expect(out).not.toMatch(/NaN|undefined|Infinity/)
    // the reserve field no longer says the reserve is a later phase
    expect(out).not.toContain('считается в Ф3')
  })

  it('level 1: says money is not counted and shows no money rows', () => {
    const r = fixtureModelResult('full')
    const out = html({ scenarios: r.scenarios, model: r })
    expect(out).toContain('Уровень данных: 1 — деньги не считаются')
    expect(out).not.toContain('Чистая прибыль за период')
    expect(out).not.toContain('Минимальная касса (месяц)')
    // the saved scenarios of a version without a calculation in this session: the level follows the scenarios
    expect(html({ scenarios: fixtureModelResult('level2').scenarios, model: null })).toContain('Уровень данных: 2')
    expect(html({ scenarios: r.scenarios, model: null })).toContain('Уровень данных: 1')
    // no scenarios at all: no claim about the level
    expect(html({ scenarios: [], model: null })).not.toContain('Уровень данных')
  })
})
