import { describe, it, expect, beforeEach } from 'vitest'
import {
  DRAFT_PREFIX,
  clearAllDrafts,
  draftKey,
  mergeServerAndDraft,
  parseStepParam,
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

describe('parseStepParam (?step=N deep link from «Мои данные»)', () => {
  it('accepts 1..12 only', () => {
    expect(parseStepParam('9')).toBe(9)
    expect(parseStepParam('0')).toBeNull()
    expect(parseStepParam('13')).toBeNull()
    expect(parseStepParam('abc')).toBeNull()
    expect(parseStepParam(null)).toBeNull()
  })
})
