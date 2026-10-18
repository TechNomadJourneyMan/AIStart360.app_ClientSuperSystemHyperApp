/**
 * GIGA / expert routes of the Point B plan (plan Phase 1 Task 6): plan, versions, approval, goal
 * verification, the approval queue — and the three legacy «save an expert correction» routes that
 * now write plan versions instead of point_b_versions. In-memory DB, real store / goals / routes;
 * the notifications are spies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { pbDb } from './_pbdb'

const REVENUE = 'biz.finansy.vyruchka_god'
const CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const OTHER_CLIENT = 'cccccccc-0000-4000-8000-000000000002'
const EXPERT = 'eeeeeeee-0000-4000-8000-000000000001'
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const COMPANY = 'company-1'
const OTHER_COMPANY = 'company-2'

const s = vi.hoisted(() => ({
  h: null as ReturnType<typeof import('./_pbdb').pbDb> | null,
  actor: { id: 'x', role: 'super_expert' as StaffRole, scope: 'all' as 'all' | 'assigned' },
  expert: { ok: true, viewer: { id: 'x', role: 'expert', email: 'e@example.com' } } as Record<string, unknown>,
  audits: [] as Array<{ action: string; entityId?: string | null; metadata?: Record<string, unknown>; targetUserId?: string | null }>,
  notify: {
    submitted: vi.fn(async (..._a: unknown[]) => undefined),
    approved: vi.fn(async (..._a: unknown[]) => undefined),
    correction: vi.fn(async (..._a: unknown[]) => undefined),
    needsReview: vi.fn(async (..._a: unknown[]) => undefined),
    responded: vi.fn(async (..._a: unknown[]) => undefined),
  },
}))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.h!.sb }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_actor: unknown, entry: { action: string; entityId?: string | null; metadata?: Record<string, unknown>; targetUserId?: string | null }) => { s.audits.push(entry); return true },
}))
vi.mock('@/lib/point-b/plan/notify', () => ({
  notifyPlanSubmitted: (...a: unknown[]) => (s.notify.submitted as (...x: unknown[]) => Promise<void>)(...a),
  notifyPlanApproved: (...a: unknown[]) => (s.notify.approved as (...x: unknown[]) => Promise<void>)(...a),
  notifyGoalCorrection: (...a: unknown[]) => (s.notify.correction as (...x: unknown[]) => Promise<void>)(...a),
  notifyGoalNeedsReview: (...a: unknown[]) => (s.notify.needsReview as (...x: unknown[]) => Promise<void>)(...a),
  notifyGoalResponded: (...a: unknown[]) => (s.notify.responded as (...x: unknown[]) => Promise<void>)(...a),
}))
vi.mock('@/lib/expert-auth', async (orig) => ({ ...(await orig<typeof import('@/lib/expert-auth')>()), resolveExpert: async () => s.expert }))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const inner = makeRequireGiga(() => ({ id: s.actor.id, kind: 'session', role: s.actor.role }))
  return {
    requireGiga: async (req: unknown, p: Parameters<typeof inner>[1]) => {
      const g = await inner(req, p)
      return g.actor ? { actor: { ...g.actor, clientScope: s.actor.scope } } : g
    },
    forbidTarget: async () => null,
    staffMfaGate: async () => 'ok',
  }
})

const planRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan/route')
const versionsRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan/versions/route')
const versionRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan/versions/[versionId]/route')
const submitRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan/versions/[versionId]/submit/route')
const approveRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan/versions/[versionId]/approve/route')
const rejectRoute = await import('@/app/api/giga-admin/users/[id]/point-b/plan/versions/[versionId]/reject/route')
const goalReview = await import('@/app/api/giga-admin/users/[id]/point-b/plan/goals/[metricKey]/review/route')
const queueRoute = await import('@/app/api/giga-admin/point-b/queue/route')
const expertVersion = await import('@/app/api/expert/clients/[id]/point-b-version/route')
const gigaPointB = await import('@/app/api/giga-admin/users/[id]/point-b/route')
const reviewRoute = await import('@/app/api/giga-admin/users/[id]/review/point-b/route')
const legacyApprove = await import('@/app/api/giga-admin/users/[id]/review/point-b/approve/route')

const body = (method: string, b?: unknown) =>
  new NextRequest('http://t/api', { method, body: b === undefined ? undefined : JSON.stringify(b), headers: { 'content-type': 'application/json', origin: 'http://t' } })
const get = () => new NextRequest('http://t/api')
const idp = (id: string) => ({ params: { id } })
const vp = (id: string, versionId: string) => ({ params: { id, versionId } })
const gp = (id: string, metricKey: string) => ({ params: { id, metricKey } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() })
const db = () => s.h!.db
const as = (role: StaffRole, id = role === 'admin' || role === 'super_admin' ? ADMIN : EXPERT, scope: 'all' | 'assigned' = 'all') => { s.actor = { id, role, scope } }

const target = (over: Record<string, unknown> = {}) => ({
  id: 'mt-1', company_id: COMPANY, metric_key: REVENUE, period_label: '12m', target_value: 100, direction: 'higher_is_better',
  source: 'owner', deadline: null, label: null, note: null, baseline_value: 50, baseline_period: '2025', baseline_at: '2026-01-01T00:00:00Z', ...over,
})

function seed(opts: { goal?: boolean } = {}) {
  return pbDb({
    companies: [
      { id: COMPANY, user_id: CLIENT, name: 'Ромашка', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null },
      { id: OTHER_COMPANY, user_id: OTHER_CLIENT, name: 'Лютик', target_revenue_12m_kzt: null, target_revenue_3y_kzt: null },
    ],
    profiles: [
      { id: CLIENT, role: 'client', full_name: 'Клиент Один', email: 'one@example.com' },
      { id: OTHER_CLIENT, role: 'client', full_name: 'Клиент Два', email: 'two@example.com' },
      { id: EXPERT, role: 'expert', full_name: 'Алия Эксперт' },
      { id: ADMIN, role: 'admin', full_name: 'Админ Главный' },
    ],
    user_assignments: [{ user_id: CLIENT, assignee_id: EXPERT }, { user_id: OTHER_CLIENT, assignee_id: 'someone-else' }],
    metric_targets: opts.goal === false ? [] : [target()],
    point_b_versions: [],
    diagnostics: [{ id: 'diag-1', user_id: CLIENT, is_current: true }],
  })
}

beforeEach(() => {
  s.h = seed()
  s.audits.length = 0
  Object.values(s.notify).forEach((f) => f.mockClear())
  as('admin')
  s.expert = { ok: true, viewer: { id: EXPERT, role: 'expert', email: 'e@example.com' } }
})

// ── helpers that drive the real routes ─────────────────────────────────────────

const createDraft = async (changeReason: string | null = 'Новая цель', user = CLIENT) => {
  const r = await json(await versionsRoute.POST(body('POST', { changeReason }), idp(user)))
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.data as { id: string; version: number; status: string }
}
const verifyGoal = async (user = CLIENT) => {
  const r = await json(await goalReview.POST(body('POST', { periodLabel: '12m', action: 'verify' }), gp(user, REVENUE)))
  expect(r.status, JSON.stringify(r.body)).toBe(200)
}
const submit = async (versionId: string, user = CLIENT) => json(await submitRoute.POST(body('POST', {}), vp(user, versionId)))
const approve = async (versionId: string, b: unknown = {}, user = CLIENT) => json(await approveRoute.POST(body('POST', b), vp(user, versionId)))
/** A draft with a verified primary goal and a reason, sent for approval. */
const inReview = async (reason = 'Новая цель') => {
  await verifyGoal()
  const v = await createDraft(reason)
  expect((await submit(v.id)).status).toBe(200)
  return v
}
const versions = () => db().pb_plan_versions as Array<Record<string, unknown>>

