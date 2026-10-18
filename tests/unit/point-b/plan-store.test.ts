import { describe, expect, it } from 'vitest'
import {
  approveVersion, approveVersionDetailed, createDraft, getOrCreatePlan, loadPlanBundle, PlanError, rejectVersion, submitVersion, updateDraft,
} from '@/lib/point-b/plan/store'
import type { GoalReviewStatus, PlanGoalsSnapshot } from '@/lib/point-b/plan/types'
import { pbDb } from './_pbdb'

const REVENUE = 'biz.finansy.vyruchka_god'
const COMPANY = 'company-1'
const OWNER = '00000000-0000-4000-8000-000000000001'
const EXPERT = { id: '00000000-0000-4000-8000-0000000000e1', name: 'Анна Эксперт', kind: 'expert' as const }
const ADMIN = { id: '00000000-0000-4000-8000-0000000000a1' }

function goals(status: GoalReviewStatus = 'verified'): PlanGoalsSnapshot {
  return {
    primary: { metricKey: REVENUE, periodLabel: '12m' },
    items: [{ metricKey: REVENUE, periodLabel: '12m', label: 'Выручка', baselineValue: 100, baselinePeriod: '2026', targetValue: 200, deadline: null, reviewStatus: status }],
  }
}

const draftInput = (over: Record<string, unknown> = {}) => ({
  goals: goals(), baseSnapshotId: null, author: EXPERT, changeReason: 'Первый план', ...over,
})

async function setup() {
  const h = pbDb({ companies: [{ id: COMPANY, user_id: OWNER }] })
  const plan = await getOrCreatePlan(h.sb, COMPANY, OWNER)
  return { ...h, plan }
}

/** A draft that went through submit. */
async function inReview(h: Awaited<ReturnType<typeof setup>>, over: Record<string, unknown> = {}) {
  const v = await createDraft(h.sb, h.plan, draftInput(over))
  return submitVersion(h.sb, v.id)
}

