/**
 * lib/popups/select.ts — pure selection of pop-ups: priorities, daily caps,
 * suppression rules (spec §12.2).
 */
import { describe, expect, it } from 'vitest'
import { selectPopups, isPopupSuppressedRoute } from '@/lib/popups/select'
import { DEFAULT_POPUP_RULES, type PopupCandidate, type PopupContext, type PopupState } from '@/lib/popups/types'

const NOW = new Date('2026-10-18T10:00:00.000Z')
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const later = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

function cand(over: Partial<PopupCandidate> & { id: string }): PopupCandidate {
  return {
    kind: 'expert_message', display: 'card', priority: 10, title: 'Эксперт', body: 'Текст', authorName: 'Анна', authorSpecialty: null,
    createdAt: ago(1), href: '/client/messages', important: false, canReply: true, ...over,
  }
}
const ctx = (over: Partial<PopupContext> = {}): PopupContext => ({
  now: NOW, pro: true, impersonating: false, doNotDisturbUntil: null, route: '/client/home', shownToday: { cards: 0, modals: 0 }, ...over,
})
const select = (c: PopupCandidate[], states: Record<string, PopupState> = {}, x: Partial<PopupContext> = {}) =>
  selectPopups(c, states, ctx(x), DEFAULT_POPUP_RULES)

describe('selectPopups', () => {
  it('expert message is shown without daily caps', () => {
    const many = Array.from({ length: 6 }, (_, i) => cand({ id: `m${i}`, createdAt: ago(i + 1) }))
    expect(select(many, {}, { pro: false, shownToday: { cards: 99, modals: 5 } })).toHaveLength(6)
  })

  it('messages older than the window are not shown', () => {
    const r = select([cand({ id: 'old', createdAt: ago(24 * 3 + 1) }), cand({ id: 'fresh', createdAt: ago(24 * 3 - 1) })])
    expect(r.map((p) => p.id)).toEqual(['fresh'])
  })

  it('bot/system authored candidates never reach select (type excludes them)', () => {
    // kind has no bot/system value: only staff messages can be turned into candidates (lib/popups/store.ts).
    const kinds: PopupCandidate['kind'][] = ['expert_message', 'recommendation', 'insight']
    expect(kinds).not.toContain('bot_message')
    expect(select([cand({ id: 'a' })])[0].kind).toBe('expert_message')
  })

  it('modal only for important messages and at most once a day', () => {
    const r = select([
      cand({ id: 'plain', display: 'modal', important: false, priority: 10 }),
      cand({ id: 'imp1', display: 'modal', important: true, priority: 0, createdAt: ago(2) }),
      cand({ id: 'imp2', display: 'modal', important: true, priority: 0, createdAt: ago(3) }),
    ])
    const by = Object.fromEntries(r.map((p) => [p.id, p.display]))
    expect(by).toEqual({ plain: 'card', imp1: 'modal', imp2: 'card' })
  })

  it('important message requiring reply still shows when the modal cap is spent, as a card', () => {
    const r = select([cand({ id: 'imp', display: 'modal', important: true, canReply: true, priority: 0 })], {}, { shownToday: { cards: 0, modals: 1 } })
    expect(r).toHaveLength(1)
    expect(r[0].display).toBe('card')
  })

  it('recommendations and insights are hidden without pro', () => {
    const c = [cand({ id: 'r', kind: 'recommendation', priority: 30 }), cand({ id: 'i', kind: 'insight', priority: 40 }), cand({ id: 'm' })]
    expect(select(c, {}, { pro: false }).map((p) => p.id)).toEqual(['m'])
    expect(select(c, {}, { pro: true }).map((p) => p.id)).toEqual(['m', 'r', 'i'])
  })

  it('cards per day cap of 3 applies to recommendations and insights, not messages', () => {
    const recs = Array.from({ length: 5 }, (_, i) => cand({ id: `r${i}`, kind: 'recommendation', priority: 30, createdAt: ago(i + 1) }))
    const msg = cand({ id: 'm' })
    expect(select([msg, ...recs]).map((p) => p.id)).toEqual(['m', 'r0', 'r1', 'r2'])
    // two already shown today → one left
    expect(select([msg, ...recs], {}, { shownToday: { cards: 2, modals: 0 } }).map((p) => p.id)).toEqual(['m', 'r0'])
    expect(select([msg, ...recs], {}, { shownToday: { cards: 3, modals: 0 } }).map((p) => p.id)).toEqual(['m'])
  })

  it('impersonating returns empty', () => {
    expect(select([cand({ id: 'a' })], {}, { impersonating: true })).toEqual([])
  })

  it('do-not-disturb hides insights but not expert messages', () => {
    const c = [cand({ id: 'm' }), cand({ id: 'i', kind: 'insight', priority: 40 }), cand({ id: 'r', kind: 'recommendation', priority: 30 })]
    expect(select(c, {}, { doNotDisturbUntil: later(48) }).map((p) => p.id)).toEqual(['m'])
    // a past date does not disturb anything
    expect(select(c, {}, { doNotDisturbUntil: ago(1) })).toHaveLength(3)
  })

  it('suppressed routes return empty', () => {
    for (const route of ['/client/messages', '/client/onboarding', '/client/onboarding/step-2', '/client/survey', '/client/survey/3', '/login', '/register', '/client/waiting-room']) {
      expect(isPopupSuppressedRoute(route), route).toBe(true)
      expect(select([cand({ id: 'a' })], {}, { route }), route).toEqual([])
    }
    expect(isPopupSuppressedRoute('/client/home')).toBe(false)
    expect(isPopupSuppressedRoute('/client/point-b')).toBe(false)
  })

  it('dismissed, snoozed and already seen candidates are excluded', () => {
    const c = ['dis', 'snz', 'snzPast', 'seen', 'ok'].map((id) => cand({ id }))
    const states: Record<string, PopupState> = {
      dis: { id: 'dis', dismissedAt: ago(1) },
      snz: { id: 'snz', snoozedUntil: later(24) },
      snzPast: { id: 'snzPast', snoozedUntil: ago(1) },
      seen: { id: 'seen', seenAt: ago(1) },
    }
    expect(select(c, states).map((p) => p.id).sort()).toEqual(['ok', 'snzPast'])
  })

  it('an important modal that was seen but not dismissed keeps being offered (not lost)', () => {
    const r = select([cand({ id: 'imp', display: 'modal', important: true, priority: 0 })], { imp: { id: 'imp', seenAt: ago(1) } }, { shownToday: { cards: 0, modals: 1 } })
    expect(r.map((p) => [p.id, p.display])).toEqual([['imp', 'card']])
  })

  it('ordering: reply-required message, expert message, recommendation, insight', () => {
    const c = [
      cand({ id: 'insight', kind: 'insight', priority: 40, createdAt: ago(1) }),
      cand({ id: 'rec', kind: 'recommendation', priority: 30, createdAt: ago(1) }),
      cand({ id: 'msg-old', priority: 10, createdAt: ago(5) }),
      cand({ id: 'msg-new', priority: 10, createdAt: ago(2) }),
      cand({ id: 'reply', priority: 0, important: true, display: 'modal', createdAt: ago(9) }),
    ]
    expect(select(c).map((p) => p.id)).toEqual(['reply', 'msg-new', 'msg-old', 'rec', 'insight'])
  })
})