// ── GET plan ────────────────────────────────────────────────────────────────────

describe('GET plan', () => {
  it('GET plan returns bundle, goal statuses and canApprove', async () => {
    const empty = await json(await planRoute.GET(get(), idp(CLIENT)))
    expect(empty.status).toBe(200)
    expect(empty.body.data).toMatchObject({ plan: null, versions: [], open: null, published: null, canApprove: true })
    expect(empty.body.data.goals.items[0]).toMatchObject({ metricKey: REVENUE, reviewStatus: 'owner_draft' })

    await verifyGoal()
    const v = await createDraft()
    const full = await json(await planRoute.GET(get(), idp(CLIENT)))
    expect(full.body.data.plan).toMatchObject({ company_id: COMPANY, current_version_id: v.id })
    expect(full.body.data.open).toMatchObject({ id: v.id, status: 'draft' })
    expect(full.body.data.versions).toHaveLength(1)
    expect(full.body.data.goals.primary).toEqual({ metricKey: REVENUE, periodLabel: '12m' })
    expect(full.body.data.goals.items[0].reviewStatus).toBe('verified') // live status, not the stored one

    as('super_expert')
    expect((await json(await planRoute.GET(get(), idp(CLIENT)))).body.data.canApprove).toBe(false)
  })

  it('a client without a company gets an empty bundle, not an error', async () => {
    db().companies.length = 0
    const r = await json(await planRoute.GET(get(), idp(CLIENT)))
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ plan: null, versions: [], goals: { primary: null, items: [] } })
  })

  it('a role without clients.review is refused', async () => {
    as('analyst')
    expect((await json(await planRoute.GET(get(), idp(CLIENT)))).status).toBe(403)
  })

  it('an invalid user id is 400', async () => {
    expect((await json(await planRoute.GET(get(), idp('nope')))).status).toBe(400)
  })
})

