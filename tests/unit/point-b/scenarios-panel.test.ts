/**
 * Expert scenario calculation in a plan draft (plan Phase 2 Task 9). The repo has no jsdom, so
 * the behaviour lives in a framework-free controller
 * (components/giga-panel/user360/point-b/scenariosController.ts) driven with a fetch double, and
 * the markup is checked with react-dom/server. The routes of plan Task 7 are built separately:
 * the doubles follow the contract of the plan.
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fixtureModelResult } from '@/lib/point-b/fixtures'
import type { ModelResult, ScenarioProfile } from '@/lib/point-b/model/types'
import type { PlanVersionRow, PlanVersionStatus } from '@/lib/point-b/plan/types'
import {
  DEFAULT_PROFILES, ScenariosController, mixSum, normalizeForm, normalizeMixPercent, parseProfiles, profileToForm,
  validateForms, validateProfileForm, type ProfileForm,
} from '@/components/giga-panel/user360/point-b/scenariosController'
import { parseScenarios } from '@/components/point-b/overviewModel'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => React.createElement('a', { href: p.href }, p.children) }))

const { ScenariosPanelView } = await import('@/components/giga-panel/user360/point-b/ScenariosPanel')
const { PlanPanelView } = await import('@/components/giga-panel/user360/point-b/PlanPanel')

type ViewProps = React.ComponentProps<typeof ScenariosPanelView>

const USER = 'cccccccc-0000-4000-8000-000000000001'
const VERSION = 'v-1'
const URL = `/api/giga-admin/users/${USER}/point-b/plan/versions/${VERSION}/scenarios`

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
  return { ctl: new ScenariosController(USER, fetchFn as unknown as typeof fetch), calls }
}

const result = (): ModelResult => fixtureModelResult('full')
const computed = (model = result()): Reply => ({ status: 200, body: { ok: true, data: { result: model } } })

const baseView = (over: Partial<ViewProps> = {}): ViewProps => ({
  versionNumber: 3,
  editable: true,
  scenarios: [],
  model: null,
  selected: null,
  busy: null,
  error: null,
  notice: null,
  forms: DEFAULT_PROFILES.map(profileToForm),
  formErrors: {},
  fromSaved: false,
  onField: () => undefined,
  onMix: () => undefined,
  onNormalize: () => undefined,
  onResetForms: () => undefined,
  onCompute: () => undefined,
  onSelect: () => undefined,
  ...over,
})

const html = (props: Partial<ViewProps> = {}) => renderToStaticMarkup(React.createElement(ScenariosPanelView, baseView(props))).replace(/[  ]/g, ' ')

describe('ScenariosController', () => {
  it('recompute posts the profiles and keeps the three results', async () => {
    const { ctl, calls } = harness([computed()])
    const profiles: ScenarioProfile[] = DEFAULT_PROFILES
    expect(await ctl.compute(VERSION, profiles)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'POST', url: URL })
    expect((calls[0].body as { profiles: ScenarioProfile[] }).profiles).toHaveLength(3)
    const snap = ctl.getSnapshot()
    expect(snap.busy).toBeNull()
    expect(snap.result?.versionId).toBe(VERSION)
    expect(snap.result?.model.scenarios.map((s) => s.key)).toEqual(['cautious', 'moderate', 'aggressive'])
    // and the markup shows the three results of that calculation
    const out = html({ scenarios: snap.result!.model.scenarios, model: snap.result!.model, notice: snap.notice })
    for (const label of ['Осторожный', 'Умеренный', 'Ускоренный']) expect(out).toContain(label)
    expect(out).toContain('Срок выхода на цель')
    expect(out).toContain('Выручка к сроку цели')
    expect(out).toContain('Потребность в персонале')
    expect(out).toContain('Прирост рычагов')
    expect(out.match(/Не достижим/g)).toHaveLength(2) // the header badge and the «Реализуемость» row of one scenario
    expect(out).toContain('Сценарии рассчитаны и сохранены в черновике')
  })

  it('without edits sends no profiles so the server uses the template defaults', async () => {
    const { ctl, calls } = harness([computed()])
    await ctl.compute(VERSION)
    expect(calls[0].body).toEqual({})
  })

  it('select pace sends selectedScenario (and null clears it); an unknown key never reaches the server', async () => {
    const { ctl, calls } = harness([])
    expect(await ctl.select(VERSION, 'moderate')).toBe(true)
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: URL, body: { selectedScenario: 'moderate' } })
    expect(ctl.getSnapshot().selected).toEqual({ versionId: VERSION, key: 'moderate' })
    expect(await ctl.select(VERSION, null)).toBe(true)
    expect(calls[1].body).toEqual({ selectedScenario: null })
    expect(await ctl.select(VERSION, 'wild' as never)).toBe(false)
    expect(calls).toHaveLength(2)
    expect(ctl.getSnapshot().error?.message).toBe('Выберите один из трёх темпов')
  })

  it('server 400 and 409 messages are kept and shown as they are; defaults cover an empty body', async () => {
    const bad = harness([{ status: 400, body: { ok: false, error: 'rampMonths: от 1 до 36' } }])
    expect(await bad.ctl.compute(VERSION, DEFAULT_PROFILES)).toBe(false)
    expect(bad.ctl.getSnapshot().error).toEqual({ message: 'rampMonths: от 1 до 36', status: 400 })
    expect(html({ error: bad.ctl.getSnapshot().error })).toContain('rampMonths: от 1 до 36')

    const conflict = harness([{ status: 409, body: { ok: false, error: 'Версию нельзя менять: она не черновик' } }])
    await conflict.ctl.compute(VERSION)
    expect(conflict.ctl.getSnapshot().error?.message).toBe('Версию нельзя менять: она не черновик')

    const empty = harness([{ status: 409, body: null }, { status: 403, body: null }])
    await empty.ctl.compute(VERSION)
    expect(empty.ctl.getSnapshot().error?.message).toContain('только в черновике')
    await empty.ctl.select(VERSION, 'cautious')
    expect(empty.ctl.getSnapshot().error?.message).toContain('Недостаточно прав')
  })

  it('a network failure and an unreadable answer are explained, not swallowed', async () => {
    const down = new ScenariosController(USER, (async () => { throw new Error('offline') }) as unknown as typeof fetch)
    expect(await down.compute(VERSION)).toBe(false)
    expect(down.getSnapshot().error?.message).toContain('Нет связи')
    const odd = harness([{ status: 200, body: { ok: true, data: { result: { nonsense: true } } } }])
    expect(await odd.ctl.compute(VERSION)).toBe(false)
    expect(odd.ctl.getSnapshot().error?.message).toContain('не удалось прочитать')
  })

  it('does not start a second request while one is running', async () => {
    let release: (() => void) | null = null
    const slow = vi.fn(() => new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: async () => computed().body }) }))
    const ctl = new ScenariosController(USER, slow as unknown as typeof fetch)
    const first = ctl.compute(VERSION)
    expect(ctl.getSnapshot().busy).toBe('compute')
    expect(await ctl.compute(VERSION)).toBe(false)
    expect(await ctl.select(VERSION, 'cautious')).toBe(false)
    expect(slow).toHaveBeenCalledTimes(1)
    release!()
    expect(await first).toBe(true)
  })
})

describe('profile form', () => {
  const form = (over: Partial<ProfileForm> = {}): ProfileForm => ({ ...profileToForm(DEFAULT_PROFILES[1]), ...over })

  it('validates the ranges of plan Task 5 with a message per field', () => {
    expect(validateProfileForm(form()).ok).toBe(true)
    const r = validateProfileForm(form({ rampMonths: '0', reserveMonths: '13', growthCapPct: '4', productivityGainPct: '51' }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.rampMonths).toContain('от 1 до 36')
      expect(r.errors.reserveMonths).toContain('от 0 до 12')
      expect(r.errors.growthCapPct).toContain('от 5 до 300')
      expect(r.errors.productivityGainPct).toContain('от 0 до 50')
    }
    expect(validateProfileForm(form({ rampMonths: '40' })).ok).toBe(false)
    expect(validateProfileForm(form({ rampMonths: '' })).ok).toBe(false)
    expect(validateProfileForm(form({ rampMonths: 'abc' })).ok).toBe(false)
    expect(validateProfileForm(form({ rampMonths: '36', reserveMonths: '0', growthCapPct: '300', productivityGainPct: '50' })).ok).toBe(true)
    // a decimal comma is a number
    const comma = validateProfileForm(form({ growthCapPct: '37,5' }))
    expect(comma.ok && comma.profile.growthCapAnnual).toBe(0.375)
  })

  it('normalises the lever mix to exactly 100% and sends fractions', () => {
    const norm = normalizeMixPercent({ leads: '10', conversion: '10', avgCheck: '10', repeat: '10' })!
    expect(norm).toEqual({ leads: 25, conversion: 25, avgCheck: 25, repeat: 25 })
    const odd = normalizeMixPercent({ leads: '1', conversion: '1', avgCheck: '1', repeat: '0' })!
    expect(Object.values(odd).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6)
    const ok = validateProfileForm(form({ mix: { leads: '50', conversion: '30', avgCheck: '10', repeat: '30' } }))
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      const m = ok.profile.leverMix
      expect(m.leads + m.conversion + m.avgCheck + m.repeat).toBeCloseTo(1, 6)
      expect(m.leads).toBeCloseTo(50 / 120, 2)
    }
    expect(mixSum(form({ mix: { leads: '50', conversion: '30', avgCheck: '10', repeat: '30' } }).mix)).toBe(120)
    const fixed = normalizeForm(form({ mix: { leads: '50', conversion: '30', avgCheck: '10', repeat: '30' } }))
    expect(mixSum(fixed.mix)).toBeCloseTo(100, 6)
    // nothing to normalise: all zero, negative or not a number
    expect(normalizeMixPercent({ leads: '0', conversion: '0', avgCheck: '0', repeat: '0' })).toBeNull()
    expect(normalizeMixPercent({ leads: '-5', conversion: '10', avgCheck: '10', repeat: '10' })).toBeNull()
    const bad = validateProfileForm(form({ mix: { leads: 'x', conversion: '10', avgCheck: '10', repeat: '10' } }))
    expect(bad.ok === false && bad.errors.mix).toBeTruthy()
  })

  it('validates all three forms at once and reports which one is wrong', () => {
    const forms = DEFAULT_PROFILES.map(profileToForm)
    expect(validateForms(forms).ok).toBe(true)
    forms[2] = { ...forms[2], rampMonths: '99' }
    const r = validateForms(forms)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(['aggressive'])
  })

  it('round-trips the saved profiles of a draft, and falls back to the defaults for anything broken', () => {
    expect(parseProfiles(DEFAULT_PROFILES)).toEqual(DEFAULT_PROFILES)
    expect(parseProfiles(null)).toBeNull()
    expect(parseProfiles([DEFAULT_PROFILES[0]])).toBeNull()
    expect(parseProfiles(DEFAULT_PROFILES.map((p) => ({ ...p, rampMonths: 'x' })))).toBeNull()
    expect(parseScenarios([{ key: 'nope' }])).toEqual([])
  })

  it('the form shows the field errors and the sum of the shares', () => {
    const forms = DEFAULT_PROFILES.map(profileToForm)
    forms[0] = { ...forms[0], mix: { leads: '50', conversion: '30', avgCheck: '10', repeat: '30' }, rampMonths: '0' }
    const checked = validateForms(forms)
    const out = html({ forms, formErrors: checked.ok ? {} : checked.errors })
    expect(out).toContain('Срок выхода: от 1 до 36 мес.')
    expect(out).toContain('Сумма долей: 120%')
    expect(out).toContain('Привести к 100%')
    expect(out).toContain('aria-invalid="true"')
    expect(out).toContain('role="alert"')
    // every input has a label
    expect(out.match(/<input/g)!.length).toBe(out.match(/<label[^>]*for=/g)!.length)
  })
})

describe('ScenariosPanelView', () => {
  const model = result()

  it('a draft offers the calculation, the profile form and the choice of a pace', () => {
    const out = html({ scenarios: model.scenarios, model, selected: 'moderate' })
    expect(out).toContain('Рассчитать сценарии')
    expect(out).toContain('Настроить темп сценариев')
    expect(out.match(/Выбрать темп для плана/g)).toHaveLength(2) // all but the chosen one
    expect(out).toContain('Снять выбор')
    expect(out).toContain('Выбран')
    expect(html()).toContain('Сценарии ещё не рассчитаны')
  })

  it('is read-only for versions in review and approved: results shown, no buttons, no form', () => {
    const out = html({ editable: false, scenarios: model.scenarios, selected: 'moderate' })
    expect(out).toContain('Только чтение')
    expect(out).toContain('Умеренный')
    expect(out).not.toContain('Рассчитать сценарии')
    expect(out).not.toContain('Выбрать темп для плана')
    expect(out).not.toContain('Снять выбор')
    expect(out).not.toContain('Настроить темп')
    expect(out).not.toContain('<input')
    expect(html({ editable: false })).toContain('В этой версии сценарии не рассчитаны')
  })

  it('lists the warnings and the missing inputs of the calculation', () => {
    const withGaps: ModelResult = { ...fixtureModelResult('stale-base') }
    const out = html({ scenarios: withGaps.scenarios, model: withGaps })
    expect(out).toContain('Предупреждения расчёта')
    expect(out).toContain('Выручка за 2024 год')
    expect(out).toContain('Каких данных не хватает')
    expect(out).toContain('Заявки в месяц')
    expect(out).toContain('откроет: расчёт по воронке')
    expect(out).toContain('заполнить в анкете')
    // no gaps, no boxes
    expect(html({ scenarios: model.scenarios, model: { ...model, missing: [], warnings: [] } })).not.toContain('Предупреждения расчёта')
  })

  it('busy state: the calculate button is loading and the others are disabled', () => {
    const out = html({ scenarios: model.scenarios, busy: 'compute' })
    expect(out).toContain('animate-spin')
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>(<svg[\s\S]*?<\/svg>)?Выбрать темп/)
  })
})

describe('PlanPanel embeds the scenarios of the open version', () => {
  const version = (status: PlanVersionStatus): PlanVersionRow => ({
    id: VERSION, plan_id: 'p-1', version: 3, status, base_snapshot_id: null, goals: { primary: null, items: [] }, assumptions: {}, scenarios: [], selected_scenario: null,
    strategy: {}, risks: [], expert_notes: 'Заметки', change_reason: 'Причина', author_id: 'e-1', author_name: 'Анна Ким', author_kind: 'expert',
    submitted_at: null, approved_by: null, approved_at: null, approval_exception: null, rejected_by: null, rejected_at: null, rejected_reason: null, created_at: '2026-10-09T09:00:00Z',
  })
  const snapOf = (open: PlanVersionRow | null): Parameters<typeof PlanPanelView>[0]['snap'] => ({
    phase: 'ready', loadError: null, busy: null, error: null, exception: null, notice: null, scope: 'plan',
    plan: { versions: open ? [open] : [], open, published: null, goals: { primary: null, items: [] }, canApprove: false },
  })
  const noop = () => undefined
  const panel = (open: PlanVersionRow | null, scenarios?: React.ReactNode) => renderToStaticMarkup(React.createElement(PlanPanelView, {
    snap: snapOf(open), notes: '', reason: '', onNotes: noop, onReason: noop, onCreate: noop, onSave: noop, onSubmit: noop, onAskApprove: noop, onAskReject: noop, onRetry: noop,
    approveTarget: null, onApproveClose: noop, onApproveConfirm: noop, rejectTarget: null, rejectText: '', onRejectText: noop, onRejectClose: noop, onRejectConfirm: noop,
    exceptionText: '', onExceptionText: noop, onExceptionClose: noop, onExceptionConfirm: noop, scenarios,
  }))

  it('shows the slot for an open version and not when there is none', () => {
    const slot = React.createElement('p', null, 'СЛОТ СЦЕНАРИЕВ')
    expect(panel(version('draft'), slot)).toContain('СЛОТ СЦЕНАРИЕВ')
    expect(panel(version('in_review'), slot)).toContain('СЛОТ СЦЕНАРИЕВ')
    expect(panel(null, slot)).not.toContain('СЛОТ СЦЕНАРИЕВ')
    expect(panel(version('draft'))).not.toContain('СЛОТ СЦЕНАРИЕВ')
  })
})
