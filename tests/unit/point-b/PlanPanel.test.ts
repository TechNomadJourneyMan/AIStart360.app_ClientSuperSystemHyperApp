/**
 * Expert / admin plan UI (plan Phase 1 Task 9). The repo has neither jsdom nor Testing
 * Library, so — as for the pop-up layer — the behaviour lives in a framework-free
 * controller (components/giga-panel/user360/point-b/planController.ts) driven here with a
 * fetch double, and the markup (statuses, role-dependent buttons, dialogs, highlighted
 * fields) is checked with react-dom/server. The routes of plan Task 6 are not built yet:
 * everything is tested against the contract written in the plan (see the controller header).
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GoalReviewStatus, PlanGoalsSnapshot, PlanVersionRow, PlanVersionStatus } from '@/lib/point-b/plan/types'
import { REASON_NO_CHANGE_REASON, REASON_PRIMARY_NOT_VERIFIED } from '@/lib/point-b/plan/status'
import {
  PlanController, offersException, parsePlanState, validateException, validateRejectReason, versionActions,
  type PlanSnapshot,
} from '@/components/giga-panel/user360/point-b/planController'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => React.createElement('a', { href: p.href }, p.children) }))

const { PlanPanelView } = await import('@/components/giga-panel/user360/point-b/PlanPanel')
const { GoalReviewPanelView } = await import('@/components/giga-panel/user360/point-b/GoalReviewPanel')

const USER = 'cccccccc-0000-4000-8000-000000000001'
const REVENUE = 'biz.finansy.vyruchka_god'

const goals = (status: GoalReviewStatus = 'owner_draft'): PlanGoalsSnapshot => ({
  primary: { metricKey: REVENUE, periodLabel: '12m' },
  items: [{ metricKey: REVENUE, periodLabel: '12m', label: 'Выручка за 12 месяцев', baselineValue: 60_000_000, baselinePeriod: '2024', targetValue: 120_000_000, deadline: '2027-06-30', reviewStatus: status }],
})

const version = (n: number, status: PlanVersionStatus, over: Partial<PlanVersionRow> = {}): PlanVersionRow => ({
  id: `v-${n}`, plan_id: 'p-1', version: n, status, base_snapshot_id: null, goals: goals('verified'), assumptions: {}, scenarios: [], selected_scenario: null,
  strategy: {}, risks: [], expert_notes: `Заметки версии ${n}`, change_reason: `Причина ${n}`, author_id: 'e-1', author_name: 'Анна Ким', author_kind: 'expert',
  submitted_at: '2026-10-10T09:00:00Z', approved_by: null, approved_at: null, approval_exception: null, rejected_by: null, rejected_at: null, rejected_reason: null,
  created_at: '2026-10-09T09:00:00Z', ...over,
})

type Reply = { status: number; body: unknown }
interface Call { method: string; url: string; body: unknown }

/** A fetch double: GET plan is served from `state.plan`; mutations answer from `state.replies` (queue per method+url suffix). */
function harness(plan: unknown, replies: Array<[RegExp, Reply]> = []) {
  const calls: Call[] = []
  const state = { plan, replies: [...replies] }
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET') return { ok: true, status: 200, json: async () => state.plan }
    const i = state.replies.findIndex(([re]) => re.test(`${method} ${url}`))
    const [, r] = i >= 0 ? state.replies.splice(i, 1)[0] : [null, { status: 200, body: { ok: true } } as Reply]
    return { ok: r.status < 400, status: r.status, json: async () => r.body }
  })
  const ctl = new PlanController(USER, fetchFn as unknown as typeof fetch)
  return { ctl, calls, state, writes: () => calls.filter((c) => c.method !== 'GET') }
}

const planBody = (versions: PlanVersionRow[], canApprove: boolean, g: PlanGoalsSnapshot = goals('verified')) => ({
  ok: true,
  data: {
    plan: { id: 'p-1' }, versions,
    open: versions.find((v) => v.status === 'draft' || v.status === 'in_review') ?? null,
    published: versions.find((v) => v.status === 'approved') ?? null,
    goals: g, canApprove,
  },
})