// ── scope ───────────────────────────────────────────────────────────────────────

describe('scope', () => {
  it('expert of another client → 403 on every plan route, nothing written', async () => {
    const v = await createDraft('Причина', OTHER_CLIENT)
    const before = JSON.stringify(db().pb_plan_versions)
    as('admin', ADMIN, 'assigned') // may approve, but this client is not assigned to them
    const calls: Array<[string, () => Promise<Response>]> = [
      ['GET plan', () => planRoute.GET(get(), idp(OTHER_CLIENT))],
      ['create', () => versionsRoute.POST(body('POST', {}), idp(OTHER_CLIENT))],
      ['patch', () => versionRoute.PATCH(body('PATCH', { expertNotes: 'x' }), vp(OTHER_CLIENT, v.id))],
      ['submit', () => submitRoute.POST(body('POST', {}), vp(OTHER_CLIENT, v.id))],
      ['approve', () => approveRoute.POST(body('POST', {}), vp(OTHER_CLIENT, v.id))],
      ['reject', () => rejectRoute.POST(body('POST', { reason: 'Поправьте' }), vp(OTHER_CLIENT, v.id))],
      ['goal review', () => goalReview.POST(body('POST', { periodLabel: '12m', action: 'verify' }), gp(OTHER_CLIENT, REVENUE))],
      ['legacy giga', () => gigaPointB.POST(body('POST', { expert_notes: 'x' }), idp(OTHER_CLIENT))],
      ['legacy review', () => reviewRoute.POST(body('POST', { expert_notes: 'x' }), idp(OTHER_CLIENT))],
      ['legacy approve', () => legacyApprove.POST(body('POST', { versionId: v.id }), idp(OTHER_CLIENT))],
    ]
    for (const [name, call] of calls) expect((await call()).status, name).toBe(403)
    expect(JSON.stringify(db().pb_plan_versions)).toBe(before)

    s.expert = { ok: true, viewer: { id: EXPERT, role: 'expert', email: null } }
    expect((await expertVersion.POST(body('POST', { expert_notes: 'x' }), idp(OTHER_CLIENT))).status).toBe(403)
    expect((await expertVersion.GET(get(), idp(OTHER_CLIENT))).status).toBe(403)
    expect(JSON.stringify(db().pb_plan_versions)).toBe(before)
  })

  it('a version of ANOTHER client plan is 404 on every versioned route (IDOR)', async () => {
    const foreign = await createDraft('Чужая', OTHER_CLIENT)
    const calls: Array<[string, () => Promise<Response>]> = [
      ['patch', () => versionRoute.PATCH(body('PATCH', { expertNotes: 'взлом' }), vp(CLIENT, foreign.id))],
      ['submit', () => submitRoute.POST(body('POST', {}), vp(CLIENT, foreign.id))],
      ['approve', () => approveRoute.POST(body('POST', {}), vp(CLIENT, foreign.id))],
      ['reject', () => rejectRoute.POST(body('POST', { reason: 'Поправьте' }), vp(CLIENT, foreign.id))],
      ['legacy approve', () => legacyApprove.POST(body('POST', { versionId: foreign.id }), idp(CLIENT))],
    ]
    for (const [name, call] of calls) expect((await call()).status, name).toBe(404)
    expect(versions()[0]).toMatchObject({ status: 'draft', expert_notes: null })
  })
})

// ── versions ────────────────────────────────────────────────────────────────────