describe('plan store', () => {
  it('getOrCreatePlan is idempotent per company', async () => {
    const { sb, db } = pbDb()
    const a = await getOrCreatePlan(sb, COMPANY, OWNER)
    const b = await getOrCreatePlan(sb, COMPANY, OWNER)
    expect(b.id).toBe(a.id)
    expect(db.pb_plans).toHaveLength(1)
    expect(a).toMatchObject({ company_id: COMPANY, user_id: OWNER, current_version_id: null, published_version_id: null })
  })

  it('createDraft numbers versions 1, 2, 3 and copies content from the previous version', async () => {
    const h = await setup()
    const v1 = await createDraft(h.sb, h.plan, draftInput())
    expect(v1).toMatchObject({ version: 1, status: 'draft', author_name: 'Анна Эксперт', author_kind: 'expert', change_reason: 'Первый план' })
    await updateDraft(h.sb, v1.id, { expertNotes: 'Заметка эксперта' })
    h.db.pb_plan_versions[0].strategy = { focus: 'маржа' }
    h.db.pb_plan_versions[0].risks = ['кассовый разрыв']
    h.db.pb_plan_versions[0].assumptions = { churn: 0.1 }
    await submitVersion(h.sb, v1.id)
    await approveVersion(h.sb, v1.id, ADMIN)

    const v2 = await createDraft(h.sb, h.plan, draftInput({ changeReason: 'Новая цель', fromVersion: { ...h.db.pb_plan_versions[0] } }))
    expect(v2.version).toBe(2)
    expect(v2).toMatchObject({ expert_notes: 'Заметка эксперта', strategy: { focus: 'маржа' }, risks: ['кассовый разрыв'], assumptions: { churn: 0.1 }, change_reason: 'Новая цель', status: 'draft' })
    // the copy is not the approved version itself
    expect(v2.id).not.toBe(v1.id)

    await submitVersion(h.sb, v2.id)
    await approveVersion(h.sb, v2.id, ADMIN)
    const v3 = await createDraft(h.sb, h.plan, draftInput())
    expect(v3.version).toBe(3)
    expect(v3.expert_notes).toBeNull() // no fromVersion → nothing copied
    expect(h.db.pb_plans[0].current_version_id).toBe(v3.id)
  })

  it('second open draft → PlanError open_exists', async () => {
    const h = await setup()
    await createDraft(h.sb, h.plan, draftInput())
    await expect(createDraft(h.sb, h.plan, draftInput())).rejects.toMatchObject({ code: 'open_exists' })
    expect(h.db.pb_plan_versions).toHaveLength(1)
  })

  it('an in_review version also blocks a second draft', async () => {
    const h = await setup()
    await inReview(h)
    await expect(createDraft(h.sb, h.plan, draftInput())).rejects.toBeInstanceOf(PlanError)
  })

  it('updateDraft changes a draft and refuses in_review or approved → not_editable', async () => {
    const h = await setup()
    const v = await createDraft(h.sb, h.plan, draftInput())
    const upd = await updateDraft(h.sb, v.id, { expertNotes: 'Новая заметка', changeReason: 'Другая причина', selectedScenario: 'base' })
    expect(upd).toMatchObject({ expert_notes: 'Новая заметка', change_reason: 'Другая причина', selected_scenario: 'base' })

    await submitVersion(h.sb, v.id)
    await expect(updateDraft(h.sb, v.id, { expertNotes: 'x' })).rejects.toMatchObject({ code: 'not_editable' })
    await approveVersion(h.sb, v.id, ADMIN)
    await expect(updateDraft(h.sb, v.id, { expertNotes: 'x' })).rejects.toMatchObject({ code: 'not_editable' })
    expect(h.db.pb_plan_versions[0].expert_notes).toBe('Новая заметка')
    await expect(updateDraft(h.sb, 'no-such-id', { expertNotes: 'x' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('submit requires draft and sets submitted_at', async () => {
    const h = await setup()
    const v = await createDraft(h.sb, h.plan, draftInput())
    expect(v.submitted_at).toBeNull()
    const sub = await submitVersion(h.sb, v.id)
    expect(sub.status).toBe('in_review')
    expect(sub.submitted_at).toBeTruthy()
    await expect(submitVersion(h.sb, v.id)).rejects.toMatchObject({ code: 'bad_state' })
    await expect(submitVersion(h.sb, 'missing')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('approve checks conditions: unverified primary goal → conditions error with reasons', async () => {
    const h = await setup()
    const v = await inReview(h, { goals: goals('owner_draft') })
    const err = await approveVersion(h.sb, v.id, ADMIN).catch((e) => e)
    expect(err).toBeInstanceOf(PlanError)
    expect(err).toMatchObject({ code: 'conditions', reasons: ['Главная цель не проверена экспертом'] })
    expect(h.db.pb_plan_versions[0].status).toBe('in_review')
    expect(h.db.pb_plans[0].published_version_id).toBeNull()
  })

  it('approve of a version without a change reason fails even with an exception', async () => {
    const h = await setup()
    const v = await inReview(h, { goals: goals('owner_draft'), changeReason: null })
    await expect(approveVersion(h.sb, v.id, ADMIN, { exceptionReason: 'Достаточно длинная причина' }))
      .rejects.toMatchObject({ code: 'conditions', reasons: ['Не указана причина изменений'] })
  })

  it('approve with a valid exception reason stores approval_exception', async () => {
    const h = await setup()
    const v = await inReview(h, { goals: goals('owner_draft') })
    await expect(approveVersion(h.sb, v.id, ADMIN, { exceptionReason: 'коротко' })).rejects.toMatchObject({ code: 'conditions' })
    const done = await approveVersion(h.sb, v.id, ADMIN, { exceptionReason: '  Владелец недоступен, срок горит  ' })
    expect(done).toMatchObject({ status: 'approved', approved_by: ADMIN.id, approval_exception: 'Владелец недоступен, срок горит' })
    expect(done.approved_at).toBeTruthy()
  })

  it('a verified primary goal needs no exception and stores none', async () => {
    const h = await setup()
    const v = await inReview(h)
    const done = await approveVersion(h.sb, v.id, ADMIN, { exceptionReason: 'Не нужна, но передана' })
    expect(done.approval_exception).toBeNull()
  })

  it('approve supersedes the previous approved and moves published_version_id', async () => {
    const h = await setup()
    const v1 = await inReview(h)
    const first = await approveVersionDetailed(h.sb, v1.id, ADMIN)
    expect(first.previousPublishedId).toBeNull()
    expect(h.db.pb_plans[0]).toMatchObject({ published_version_id: v1.id, current_version_id: v1.id })

    const v2 = await inReview(h, { changeReason: 'Пересмотр' })
    const second = await approveVersionDetailed(h.sb, v2.id, ADMIN)
    expect(second.previousPublishedId).toBe(v1.id)
    expect(h.db.pb_plan_versions.find((r) => r.id === v1.id)!.status).toBe('superseded')
    expect(h.db.pb_plan_versions.find((r) => r.id === v2.id)!.status).toBe('approved')
    expect(h.db.pb_plans[0]).toMatchObject({ published_version_id: v2.id, current_version_id: v2.id })
    // the superseded row kept its content (trigger: only the status changed)
    expect(h.db.pb_plan_versions.find((r) => r.id === v1.id)!.approved_by).toBe(ADMIN.id)
  })

  it('two concurrent approves: exactly one succeeds', async () => {
    const h = await setup()
    const v = await inReview(h)
    const results = await Promise.allSettled([approveVersion(h.sb, v.id, ADMIN), approveVersion(h.sb, v.id, { id: 'other-admin' })])
    const ok = results.filter((r) => r.status === 'fulfilled')
    const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(bad).toHaveLength(1)
    expect(bad[0].reason).toMatchObject({ code: 'bad_state' })
    expect(h.db.pb_plan_versions.filter((r) => r.status === 'approved')).toHaveLength(1)
  })

  it('approve of a draft or an approved version → bad_state', async () => {
    const h = await setup()
    const d = await createDraft(h.sb, h.plan, draftInput())
    await expect(approveVersion(h.sb, d.id, ADMIN)).rejects.toMatchObject({ code: 'bad_state' })
    await submitVersion(h.sb, d.id)
    await approveVersion(h.sb, d.id, ADMIN)
    await expect(approveVersion(h.sb, d.id, ADMIN)).rejects.toMatchObject({ code: 'bad_state' })
    await expect(approveVersion(h.sb, 'missing', ADMIN)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reject returns to draft keeping reason, by and at', async () => {
    const h = await setup()
    const v = await inReview(h)
    const back = await rejectVersion(h.sb, v.id, ADMIN, 'Нужны допущения по марже')
    expect(back).toMatchObject({ status: 'draft', rejected_by: ADMIN.id, rejected_reason: 'Нужны допущения по марже', submitted_at: null })
    expect(back.rejected_at).toBeTruthy()
    // editable again and can be resubmitted
    await updateDraft(h.sb, v.id, { expertNotes: 'Исправлено' })
    expect((await submitVersion(h.sb, v.id)).status).toBe('in_review')
    await expect(rejectVersion(h.sb, v.id, ADMIN, '   ')).rejects.toMatchObject({ code: 'conditions' })
    const d = await setup()
    const draft = await createDraft(d.sb, d.plan, draftInput())
    await expect(rejectVersion(d.sb, draft.id, ADMIN, 'Причина причина')).rejects.toMatchObject({ code: 'bad_state' })
  })

  it('profanity in notes, change reason or reject reason is refused', async () => {
    const h = await setup()
    await expect(createDraft(h.sb, h.plan, draftInput({ changeReason: 'блядь' }))).rejects.toMatchObject({ name: 'ProfanityError' })
    const v = await createDraft(h.sb, h.plan, draftInput())
    await expect(updateDraft(h.sb, v.id, { expertNotes: 'это хуйня' })).rejects.toMatchObject({ name: 'ProfanityError', field: 'expertNotes' })
    await submitVersion(h.sb, v.id)
    await expect(rejectVersion(h.sb, v.id, ADMIN, 'пиздец какой план')).rejects.toMatchObject({ name: 'ProfanityError' })
    expect(h.db.pb_plan_versions[0].status).toBe('in_review')
  })

  it('loadPlanBundle returns nothing for a company without a plan', async () => {
    const { sb } = pbDb()
    expect(await loadPlanBundle(sb, 'nobody')).toEqual({ plan: null, versions: [], open: null, published: null })
  })

  it('loadPlanBundle returns versions newest first with the open and the published version', async () => {
    const h = await setup()
    const v1 = await inReview(h)
    await approveVersion(h.sb, v1.id, ADMIN)
    const v2 = await createDraft(h.sb, h.plan, draftInput({ changeReason: 'Пересмотр' }))
    const bundle = await loadPlanBundle(h.sb, COMPANY)
    expect(bundle.plan?.id).toBe(h.plan.id)
    expect(bundle.versions.map((v) => v.version)).toEqual([2, 1])
    expect(bundle.open?.id).toBe(v2.id)
    expect(bundle.published?.id).toBe(v1.id)
  })

  it('loadPlanBundle falls back to the latest approved version if published_version_id is stale', async () => {
    const h = await setup()
    const v1 = await inReview(h)
    await approveVersion(h.sb, v1.id, ADMIN)
    h.db.pb_plans[0].published_version_id = null // e.g. a crash between the two writes
    expect((await loadPlanBundle(h.sb, COMPANY)).published?.id).toBe(v1.id)
  })
})