const noop = () => {}
function view(snap: PlanSnapshot, over: Partial<React.ComponentProps<typeof PlanPanelView>> = {}) {
  return renderToStaticMarkup(React.createElement(PlanPanelView, {
    snap, notes: snap.plan?.open?.expert_notes ?? '', reason: snap.plan?.open?.change_reason ?? '', onNotes: noop, onReason: noop, onCreate: noop, onSave: noop,
    onSubmit: noop, onAskApprove: noop, onAskReject: noop, onRetry: noop,
    approveTarget: null, onApproveClose: noop, onApproveConfirm: noop,
    rejectTarget: null, rejectText: '', onRejectText: noop, onRejectClose: noop, onRejectConfirm: noop,
    exceptionText: '', onExceptionText: noop, onExceptionClose: noop, onExceptionConfirm: noop,
    ...over,
  }))
}

describe('statuses and role-dependent actions', () => {
  const versions = [version(2, 'in_review'), version(1, 'approved', { approved_at: '2026-10-01T09:00:00Z' })]

  it('shows version statuses and only the actions allowed for the role', async () => {
    const { ctl } = harness(planBody(versions, false))
    await ctl.load()
    const html = view(ctl.getSnapshot())
    expect(html).toContain('Версия 2')
    expect(html).toContain('На проверке')
    expect(html).toContain('Одобрена')
    expect(html).toContain('Ждёт одобрения Admin или Super Admin')
    expect(html).not.toContain('Вернуть с комментарием')
    expect(html).not.toContain('Редактор черновика')

    expect(versionActions('draft', false)).toEqual({ edit: true, submit: true, approve: false, reject: false })
    expect(versionActions('approved', true)).toEqual({ edit: false, submit: false, approve: false, reject: false })
    expect(versionActions('superseded', true).approve).toBe(false)
  })

  it('the Заменена and Черновик badges exist, and a returned draft shows the reason', async () => {
    const { ctl } = harness(planBody([
      version(3, 'draft', { rejected_reason: 'Уточните срок цели' }),
      version(2, 'superseded'),
      version(1, 'approved'),
    ], false))
    await ctl.load()
    const html = view(ctl.getSnapshot())
    expect(html).toContain('Заменена')
    expect(html).toContain('Черновик')
    expect(html).toContain('Возвращена на доработку: Уточните срок цели')
    expect(html).toContain('Редактор черновика')
    expect(html).toContain('Отправить на одобрение')
  })

  it('expert cannot see Approve; approver can', async () => {
    const expert = harness(planBody(versions, false))
    await expert.ctl.load()
    expect(view(expert.ctl.getSnapshot())).not.toContain('>Одобрить<')

    const admin = harness(planBody(versions, true))
    await admin.ctl.load()
    const html = view(admin.ctl.getSnapshot())
    expect(html).toContain('Одобрить')
    expect(html).toContain('Вернуть с комментарием')
    expect(html).not.toContain('Ждёт одобрения Admin')
  })

  it('a client without a plan is an empty state with a create button, not an error', async () => {
    const { ctl } = harness({ ok: true, data: { plan: null, versions: [], open: null, published: null, goals: { primary: null, items: [] }, canApprove: false } })
    await ctl.load()
    const snap = ctl.getSnapshot()
    expect(snap.phase).toBe('ready')
    const html = view(snap)
    expect(html).toContain('Плана ещё нет')
    expect(html).toContain('Создать черновик')
  })

  it('parsePlanState tolerates a missing body', () => {
    expect(parsePlanState(null)).toMatchObject({ versions: [], open: null, published: null, canApprove: false })
    const s = parsePlanState({ data: { versions: [version(1, 'approved'), version(2, 'draft')], canApprove: true } })
    expect(s.open?.version).toBe(2)
    expect(s.published?.version).toBe(1)
    expect(s.versions.map((v) => v.version)).toEqual([2, 1])
  })

  it('a failed load shows the server text with a retry', async () => {
    const calls: string[] = []
    const ctl = new PlanController(USER, (async (url: string) => {
      calls.push(url)
      return { ok: false, status: 403, json: async () => ({ ok: false, error: 'Недостаточно прав' }) }
    }) as unknown as typeof fetch)
    await ctl.load()
    expect(ctl.getSnapshot()).toMatchObject({ phase: 'error', loadError: 'Недостаточно прав' })
    expect(view(ctl.getSnapshot())).toContain('Недостаточно прав')
  })
})