describe('versions', () => {
  it('creates a draft with a goals snapshot, the author and an audit row; a second open draft → 409', async () => {
    await verifyGoal()
    const r = await json(await versionsRoute.POST(body('POST', { changeReason: 'Первый план' }), idp(CLIENT)))
    expect(r.status).toBe(201)
    expect(r.body.data).toMatchObject({ version: 1, status: 'draft', change_reason: 'Первый план', author_id: ADMIN, author_name: 'Админ Главный', author_kind: 'admin' })
    expect(r.body.data.goals.items[0]).toMatchObject({ metricKey: REVENUE, targetValue: 100, reviewStatus: 'verified' })
    expect(r.body.data.goals.primary).toEqual({ metricKey: REVENUE, periodLabel: '12m' })
    expect(s.audits.map((a) => a.action)).toContain('point_b.plan.created')
    expect(s.audits.find((a) => a.action === 'point_b.plan.created')).toMatchObject({ entityId: r.body.data.id, targetUserId: CLIENT })

    const again = await json(await versionsRoute.POST(body('POST', {}), idp(CLIENT)))
    expect(again.status).toBe(409)
    expect(again.body.ok).toBe(false)
    expect(versions()).toHaveLength(1)
  })

  it('an expert author is labelled expert; no company → 404', async () => {
    as('super_expert')
    const v = await json(await versionsRoute.POST(body('POST', {}), idp(CLIENT)))
    expect(v.body.data).toMatchObject({ author_kind: 'expert', author_name: 'Алия Эксперт' })
    db().companies.length = 0
    expect((await json(await versionsRoute.POST(body('POST', {}), idp(OTHER_CLIENT)))).status).toBe(404)
  })

  it('PATCH edits a draft and refreshes the goals snapshot; PATCH on in_review or approved → 409', async () => {
    const v = await createDraft()
    expect(versions()[0].goals).toMatchObject({ items: [{ reviewStatus: 'owner_draft' }] })
    await verifyGoal()
    const ok = await json(await versionRoute.PATCH(body('PATCH', { expertNotes: 'Заметки эксперта', changeReason: 'Причина' }), vp(CLIENT, v.id)))
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ expert_notes: 'Заметки эксперта', change_reason: 'Причина' })
    expect(versions()[0].goals).toMatchObject({ items: [{ reviewStatus: 'verified' }] })
    expect(s.audits.map((a) => a.action)).toContain('point_b.plan.updated')

    expect((await submit(v.id)).status).toBe(200)
    const frozen = await json(await versionRoute.PATCH(body('PATCH', { expertNotes: 'Поздно' }), vp(CLIENT, v.id)))
    expect(frozen.status).toBe(409)
    expect(versions()[0].expert_notes).toBe('Заметки эксперта')

    expect((await approve(v.id)).status).toBe(200)
    expect((await json(await versionRoute.PATCH(body('PATCH', { expertNotes: 'Поздно' }), vp(CLIENT, v.id)))).status).toBe(409)
    expect(versions()[0].expert_notes).toBe('Заметки эксперта')
  })

  it('PATCH validates the body', async () => {
    const v = await createDraft()
    expect((await json(await versionRoute.PATCH(body('PATCH', {}), vp(CLIENT, v.id)))).status).toBe(400)
    expect((await json(await versionRoute.PATCH(body('PATCH', { expertNotes: 'x'.repeat(8001) }), vp(CLIENT, v.id)))).status).toBe(400)
    expect((await json(await versionRoute.PATCH(body('PATCH', { expertNotes: 'ok' }), vp(CLIENT, '00000000-0000-4000-8000-00000000dead')))).status).toBe(404)
  })

  it('submit sends the draft for approval, notifies staff and audits; submitting twice → 409', async () => {
    const v = await createDraft()
    const r = await submit(v.id)
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ status: 'in_review' })
    expect(s.notify.submitted).toHaveBeenCalledTimes(1)
    expect(s.notify.submitted.mock.calls[0]).toEqual([expect.anything(), expect.objectContaining({ companyId: COMPANY, userId: CLIENT, versionId: v.id, authorName: 'Админ Главный' })])
    expect(s.audits.map((a) => a.action)).toContain('point_b.plan.submitted')
    expect((await submit(v.id)).status).toBe(409)
    expect(s.notify.submitted).toHaveBeenCalledTimes(1)
  })

  it('profanity in expert notes or reasons → 400 with the field', async () => {
    const v = await createDraft()
    const dirty = 'Это полная хуйня'
    const notes = await json(await versionRoute.PATCH(body('PATCH', { expertNotes: dirty }), vp(CLIENT, v.id)))
    expect(notes.status).toBe(400)
    expect(notes.body.field).toBe('expertNotes')
    const reason = await json(await versionRoute.PATCH(body('PATCH', { changeReason: dirty }), vp(CLIENT, v.id)))
    expect(reason.body.field).toBe('changeReason')
    expect((await json(await versionsRoute.POST(body('POST', { changeReason: dirty }), idp(CLIENT)))).body.field).toBe('changeReason')
    expect(versions()[0].expert_notes).toBeNull()

    const review = await json(await goalReview.POST(body('POST', { periodLabel: '12m', action: 'correct', value: 150, reason: dirty }), gp(CLIENT, REVENUE)))
    expect(review.status).toBe(400)
    expect(review.body.field).toBe('reason')
    expect(db().pb_goal_reviews).toHaveLength(0)

    await verifyGoal()
    await submit(v.id)
    const rej = await json(await rejectRoute.POST(body('POST', { reason: dirty }), vp(CLIENT, v.id)))
    expect(rej.status).toBe(400)
    expect(rej.body.field).toBe('reason')
    expect(versions()[0].status).toBe('in_review')
  })
})

// ── approval ────────────────────────────────────────────────────────────────────

