import { describe, it, expect, beforeEach } from 'vitest'
import {
  DRAFT_PREFIX,
  clearAllDrafts,
  draftKey,
  mergeServerAndDraft,
  parseStepParam,
  updatedAtOf,
  readDraft,
  writeDraft,
} from '@/lib/survey/draft'

class MemStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null }
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
  keys() { return Array.from(this.m.keys()) }
}

let ls: MemStorage
beforeEach(() => { ls = new MemStorage() })

describe('survey draft (E2E 2026-09-10 P0: cross-user leak, stale overwrite)', () => {
  it('is scoped per user: user B never sees user A\'s draft', () => {
    writeDraft(ls, 'user-a', 3, { s1_company_name: 'ТОО Альфа' })
    expect(readDraft(ls, 'user-b')).toBeNull()
    expect(readDraft(ls, 'user-a')?.dirty).toEqual({ s1_company_name: 'ТОО Альфа' })
  })

  it('drops the legacy global draft that cannot be attributed to a user', () => {
    ls.setItem(DRAFT_PREFIX, JSON.stringify({ current_step: 5, answers: { s1_company_name: 'чужая компания' } }))
    expect(readDraft(ls, 'user-b')).toBeNull()
    expect(ls.getItem(DRAFT_PREFIX)).toBeNull()
  })

  it('rejects a draft whose embedded user_id does not match the key owner', () => {
    ls.setItem(draftKey('user-b'), JSON.stringify({ v: 2, user_id: 'user-a', current_step: 2, dirty: { x: 1 }, saved_at: '' }))
    expect(readDraft(ls, 'user-b')).toBeNull()
  })

  it('server wins; only unsaved edits are laid on top', () => {
    // Point B changed revenue on the server to 7M; the draft only holds an unrelated unsaved edit.
    const server = { s1_current_revenue_month: 7_000_000, s1_company_name: 'ТОО Альфа' }
    writeDraft(ls, 'u', 4, { s4_departments_count: 5 })
    const { answers, dirtyKeys } = mergeServerAndDraft(server, readDraft(ls, 'u'))
    expect(answers.s1_current_revenue_month).toBe(7_000_000)
    expect(answers.s4_departments_count).toBe(5)
    expect(dirtyKeys).toEqual(['s4_departments_count'])
  })

  it('clamps a bad current_step and clears every draft on logout', () => {
    ls.setItem(draftKey('u'), JSON.stringify({ v: 2, user_id: 'u', current_step: 99, dirty: {}, saved_at: '' }))
    expect(readDraft(ls, 'u')?.current_step).toBe(1)
    writeDraft(ls, 'a', 1, { k: 1 })
    writeDraft(ls, 'b', 1, { k: 1 })
    ls.setItem('aistart360_rq_cache', 'keep-me')
    clearAllDrafts(ls)
    expect(ls.keys()).toEqual(['aistart360_rq_cache'])
  })
})

describe('stale draft protection (survey modes, spec §6.1 / §14.2)', () => {
  const T = (min: number) => new Date(Date.UTC(2026, 9, 23, 10, min)).toISOString()

  it('an answer changed on the server after the edit started wins; the key is stale', () => {
    // The full form edited «выручка» from the server answer of 10:00; the express flow saved it at 10:20.
    writeDraft(ls, 'u', 1, { s1_current_revenue_month: 4_000_000, s6_main_pain: 'нет людей' }, { s1_current_revenue_month: T(0), s6_main_pain: null })
    const server = { s1_current_revenue_month: 5_500_000 }
    const { answers, dirtyKeys, staleKeys } = mergeServerAndDraft(server, readDraft(ls, 'u'), { s1_current_revenue_month: T(20) })
    expect(answers.s1_current_revenue_month).toBe(5_500_000)
    expect(staleKeys).toEqual(['s1_current_revenue_month'])
    // A key the server never answered keeps the draft.
    expect(answers.s6_main_pain).toBe('нет людей')
    expect(dirtyKeys).toEqual(['s6_main_pain'])
  })

  it('the server answer the edit started from (or our own save, seconds apart) keeps the draft', () => {
    writeDraft(ls, 'u', 1, { s1_current_revenue_month: 4_000_000 }, { s1_current_revenue_month: T(0) })
    const same = mergeServerAndDraft({ s1_current_revenue_month: 3_000_000 }, readDraft(ls, 'u'), { s1_current_revenue_month: T(0) })
    expect(same.answers.s1_current_revenue_month).toBe(4_000_000)
    expect(same.staleKeys).toEqual([])
    const ownSave = mergeServerAndDraft({ s1_current_revenue_month: 3_000_000 }, readDraft(ls, 'u'), { s1_current_revenue_month: new Date(Date.parse(T(0)) + 2000).toISOString() })
    expect(ownSave.staleKeys).toEqual([])
  })

  it('no answer when the edit started, one on the server now → stale', () => {
    writeDraft(ls, 'u', 1, { s3_deal_cycle_days: 30 }, { s3_deal_cycle_days: null })
    const r = mergeServerAndDraft({ s3_deal_cycle_days: 14 }, readDraft(ls, 'u'), { s3_deal_cycle_days: T(5) })
    expect(r.answers.s3_deal_cycle_days).toBe(14)
    expect(r.staleKeys).toEqual(['s3_deal_cycle_days'])
  })

  it('a v2 draft (no base) is compared by its own save time', () => {
    ls.setItem(draftKey('u'), JSON.stringify({ v: 2, user_id: 'u', current_step: 2, dirty: { a: 1, b: 2 }, saved_at: T(10) }))
    const r = mergeServerAndDraft({ a: 9, b: 8 }, readDraft(ls, 'u'), { a: T(15), b: T(5) })
    expect(r.answers).toEqual({ a: 9, b: 2 })
    expect(r.staleKeys).toEqual(['a'])
  })

  it('without server times nothing changes (old behaviour)', () => {
    writeDraft(ls, 'u', 1, { a: 1 }, { a: T(0) })
    expect(mergeServerAndDraft({ a: 2 }, readDraft(ls, 'u')).answers.a).toBe(1)
  })

  it('updatedAtOf reads the attribution map', () => {
    expect(updatedAtOf({ a: { updatedAt: T(1) }, b: { updatedAt: null }, c: undefined })).toEqual({ a: T(1), b: null, c: null })
  })
})

describe('parseStepParam (?step=N deep link from «Мои данные»)', () => {
  it('accepts 1..12 only', () => {
    expect(parseStepParam('9')).toBe(9)
    expect(parseStepParam('0')).toBeNull()
    expect(parseStepParam('13')).toBeNull()
    expect(parseStepParam('abc')).toBeNull()
    expect(parseStepParam(null)).toBeNull()
  })
})