describe('draft workflow requests', () => {
  it('create → PATCH → submit go to the plan routes with camelCase bodies, reloading after each', async () => {
    const t = harness(planBody([version(1, 'draft')], false))
    await t.ctl.load()
    await t.ctl.createDraft()
    await t.ctl.saveDraft('v-1', { expertNotes: '  Фокус на конверсии ', changeReason: 'Цель подтверждена' })
    await t.ctl.submitDraft('v-1', { expertNotes: 'Фокус на конверсии', changeReason: 'Цель подтверждена' })
    const base = `/api/giga-admin/users/${USER}/point-b/plan`
    expect(t.writes().map((c) => [c.method, c.url])).toEqual([
      ['POST', `${base}/versions`],
      ['PATCH', `${base}/versions/v-1`],
      ['PATCH', `${base}/versions/v-1`],
      ['POST', `${base}/versions/v-1/submit`],
    ])
    expect(t.writes()[1].body).toEqual({ expertNotes: 'Фокус на конверсии', changeReason: 'Цель подтверждена' })
    expect(t.calls.filter((c) => c.method === 'GET').length).toBe(4) // load + reload after create, save, submit
    expect(t.ctl.getSnapshot().notice).toBe('Версия отправлена на одобрение')
  })

  it('submit does not go on when saving the draft failed', async () => {
    const t = harness(planBody([version(1, 'draft')], false), [[/PATCH/, { status: 409, body: { ok: false, error: 'Версия уже не черновик' } }]])
    await t.ctl.load()
    expect(await t.ctl.submitDraft('v-1', { expertNotes: 'x', changeReason: 'y' })).toBe(false)
    expect(t.writes().map((c) => c.method)).toEqual(['PATCH'])
    expect(t.ctl.getSnapshot().error?.message).toBe('Версия уже не черновик')
  })

  it('server error text is displayed', async () => {
    const t = harness(planBody([version(1, 'draft')], false), [[/POST .*\/versions$/, { status: 409, body: { ok: false, error: 'Уже есть открытая версия плана' } }]])
    await t.ctl.load()
    expect(await t.ctl.createDraft()).toBe(false)
    expect(t.ctl.getSnapshot().error).toMatchObject({ message: 'Уже есть открытая версия плана', status: 409 })
    expect(view(t.ctl.getSnapshot())).toContain('Уже есть открытая версия плана')
  })

  it('a network failure says so instead of failing silently', async () => {
    const ctl = new PlanController(USER, (async (_u: string, init?: RequestInit) => {
      if (!init?.method) return { ok: true, status: 200, json: async () => planBody([version(1, 'draft')], false) }
      throw new Error('offline')
    }) as unknown as typeof fetch)
    await ctl.load()
    await ctl.createDraft()
    expect(ctl.getSnapshot().error?.message).toContain('Нет связи с сервером')
  })

  it('profanity 400 highlights the field', async () => {
    const t = harness(planBody([version(1, 'draft')], false), [[/PATCH/, { status: 400, body: { ok: false, error: 'Уберите нецензурные слова', code: 'profanity', field: 'expert_notes' } }]])
    await t.ctl.load()
    await t.ctl.saveDraft('v-1', { expertNotes: 'плохо', changeReason: 'ок' })
    const snap = t.ctl.getSnapshot()
    expect(snap.error).toMatchObject({ field: 'expertNotes', message: 'Уберите нецензурные слова' })
    const html = view(snap)
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"[^>]*>/)
    expect(html).toContain('Уберите нецензурные слова')
    // the other field stays valid
    expect(html.match(/aria-invalid="true"/g)?.length).toBe(1)
  })
})