describe('approve / reject', () => {
  it('only an approver can approve or reject; an expert gets 403 and nothing changes', async () => {
    const v = await inReview()
    as('super_expert')
    expect((await approve(v.id)).status).toBe(403)
    expect((await json(await rejectRoute.POST(body('POST', { reason: 'Поправьте цели' }), vp(CLIENT, v.id)))).status).toBe(403)
    expect(versions()[0].status).toBe('in_review')

    as('super_admin')
    expect((await approve(v.id)).status).toBe(200)
  })

  it('approve publishes: status, approver, published_version_id, client notified as the first publication, audited', async () => {
    const v = await inReview()
    const r = await approve(v.id)
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ id: v.id, status: 'approved', approved_by: ADMIN, approval_exception: null })
    expect(db().pb_plans[0].published_version_id).toBe(v.id)
    expect(s.notify.approved).toHaveBeenCalledTimes(1)
    expect(s.notify.approved.mock.calls[0]).toEqual([expect.anything(), { userId: CLIENT, versionId: v.id, first: true, actor: { id: ADMIN, name: 'Админ Главный' } }])
    const audit = s.audits.find((a) => a.action === 'point_b.plan.approved')!
    expect(audit).toMatchObject({ entityId: v.id, targetUserId: CLIENT })
    expect(audit.metadata).toMatchObject({ exception: false, first: true })
  })

  it('a later publication replaces the previous one and is not «first»', async () => {
    const v1 = await inReview()
    await approve(v1.id)
    const v2 = await createDraft('Уточнили цель')
    await submit(v2.id)
    expect((await approve(v2.id)).status).toBe(200)
    expect(versions().map((x) => [x.version, x.status])).toEqual([[1, 'superseded'], [2, 'approved']])
    expect(db().pb_plans[0].published_version_id).toBe(v2.id)
    expect(s.notify.approved.mock.calls[1][1]).toMatchObject({ versionId: v2.id, first: false })
    expect(s.audits.filter((a) => a.action === 'point_b.plan.approved')[1].metadata).toMatchObject({ first: false, supersededVersionId: v1.id })
  })

  it('approve with an unverified primary goal → 409 with reasons, nothing published, nobody notified', async () => {
    const v = await createDraft()
    await submit(v.id)
    const r = await approve(v.id)
    expect(r.status).toBe(409)
    expect(r.body.ok).toBe(false)
    expect(r.body.reasons).toContain('Главная цель не проверена экспертом')
    expect(versions()[0].status).toBe('in_review')
    expect(db().pb_plans[0].published_version_id).toBeNull()
    expect(s.notify.approved).not.toHaveBeenCalled()
  })

  it('a goal verified AFTER the version went to review counts (the snapshot follows the live goal)', async () => {
    const v = await createDraft()
    await submit(v.id)
    expect((await approve(v.id)).status).toBe(409)
    await verifyGoal()
    expect((await approve(v.id)).status).toBe(200)
  })

  it('a goal the owner changed after verification blocks approval again', async () => {
    const v = await inReview()
    db().metric_targets[0].target_value = 999
    const r = await approve(v.id)
    expect(r.status).toBe(409)
    expect(r.body.reasons).toContain('Главная цель не проверена экспертом')
  })

  it('approve with exceptionReason < 10 chars → 400; ≥ 10 → 200 and the exception is stored and audited', async () => {
    const v = await createDraft()
    await submit(v.id)
    const short = await approve(v.id, { exceptionReason: 'срочно' })
    expect(short.status).toBe(400)
    expect(short.body.field).toBe('exceptionReason')
    expect(versions()[0].status).toBe('in_review')

    const ok = await approve(v.id, { exceptionReason: 'Клиент ждёт план, цель обсудили по телефону' })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ status: 'approved', approval_exception: 'Клиент ждёт план, цель обсудили по телефону' })
    expect(s.audits.find((a) => a.action === 'point_b.plan.approved')!.metadata).toMatchObject({
      exception: true, exceptionReason: 'Клиент ждёт план, цель обсудили по телефону',
    })
  })

  it('an exception does not waive a missing change reason', async () => {
    await verifyGoal()
    const v = await createDraft(null)
    await submit(v.id)
    const r = await approve(v.id, { exceptionReason: 'Достаточно длинная причина' })
    expect(r.status).toBe(409)
    expect(r.body.reasons).toEqual(['Не указана причина изменений'])
  })

  it('two concurrent approves: exactly one succeeds, the other is 409', async () => {
    const v = await inReview()
    const [a, b] = await Promise.all([approve(v.id), approve(v.id)])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(versions().filter((x) => x.status === 'approved')).toHaveLength(1)
    expect(s.notify.approved).toHaveBeenCalledTimes(1)
    expect(s.audits.filter((x) => x.action === 'point_b.plan.approved')).toHaveLength(1)
  })

  it('approving a draft (not submitted) or an approved version → 409', async () => {
    const draft = await createDraft()
    expect((await approve(draft.id)).status).toBe(409)
    expect(versions()[0].status).toBe('draft')
  })

  it('reject returns the version to a draft keeping the reason, by and at; short reason → 400; audited', async () => {
    const v = await inReview()
    const short = await json(await rejectRoute.POST(body('POST', { reason: 'нет' }), vp(CLIENT, v.id)))
    expect(short.status).toBe(400)
    expect(short.body.field).toBe('reason')

    const r = await json(await rejectRoute.POST(body('POST', { reason: 'Уточните срок цели' }), vp(CLIENT, v.id)))
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ status: 'draft', rejected_reason: 'Уточните срок цели', rejected_by: ADMIN })
    expect(r.body.data.rejected_at).toBeTruthy()
    expect(s.audits.find((a) => a.action === 'point_b.plan.rejected')!.metadata).toMatchObject({ reason: 'Уточните срок цели' })
    // it can be edited and sent again
    expect((await json(await versionRoute.PATCH(body('PATCH', { expertNotes: 'Поправил' }), vp(CLIENT, v.id)))).status).toBe(200)
    // rejecting a draft is a state error
    expect((await json(await rejectRoute.POST(body('POST', { reason: 'Ещё раз вернуть' }), vp(CLIENT, v.id)))).status).toBe(409)
  })
})

