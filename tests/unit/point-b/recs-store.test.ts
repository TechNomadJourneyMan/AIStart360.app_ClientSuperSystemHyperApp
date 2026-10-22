/**
 * Point B Ф6a, Task 3: the recommendation store (pb_recommendations) and the verification by an expert.
 * In-memory DB with the column names of migration 129.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { ProfanityError } from '@/lib/moderation/profanity'
import {
  clientView, createExpertRecommendation, createRecommendations, editRecommendation, listRecommendations, markStale, RecError,
  rejectRecommendation, topVerifiedWithAction, verifyRecommendation, type RecItemInput,
} from '@/lib/point-b/recs/store'
import type { Recommendation } from '@/lib/point-b/recs/types'
import { pbDb } from './_pbdb'

const COMPANY = 'company-1'
const OTHER = 'company-2'
const EXPERT = { id: 'eeeeeeee-0000-4000-8000-000000000001', name: 'Алия Эксперт', specialty: 'Финансы' }
const NOW = new Date('2026-10-22T10:00:00Z')

let h: ReturnType<typeof pbDb>
beforeEach(() => { h = pbDb() })
const rows = () => h.db.pb_recommendations as Array<Record<string, unknown>>

const item = (over: Partial<RecItemInput> = {}): RecItemInput => ({
  kind: 'lever', title: 'Поднять конверсию', essence: 'Суть', reason: 'Причина', expectedEffect: null, resources: null,
  confidence: 'medium', confidenceReason: null, risks: null, nextAction: 'Собрать скрипт продаж', sourceRefs: [{ type: 'metric', ref: 'biz.marketing.konversiya_lid_klient', label: 'Конверсия' }],
  generatedBy: 'ai', inputsHash: 'h1', ...over,
})
async function one(over: Partial<RecItemInput> = {}, companyId = COMPANY): Promise<Recommendation> {
  const [r] = await createRecommendations(h.sb, { companyId, versionId: null, items: [item(over)] })
  return r
}
const err = async (p: Promise<unknown>): Promise<RecError> => {
  try { await p } catch (e) { return e as RecError }
  throw new Error('expected a rejection')
}

describe('recommendation store', () => {
  it('createRecommendations stores pending_review, masks profanity, trims lengths and skips a live duplicate', async () => {
    const created = await createRecommendations(h.sb, {
      companyId: COMPANY, versionId: 'v-1',
      items: [
        item({ title: '  Поднять конверсию  ', essence: 'Это полная хуйня, а не воронка', reason: 'x'.repeat(2500) }),
        item({ title: 'поднять   КОНВЕРСИЮ' }), // the same (title, hash, kind) in the batch
        item({ title: '   ' }), // no title → dropped
        item({ kind: 'oops' as never, title: 'Неизвестный вид' }),
      ],
    })
    expect(created).toHaveLength(1)
    const r = created[0]
    expect(r).toMatchObject({ companyId: COMPANY, versionId: 'v-1', status: 'pending_review', generatedBy: 'ai', recVersion: 1, title: 'Поднять конверсию', inputsHash: 'h1' })
    expect(r.essence).toBe('Это полная х****, а не воронка')
    expect(r.reason.length).toBe(2000)
    expect(r.reviewerName).toBeNull()
    expect(rows()[0]).toMatchObject({ company_id: COMPANY, status: 'pending_review', generated_by: 'ai', rec_version: 1 })

    // a live duplicate (pending or verified) is skipped; another hash or kind is not a duplicate
    expect(await createRecommendations(h.sb, { companyId: COMPANY, versionId: null, items: [item()] })).toEqual([])
    await verifyRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'План v1' })
    expect(await createRecommendations(h.sb, { companyId: COMPANY, versionId: null, items: [item()] })).toEqual([])
    expect(await createRecommendations(h.sb, { companyId: COMPANY, versionId: null, items: [item({ inputsHash: 'h2' }), item({ kind: 'risk' })] })).toHaveLength(2)
    // the same title of another company is not a duplicate
    expect(await one({}, OTHER)).toBeTruthy()
    // a rule can never create a verified one: status is always pending_review
    const forced = await one({ title: 'Попытка', status: 'expert_verified' as never })
    expect(forced.status).toBe('pending_review')
  })

  it('verify requires the reviewer name and the scope note and writes reviewer, specialty, date, scope and comment', async () => {
    const r = await one()
    expect((await err(verifyRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: { ...EXPERT, name: ' ' }, scopeNote: 'План v1' })))).toMatchObject({ code: 'invalid', field: 'reviewerName' })
    expect((await err(verifyRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: '  ' })))).toMatchObject({ code: 'invalid', field: 'scopeNote' })
    const dirty = await err(verifyRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'План v1', comment: 'сука' }))
    expect(dirty).toBeInstanceOf(ProfanityError)
    expect((dirty as unknown as ProfanityError).field).toBe('comment')
    expect(rows()[0].status).toBe('pending_review')

    const v = await verifyRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'Для плана v2, данные на 22.10.2026', comment: 'Согласна', now: NOW })
    expect(v).toMatchObject({
      status: 'expert_verified', reviewerName: 'Алия Эксперт', reviewerSpecialty: 'Финансы', reviewedAt: NOW.toISOString(),
      scopeNote: 'Для плана v2, данные на 22.10.2026', reviewComment: 'Согласна', recVersion: 1,
    })
    expect(rows()[0]).toMatchObject({ reviewer_id: EXPERT.id, reviewer_name: 'Алия Эксперт', reviewer_specialty: 'Финансы' })
  })

  it('two concurrent verifies: exactly one succeeds, the second is bad_state', async () => {
    const r = await one()
    const results = await Promise.allSettled([
      verifyRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'A' }),
      verifyRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: { id: 'x2', name: 'Второй', specialty: null }, scopeNote: 'B' }),
    ])
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((x) => x.status === 'rejected') as PromiseRejectedResult
    expect(lost.reason).toBeInstanceOf(RecError)
    expect(lost.reason.code).toBe('bad_state')
    expect(rows()[0].scope_note).toBe('A')
  })

  it('verifying an already verified or rejected recommendation is bad_state', async () => {
    const a = await one({ title: 'A' })
    await verifyRecommendation(h.sb, { id: a.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'S' })
    expect((await err(verifyRecommendation(h.sb, { id: a.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'S' }))).code).toBe('bad_state')
    const b = await one({ title: 'B' })
    await rejectRecommendation(h.sb, { id: b.id, companyId: COMPANY, reviewer: EXPERT, comment: 'Не подходит' })
    expect((await err(verifyRecommendation(h.sb, { id: b.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'S' }))).code).toBe('bad_state')
    expect((await err(rejectRecommendation(h.sb, { id: a.id, companyId: COMPANY, reviewer: EXPERT, comment: 'Поздно' }))).code).toBe('bad_state')
  })

  it('reject requires a comment', async () => {
    const r = await one()
    expect(await err(rejectRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: EXPERT, comment: '  ' }))).toMatchObject({ code: 'invalid', field: 'comment' })
    const x = await rejectRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: EXPERT, comment: 'Числа устарели', now: NOW })
    expect(x).toMatchObject({ status: 'expert_rejected', reviewComment: 'Числа устарели', reviewerName: 'Алия Эксперт', reviewedAt: NOW.toISOString() })
  })

  it('edit creates rec_version + 1 as pending_review and makes the old one stale with supersedes_id', async () => {
    const r = await one()
    const v = await verifyRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'План v1' })
    const edited = await editRecommendation(h.sb, { id: v.id, companyId: COMPANY, patch: { title: 'Поднять конверсию до плана', risks: 'Нужен найм' }, editor: EXPERT })
    expect(edited).toMatchObject({ status: 'pending_review', recVersion: 2, supersedesId: v.id, title: 'Поднять конверсию до плана', risks: 'Нужен найм', essence: 'Суть', reviewerName: null, generatedBy: 'ai' })
    expect(edited.id).not.toBe(v.id)
    const old = rows().find((x) => x.id === v.id)!
    expect(old.status).toBe('stale')
    // a stale one cannot be edited again (the new version is the live one); a concurrent second edit lost
    expect((await err(editRecommendation(h.sb, { id: v.id, companyId: COMPANY, patch: { title: 'X' }, editor: EXPERT }))).code).toBe('bad_state')
    // profanity in the patch → ProfanityError with the field, nothing written
    const before = rows().length
    const dirty = await err(editRecommendation(h.sb, { id: edited.id, companyId: COMPANY, patch: { nextAction: 'да похуй' }, editor: EXPERT }))
    expect((dirty as unknown as ProfanityError).field).toBe('nextAction')
    expect(rows().length).toBe(before)
    // an empty title is invalid
    expect(await err(editRecommendation(h.sb, { id: edited.id, companyId: COMPANY, patch: { title: ' ' }, editor: EXPERT }))).toMatchObject({ code: 'invalid', field: 'title' })
  })

  it('markStale moves verified and pending recommendations with another hash to stale and leaves rejected ones', async () => {
    const pending = await one({ title: 'P', inputsHash: 'old' })
    const verified = await one({ title: 'V', inputsHash: 'old' })
    await verifyRecommendation(h.sb, { id: verified.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'S' })
    const rejected = await one({ title: 'R', inputsHash: 'old' })
    await rejectRecommendation(h.sb, { id: rejected.id, companyId: COMPANY, reviewer: EXPERT, comment: 'нет' })
    const current = await one({ title: 'C', inputsHash: 'new' })
    const expert = await createExpertRecommendation(h.sb, { companyId: COMPANY, versionId: null, draft: { kind: 'action', title: 'E' }, reviewer: EXPERT, scopeNote: 'S' })
    const foreign = await one({ title: 'F', inputsHash: 'old' }, OTHER)

    expect(await markStale(h.sb, COMPANY, 'new')).toBe(2)
    const status = (id: string) => rows().find((x) => x.id === id)!.status
    expect(status(pending.id)).toBe('stale')
    expect(status(verified.id)).toBe('stale')
    expect(status(rejected.id)).toBe('expert_rejected')
    expect(status(current.id)).toBe('pending_review')
    expect(status(expert.id)).toBe('expert_verified') // no hash: nothing to compare
    expect(status(foreign.id)).toBe('pending_review')
  })

  it('createExpertRecommendation is verified at once with the expert as reviewer', async () => {
    const r = await createExpertRecommendation(h.sb, {
      companyId: COMPANY, versionId: 'v-2', reviewer: EXPERT, scopeNote: 'Для плана v2', now: NOW,
      draft: { kind: 'risk', title: 'Кассовый риск', essence: 'Суть', nextAction: 'Отложить закупку' },
    })
    expect(r).toMatchObject({ status: 'expert_verified', generatedBy: 'expert', reviewerName: 'Алия Эксперт', reviewerSpecialty: 'Финансы', reviewedAt: NOW.toISOString(), scopeNote: 'Для плана v2', versionId: 'v-2' })
    const dirty = await err(createExpertRecommendation(h.sb, { companyId: COMPANY, versionId: null, reviewer: EXPERT, scopeNote: null, draft: { kind: 'risk', title: 'Блядь' } }))
    expect((dirty as unknown as ProfanityError).field).toBe('title')
    expect(await err(createExpertRecommendation(h.sb, { companyId: COMPANY, versionId: null, reviewer: EXPERT, scopeNote: null, draft: { kind: 'risk', title: '' } }))).toMatchObject({ code: 'invalid', field: 'title' })
  })

  it('clientView shows verified and previously-verified stale, counts pending, hides rejected and never-verified stale', async () => {
    const verified = await one({ title: 'V' })
    await verifyRecommendation(h.sb, { id: verified.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'S', now: new Date('2026-10-20T00:00:00Z') })
    const staleVerified = await one({ title: 'SV', inputsHash: 'old' })
    await verifyRecommendation(h.sb, { id: staleVerified.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'S', now: new Date('2026-10-21T00:00:00Z') })
    await one({ title: 'SP', inputsHash: 'old' }) // pending → becomes a never-verified stale
    await markStale(h.sb, COMPANY, 'h1')
    await one({ title: 'P1' })
    await one({ title: 'P2' })
    const rej = await one({ title: 'R' })
    await rejectRecommendation(h.sb, { id: rej.id, companyId: COMPANY, reviewer: EXPERT, comment: 'нет' })

    const view = clientView(await listRecommendations(h.sb, COMPANY))
    expect(view.pendingCount).toBe(2)
    expect(view.verified.map((v) => [v.title, v.state])).toEqual([['V', 'verified'], ['SV', 'stale']])
    expect(view.verified[0]).toMatchObject({ reviewerName: 'Алия Эксперт', reviewerSpecialty: 'Финансы', scopeNote: 'S', reviewedAt: '2026-10-20T00:00:00.000Z' })
    // the client never gets the internal fields
    for (const v of view.verified) {
      expect(Object.keys(v)).not.toEqual(expect.arrayContaining(['status']))
      expect(v).not.toHaveProperty('generatedBy')
      expect(v).not.toHaveProperty('reviewComment')
      expect(v).not.toHaveProperty('inputsHash')
    }
    // a verified rec replaced by a NEWER verified version is not shown twice
    const edited = await editRecommendation(h.sb, { id: verified.id, companyId: COMPANY, patch: { title: 'V2' }, editor: EXPERT })
    let again = clientView(await listRecommendations(h.sb, COMPANY))
    expect(again.verified.map((v) => [v.title, v.state])).toEqual([['SV', 'stale'], ['V', 'stale']]) // newest review first
    expect(again.pendingCount).toBe(3)
    await verifyRecommendation(h.sb, { id: edited.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'S2', now: new Date('2026-10-22T00:00:00Z') })
    again = clientView(await listRecommendations(h.sb, COMPANY))
    expect(again.verified.map((v) => [v.title, v.state])).toEqual([['V2', 'verified'], ['SV', 'stale']])
    // JSON-safe
    expect(JSON.parse(JSON.stringify(again))).toEqual(again)
    // «Следующий шаг»: the verified one with a next action
    expect(topVerifiedWithAction(await listRecommendations(h.sb, COMPANY))?.title).toBe('V2')
  })

  it('a recommendation of another company is not_found', async () => {
    const r = await one({}, OTHER)
    expect((await err(verifyRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: EXPERT, scopeNote: 'S' }))).code).toBe('not_found')
    expect((await err(rejectRecommendation(h.sb, { id: r.id, companyId: COMPANY, reviewer: EXPERT, comment: 'нет' }))).code).toBe('not_found')
    expect((await err(editRecommendation(h.sb, { id: r.id, companyId: COMPANY, patch: { title: 'X' }, editor: EXPERT }))).code).toBe('not_found')
    expect((await err(verifyRecommendation(h.sb, { id: 'missing', companyId: COMPANY, reviewer: EXPERT, scopeNote: 'S' }))).code).toBe('not_found')
    expect(rows().find((x) => x.id === r.id)!.status).toBe('pending_review')
  })
})