describe('approval, conditions and the exception', () => {
  const inReview = planBody([version(2, 'in_review', { goals: goals('owner_draft') })], true, goals('owner_draft'))

  it('approve with failing conditions shows the reasons and offers the exception dialog requiring 10+ chars', async () => {
    const t = harness(inReview, [[/approve/, { status: 409, body: { ok: false, error: 'Условия одобрения не выполнены', reasons: [REASON_PRIMARY_NOT_VERIFIED] } }]])
    await t.ctl.load()
    expect(await t.ctl.approve('v-2')).toBe(false)
    const snap = t.ctl.getSnapshot()
    expect(snap.exception).toMatchObject({ versionId: 'v-2', reasons: [REASON_PRIMARY_NOT_VERIFIED] })
    expect(t.writes()[0].body).toEqual({})

    const html = view(snap)
    expect(html).toContain('Условия одобрения не выполнены')
    expect(html).toContain(REASON_PRIMARY_NOT_VERIFIED)
    expect(html).toContain('Одобрить по исключению')
    expect(html).toContain('не короче 10 символов')
  })

  it('a short exception reason is refused locally, a long one is sent and approves', async () => {
    const t = harness(inReview, [[/approve/, { status: 409, body: { ok: false, error: 'Условия одобрения не выполнены', reasons: [REASON_PRIMARY_NOT_VERIFIED] } }]])
    await t.ctl.load()
    await t.ctl.approve('v-2')
    const before = t.writes().length

    expect(await t.ctl.approve('v-2', 'коротко')).toBe(false)
    expect(t.writes().length).toBe(before) // no request
    expect(t.ctl.getSnapshot().exception?.error?.message).toContain('не короче 10 символов')
    expect(validateException('123456789')).not.toBeNull()
    expect(validateException(' 1234567890 ')).toBeNull()

    expect(await t.ctl.approve('v-2', 'Клиент в отпуске, цель согласована устно')).toBe(true)
    expect(t.writes()[t.writes().length - 1].body).toEqual({ exceptionReason: 'Клиент в отпуске, цель согласована устно' })
    const snap = t.ctl.getSnapshot()
    expect(snap.exception).toBeNull()
    expect(snap.notice).toContain('Версия одобрена')
  })

  it('the server rejecting the exception reason keeps the dialog open with its text', async () => {
    const t = harness(inReview, [
      [/approve/, { status: 409, body: { ok: false, error: 'Условия', reasons: [REASON_PRIMARY_NOT_VERIFIED] } }],
      [/approve/, { status: 403, body: { ok: false, error: 'Исключение может сделать только Admin' } }],
    ])
    await t.ctl.load()
    await t.ctl.approve('v-2')
    await t.ctl.approve('v-2', 'Достаточно длинная причина')
    expect(t.ctl.getSnapshot().exception?.error?.message).toBe('Исключение может сделать только Admin')
  })

  it('a missing change reason cannot be waived: reasons are shown, no exception dialog', async () => {
    expect(offersException([REASON_NO_CHANGE_REASON])).toBe(false)
    expect(offersException([REASON_PRIMARY_NOT_VERIFIED, REASON_NO_CHANGE_REASON])).toBe(false)
    expect(offersException([REASON_PRIMARY_NOT_VERIFIED])).toBe(true)

    const t = harness(inReview, [[/approve/, { status: 409, body: { ok: false, error: 'Условия', reasons: [REASON_NO_CHANGE_REASON] } }]])
    await t.ctl.load()
    await t.ctl.approve('v-2')
    const snap = t.ctl.getSnapshot()
    expect(snap.exception).toBeNull()
    expect(view(snap)).toContain(REASON_NO_CHANGE_REASON)
  })

  it('a second approver losing the race sees the server 409 text', async () => {
    const t = harness(inReview, [[/approve/, { status: 409, body: { ok: false, error: 'Версию уже одобрил другой сотрудник' } }]])
    await t.ctl.load()
    await t.ctl.approve('v-2')
    expect(t.ctl.getSnapshot().error?.message).toBe('Версию уже одобрил другой сотрудник')
    expect(t.ctl.getSnapshot().exception).toBeNull()
  })

  it('reject needs 5+ characters (no request otherwise) and sends { reason }', async () => {
    const t = harness(inReview, [])
    await t.ctl.load()
    expect(validateRejectReason('1234')).not.toBeNull()
    expect(await t.ctl.reject('v-2', 'нет')).toBe(false)
    expect(t.writes()).toHaveLength(0)
    expect(t.ctl.getSnapshot().error).toMatchObject({ field: 'reason' })

    expect(await t.ctl.reject('v-2', ' Уточните срок цели ')).toBe(true)
    expect(t.writes()[0]).toMatchObject({ method: 'POST', url: `/api/giga-admin/users/${USER}/point-b/plan/versions/v-2/reject`, body: { reason: 'Уточните срок цели' } })
  })

  it('only one action runs at a time', async () => {
    const t = harness(inReview, [])
    await t.ctl.load()
    const first = t.ctl.approve('v-2')
    const second = await t.ctl.approve('v-2')
    await first
    expect(second).toBe(false)
    expect(t.writes()).toHaveLength(1)
  })
})