// ── goal review ─────────────────────────────────────────────────────────────────

describe('goal review route', () => {
  it('verify confirms the goal and audits; no notification to the owner', async () => {
    const r = await json(await goalReview.POST(body('POST', { periodLabel: '12m', action: 'verify' }), gp(CLIENT, REVENUE)))
    expect(r.status).toBe(200)
    expect(r.body.data.review).toMatchObject({ status: 'verified', reviewer_id: ADMIN, reviewer_name: 'Админ Главный' })
    expect(s.notify.correction).not.toHaveBeenCalled()
    expect(s.audits.find((a) => a.action === 'point_b.goal.reviewed')!.metadata).toMatchObject({ metricKey: REVENUE, action: 'verify' })
  })

  it('correct when the owner has no goal sets it directly and tells the owner (no previous value)', async () => {
    s.h = seed({ goal: false })
    const r = await json(await goalReview.POST(body('POST', { periodLabel: '12m', action: 'correct', value: 250, deadline: '2027-10-01', reason: 'Рынок позволяет' }), gp(CLIENT, REVENUE)))
    expect(r.status).toBe(200)
    expect(r.body.data.appliedDirectly).toBe(true)
    expect(db().metric_targets[0]).toMatchObject({ target_value: 250, source: 'expert' })
    expect(s.notify.correction).toHaveBeenCalledTimes(1)
    expect(s.notify.correction.mock.calls[0][1]).toMatchObject({ userId: CLIENT, from: null, to: 250, reason: 'Рынок позволяет' })
  })

  it('correct against an existing goal is a proposal: metric_targets untouched, the owner is asked (from → to)', async () => {
    const r = await json(await goalReview.POST(body('POST', { periodLabel: '12m', action: 'correct', value: 150, reason: 'Выше рынка' }), gp(CLIENT, REVENUE)))
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ appliedDirectly: false, review: { status: 'corrected', proposed_value: 150, previous_value: 100 } })
    expect(db().metric_targets[0].target_value).toBe(100)
    expect(s.notify.correction).toHaveBeenCalledTimes(1)
    expect(s.notify.correction.mock.calls[0][1]).toMatchObject({
      userId: CLIENT, reviewId: r.body.data.review.id, from: 100, to: 150, reason: 'Выше рынка', reviewer: { id: ADMIN, name: 'Админ Главный' },
    })
  })

  it('validation: correct needs a value and a reason, reject needs a reason, bad action / period → 400', async () => {
    const call = async (b: unknown) => json(await goalReview.POST(body('POST', b), gp(CLIENT, REVENUE)))
    expect((await call({ periodLabel: '12m', action: 'correct', reason: 'x' })).body.field).toBe('value')
    expect((await call({ periodLabel: '12m', action: 'correct', value: 150 })).body.field).toBe('reason')
    expect((await call({ periodLabel: '12m', action: 'reject' })).body.field).toBe('reason')
    expect((await call({ periodLabel: '12m', action: 'delete' })).status).toBe(400)
    expect((await call({ action: 'verify' })).status).toBe(400)
    expect((await json(await goalReview.POST(body('POST', { periodLabel: '12m', action: 'verify' }), gp(CLIENT, 'drop table')))).status).toBe(400)
    // same value as the owner's → a domain validation error, 400 (not a refused approval)
    expect((await call({ periodLabel: '12m', action: 'correct', value: 100, reason: 'Без изменений' })).status).toBe(400)
    expect(db().pb_goal_reviews).toHaveLength(0)
  })

  it('a goal that does not exist cannot be verified → 404', async () => {
    s.h = seed({ goal: false })
    expect((await json(await goalReview.POST(body('POST', { periodLabel: '12m', action: 'verify' }), gp(CLIENT, REVENUE)))).status).toBe(404)
  })
})

// ── queue ───────────────────────────────────────────────────────────────────────

describe('queue', () => {
  it('lists in_review versions only (with names and the wait), longest wait first', async () => {
    await verifyGoal()
    await createDraft('Черновик')                 // a draft: not in the queue
    const mine = await createDraft('Причина', OTHER_CLIENT)
    await submit(mine.id, OTHER_CLIENT)
    const r = await json(await queueRoute.GET(get()))
    expect(r.status).toBe(200)
    expect(r.body.data).toHaveLength(1)
    expect(r.body.data[0]).toMatchObject({
      versionId: mine.id, userId: OTHER_CLIENT, clientName: 'Клиент Два', companyName: 'Лютик', version: 1, authorName: 'Админ Главный',
    })
    expect(r.body.data[0].waitingDays).toBeGreaterThanOrEqual(0)
    expect(r.body.data[0].submittedAt).toBeTruthy()
    expect(r.body.canApprove).toBe(true)
  })

  it('an actor limited to assigned clients sees only those; an approver with all sees everyone', async () => {
    const a = await createDraft('Причина', CLIENT)
    const b = await createDraft('Причина', OTHER_CLIENT)
    await submit(a.id, CLIENT)
    await submit(b.id, OTHER_CLIENT)
    const all = await json(await queueRoute.GET(get()))
    expect(all.body.data.map((x: { userId: string }) => x.userId).sort()).toEqual([CLIENT, OTHER_CLIENT].sort())

    as('super_expert', EXPERT, 'assigned')
    const scoped = await json(await queueRoute.GET(get()))
    expect(scoped.body.data.map((x: { userId: string }) => x.userId)).toEqual([CLIENT])
    expect(scoped.body.canApprove).toBe(false)
  })

  it('empty queue and a role without clients.review', async () => {
    expect((await json(await queueRoute.GET(get()))).body.data).toEqual([])
    as('support')
    expect((await json(await queueRoute.GET(get()))).status).toBe(403)
  })
})

// ── the legacy write routes now go through plan versions ──────────────────────────