describe('goal verification', () => {
  const goalView = (snap: PlanSnapshot, forms = {}) => renderToStaticMarkup(React.createElement(GoalReviewPanelView, {
    snap, forms, onVerify: noop, onOpen: noop, onChange: noop, onCancel: noop, onSubmit: noop,
  }))

  it('shows each goal with its status, the primary mark and the verify / correct actions', async () => {
    const t = harness(planBody([version(1, 'draft')], false, goals('owner_draft')))
    await t.ctl.load()
    const html = goalView(t.ctl.getSnapshot())
    expect(html).toContain('Выручка за 12 месяцев')
    expect(html).toContain('Главная цель')
    expect(html).toContain('Ждёт проверки')
    expect(html).toContain('Подтвердить')
    expect(html).toContain('Исправить')
  })

  it('goal correction form posts value, deadline and reason and shows «ждёт согласия владельца»', async () => {
    const t = harness(planBody([version(1, 'draft')], false, goals('owner_draft')))
    await t.ctl.load()
    t.state.plan = planBody([version(1, 'draft')], false, goals('corrected'))
    const ok = await t.ctl.reviewGoal({ metricKey: REVENUE, periodLabel: '12m', action: 'correct', value: 90_000_000, deadline: '2027-09-30', reason: 'Цель нереалистична при текущей конверсии' })
    expect(ok).toBe(true)
    expect(t.writes()[0]).toEqual({
      method: 'POST',
      url: `/api/giga-admin/users/${USER}/point-b/plan/goals/${encodeURIComponent(REVENUE)}/review`,
      body: { periodLabel: '12m', action: 'correct', value: 90_000_000, deadline: '2027-09-30', reason: 'Цель нереалистична при текущей конверсии' },
    })
    const snap = t.ctl.getSnapshot()
    expect(snap.notice).toContain('ждёт его согласия')
    const html = goalView(snap)
    expect(html).toContain('Ждёт согласия владельца')
    expect(html).toContain('Предложение отправлено владельцу')
    expect(html).toContain('Исправление отправлено владельцу и ждёт его согласия')
  })

  it('verify posts only the period and the action', async () => {
    const t = harness(planBody([version(1, 'draft')], false, goals('owner_draft')))
    await t.ctl.load()
    await t.ctl.reviewGoal({ metricKey: REVENUE, periodLabel: '12m', action: 'verify' })
    expect(t.writes()[0].body).toEqual({ periodLabel: '12m', action: 'verify' })
  })

  it('a correction without a value or a reason is refused locally and highlights the field', async () => {
    const t = harness(planBody([version(1, 'draft')], false, goals('owner_draft')))
    await t.ctl.load()
    expect(await t.ctl.reviewGoal({ metricKey: REVENUE, periodLabel: '12m', action: 'correct', value: Number.NaN, reason: 'x' })).toBe(false)
    expect(await t.ctl.reviewGoal({ metricKey: REVENUE, periodLabel: '12m', action: 'correct', value: 5, reason: '  ' })).toBe(false)
    expect(t.writes()).toHaveLength(0)
    const snap = t.ctl.getSnapshot()
    expect(snap.error?.field).toBe('reason')
    const html = goalView(snap, { [`${REVENUE}|12m`]: { value: '5', deadline: '', reason: '' } })
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"/)
    expect(html).toContain('Объясните владельцу')
  })

  it('profanity in the reason highlights the reason field with the server text', async () => {
    const t = harness(planBody([version(1, 'draft')], false, goals('owner_draft')), [[/review/, { status: 400, body: { ok: false, error: 'Уберите нецензурные слова', code: 'profanity', field: 'reason' } }]])
    await t.ctl.load()
    await t.ctl.reviewGoal({ metricKey: REVENUE, periodLabel: '12m', action: 'correct', value: 5, reason: 'плохо' })
    const html = goalView(t.ctl.getSnapshot(), { [`${REVENUE}|12m`]: { value: '5', deadline: '', reason: 'плохо' } })
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"/)
    expect(html).toContain('Уберите нецензурные слова')
  })

  it('shows disputed and agreed statuses, and an empty state when the owner has no goals', async () => {
    const d = harness(planBody([version(1, 'draft')], false, goals('disputed')))
    await d.ctl.load()
    expect(goalView(d.ctl.getSnapshot())).toContain('Оспорена владельцем')
    const a = harness(planBody([version(1, 'draft')], false, goals('agreed')))
    await a.ctl.load()
    expect(goalView(a.ctl.getSnapshot())).toContain('Согласована владельцем')

    const e = harness(planBody([], false, { primary: null, items: [] }))
    await e.ctl.load()
    expect(goalView(e.ctl.getSnapshot())).toContain('Целей пока нет')
  })

  it('goal and plan notices stay in their own panel', async () => {
    const t = harness(planBody([version(1, 'draft')], false, goals('owner_draft')))
    await t.ctl.load()
    await t.ctl.reviewGoal({ metricKey: REVENUE, periodLabel: '12m', action: 'verify' })
    const snap = t.ctl.getSnapshot()
    expect(goalView(snap)).toContain('Цель подтверждена')
    expect(view(snap)).not.toContain('Цель подтверждена')
  })
})