describe('legacy routes → plan versions', () => {
  const legacyPb = () => db().point_b_versions

  it('legacy POST expert/point-b-version creates a plan draft, sets the notes and submits it; writes nothing to point_b_versions', async () => {
    const res = await json(await expertVersion.POST(body('POST', { expert_notes: 'Цель агрессивная — начните с конверсии' }), idp(CLIENT)))
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ is_approved: false, status: 'in_review', expert_notes: 'Цель агрессивная — начните с конверсии', author_name: 'Алия Эксперт' })
    expect(versions()).toHaveLength(1)
    expect(versions()[0]).toMatchObject({
      status: 'in_review', expert_notes: 'Цель агрессивная — начните с конверсии', author_id: EXPERT, author_kind: 'expert', author_name: 'Алия Эксперт', change_reason: 'Правка заметок эксперта',
    })
    expect(legacyPb()).toHaveLength(0)
    expect(s.h!.writes.some((w) => w.table === 'point_b_versions')).toBe(false)
    expect(s.notify.submitted).toHaveBeenCalledTimes(1)
    expect(s.audits.map((a) => a.action)).toEqual(['point_b.plan.created', 'point_b.plan.submitted'])
  })

  it('legacy POST edits an existing draft instead of creating a second one; a version in review → 409', async () => {
    const v = await createDraft('Моя причина')
    const r = await json(await expertVersion.POST(body('POST', { expert_notes: 'Текст из старого редактора', change_reason: 'Пересмотр' }), idp(CLIENT)))
    expect(r.status).toBe(200)
    expect(versions()).toHaveLength(1)
    expect(versions()[0]).toMatchObject({ id: v.id, status: 'in_review', expert_notes: 'Текст из старого редактора', change_reason: 'Пересмотр' })
    expect(s.audits.map((a) => a.action)).toContain('point_b.plan.updated')

    const second = await json(await expertVersion.POST(body('POST', { expert_notes: 'Ещё правка' }), idp(CLIENT)))
    expect(second.status).toBe(409)
    expect(versions()[0].expert_notes).toBe('Текст из старого редактора')
  })

  it('legacy POST validates: notes required, profanity → 400 with expert_notes, no company → 400', async () => {
    expect((await expertVersion.POST(body('POST', { expert_notes: '  ' }), idp(CLIENT))).status).toBe(400)
    const dirty = await json(await expertVersion.POST(body('POST', { expert_notes: 'Это полная хуйня' }), idp(CLIENT)))
    expect(dirty.status).toBe(400)
    expect(dirty.body.field).toBe('expert_notes')
    expect(versions()).toHaveLength(0)
    db().companies.length = 0
    expect((await expertVersion.POST(body('POST', { expert_notes: 'Текст' }), idp(CLIENT))).status).toBe(400)
    s.expert = { ok: false, block: 'unauthenticated' }
    expect((await expertVersion.POST(body('POST', { expert_notes: 'ok' }), idp(CLIENT))).status).toBe(401)
  })

  it('legacy giga POST point-b does the same', async () => {
    as('super_expert', ADMIN)
    const res = await json(await gigaPointB.POST(body('POST', { expert_notes: 'Нужна корректировка плана' }), idp(CLIENT)))
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ is_approved: false, status: 'in_review' })
    expect(versions()[0]).toMatchObject({ status: 'in_review', expert_notes: 'Нужна корректировка плана', author_name: 'Админ Главный', author_kind: 'expert' })
    expect(legacyPb()).toHaveLength(0)

    const dirty = await json(await gigaPointB.POST(body('POST', { expert_notes: 'Это полная хуйня' }), idp(CLIENT)))
    expect(dirty.status).toBe(400)
    expect(dirty.body.field).toBe('expert_notes')
  })

  it('legacy review/point-b POST does the same; GET lists plan versions in the legacy shape', async () => {
    const res = await json(await reviewRoute.POST(body('POST', { expert_notes: 'Версия на проверку' }), idp(CLIENT)))
    expect(res.status).toBe(200)
    expect(versions()[0]).toMatchObject({ status: 'in_review', expert_notes: 'Версия на проверку' })
    expect(legacyPb()).toHaveLength(0)

    const list = await json(await reviewRoute.GET(get(), idp(CLIENT)))
    expect(list.body.data).toMatchObject({ diagnosticId: 'diag-1', canApprove: true })
    expect(list.body.data.versions[0]).toMatchObject({ id: versions()[0].id, expert_notes: 'Версия на проверку', is_approved: false, status: 'in_review' })
  })

  it('legacy review GET falls back to the old point_b_versions rows while the client has no plan', async () => {
    legacyPb().push({ id: 'old-1', diagnostic_id: 'diag-1', authored_by: EXPERT, author_name: 'Алия', expert_notes: 'Старая', roadmap: null, is_approved: true, approved_by: null, approved_at: null, created_at: '2026-10-01T00:00:00Z' })
    const list = await json(await reviewRoute.GET(get(), idp(CLIENT)))
    expect(list.body.data.versions).toHaveLength(1)
    expect(list.body.data.versions[0]).toMatchObject({ id: 'old-1', expert_notes: 'Старая', is_approved: true })
  })

  it('legacy approve publishes a PLAN version through the same conditions; expert 403; unmet conditions 409 with reasons', async () => {
    const draft = await json(await expertVersion.POST(body('POST', { expert_notes: 'Заметки', change_reason: 'Первый план' }), idp(CLIENT)))
    const id = draft.body.data.id as string

    as('super_expert')
    expect((await json(await legacyApprove.POST(body('POST', { versionId: id }), idp(CLIENT)))).status).toBe(403)

    as('admin')
    const refused = await json(await legacyApprove.POST(body('POST', { versionId: id }), idp(CLIENT)))
    expect(refused.status).toBe(409)
    expect(refused.body.reasons).toContain('Главная цель не проверена экспертом')

    await verifyGoal()
    const ok = await json(await legacyApprove.POST(body('POST', { versionId: id }), idp(CLIENT)))
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ id, is_approved: true, status: 'approved' })
    expect(db().pb_plans[0].published_version_id).toBe(id)
    expect(s.notify.approved).toHaveBeenCalledTimes(1)
    expect(s.audits.find((a) => a.action === 'point_b.plan.approved')!.metadata).toMatchObject({ via: 'legacy-route' })

    expect((await json(await legacyApprove.POST(body('POST', { versionId: 'not-a-uuid' }), idp(CLIENT)))).status).toBe(404)
    expect((await json(await legacyApprove.POST(body('POST', {}), idp(CLIENT)))).status).toBe(400)
  })

  it('GET expert/point-b-version returns the latest plan version in the legacy shape, then the legacy row without a plan', async () => {
    legacyPb().push({ id: 'old-1', diagnostic_id: 'diag-1', expert_notes: 'Старая запись', author_name: 'Алия', is_approved: true, created_at: '2026-10-01T00:00:00Z' })
    const before = await json(await expertVersion.GET(get(), idp(CLIENT)))
    expect(before.body.data).toMatchObject({ id: 'old-1', expert_notes: 'Старая запись' })

    await expertVersion.POST(body('POST', { expert_notes: 'Новая заметка', change_reason: 'Причина' }), idp(CLIENT))
    const after = await json(await expertVersion.GET(get(), idp(CLIENT)))
    expect(after.body.data).toMatchObject({ id: versions()[0].id, expert_notes: 'Новая заметка', author_name: 'Алия Эксперт', is_approved: false })
    expect(typeof after.body.data.created_at).toBe('string')
    expect(Object.keys(after.body.data)).toEqual(expect.arrayContaining(['id', 'expert_notes', 'author_name', 'is_approved', 'created_at']))
  })
})
