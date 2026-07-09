/**
 * tests/unit/assistant-mascot/triggers.test.ts — the anti-annoyance engine
 * (docs/TZ-mascot-assistant.md §9, §18.1).
 */

import { describe, expect, it } from 'vitest'
import type { ResolvedHint } from '@/lib/assistant/mascot/hints'
import {
  EMPTY_COOLDOWNS,
  pickHint,
  pruneCooldowns,
  registerClosed,
  registerShown,
  RULES,
  type CooldownState,
  type PickInput,
} from '@/lib/assistant/mascot/triggers'
import { DEFAULT_MASCOT_SETTINGS } from '@/lib/assistant/mascot/types'

const T0 = 1_700_000_000_000

function hint(over: Partial<ResolvedHint> = {}): ResolvedHint {
  return {
    id: 'test_hint',
    type: 'next_step',
    state: 'hint',
    priority: 2,
    screens: [],
    mutable: false,
    text: 'test',
    actions: [],
    ...over,
  }
}

function input(over: Partial<PickInput> = {}): PickInput {
  return {
    now: T0,
    screen: '/dashboard',
    candidates: [hint()],
    cooldowns: EMPTY_COOLDOWNS,
    settings: { ...DEFAULT_MASCOT_SETTINGS },
    sessionShownCount: 0,
    ...over,
  }
}

describe('pickHint — frequency switch', () => {
  it('returns null when hints are off', () => {
    expect(
      pickHint(input({ settings: { ...DEFAULT_MASCOT_SETTINGS, hintFrequency: 'off' } })),
    ).toBeNull()
  })
})

describe('pickHint — session cap', () => {
  it(`allows up to ${RULES.sessionMax} per session, then stops`, () => {
    expect(pickHint(input({ sessionShownCount: RULES.sessionMax - 1 }))).not.toBeNull()
    expect(pickHint(input({ sessionShownCount: RULES.sessionMax }))).toBeNull()
  })

  it('rare frequency lowers the cap', () => {
    const settings = { ...DEFAULT_MASCOT_SETTINGS, hintFrequency: 'rare' as const }
    expect(pickHint(input({ settings, sessionShownCount: RULES.rareSessionMax }))).toBeNull()
  })
})

describe('pickHint — gaps', () => {
  it('blocks inside the global gap and allows after it', () => {
    const shown = registerShown(EMPTY_COOLDOWNS, 'other', '/gri', T0)
    // Inside the 90s global window (different hint, different screen) — blocked.
    expect(
      pickHint(input({ cooldowns: shown, now: T0 + RULES.globalGapMs - 1_000 })),
    ).toBeNull()
    // After the global window — allowed (different screen keeps per-screen clear).
    expect(
      pickHint(input({ cooldowns: shown, now: T0 + RULES.globalGapMs + 1_000 })),
    ).not.toBeNull()
  })

  it('blocks the SAME screen for perScreenGapMs even after the global gap', () => {
    const shown = registerShown(EMPTY_COOLDOWNS, 'other', '/dashboard', T0)
    const now = T0 + RULES.globalGapMs + 1_000 // global passed, per-screen not
    expect(pickHint(input({ cooldowns: shown, now, screen: '/dashboard' }))).toBeNull()
    expect(
      pickHint(input({ cooldowns: shown, now: T0 + RULES.perScreenGapMs + 1_000 })),
    ).not.toBeNull()
  })

  it('rare frequency multiplies the gaps', () => {
    const settings = { ...DEFAULT_MASCOT_SETTINGS, hintFrequency: 'rare' as const }
    const shown = registerShown(EMPTY_COOLDOWNS, 'other', '/gri', T0)
    const afterNormalGap = T0 + RULES.globalGapMs + 1_000
    expect(pickHint(input({ settings, cooldowns: shown, now: afterNormalGap }))).toBeNull()
    const afterRareGap = T0 + RULES.globalGapMs * RULES.rareGapMultiplier + 1_000
    expect(pickHint(input({ settings, cooldowns: shown, now: afterRareGap }))).not.toBeNull()
  })

  it('repeats the same hint no sooner than 24h', () => {
    const shown = registerShown(EMPTY_COOLDOWNS, 'test_hint', '/gri', T0)
    const nowClear = T0 + RULES.perHintGapMs - 60_000
    expect(pickHint(input({ cooldowns: shown, now: nowClear }))).toBeNull()
    expect(
      pickHint(input({ cooldowns: shown, now: T0 + RULES.perHintGapMs + 1_000 })),
    ).not.toBeNull()
  })

  it('a hint closed with «×» stays away for 7 days', () => {
    const closed = registerClosed(EMPTY_COOLDOWNS, 'test_hint', T0)
    // Well past the 24h repeat window — but still inside the 7d closed window.
    expect(pickHint(input({ cooldowns: closed, now: T0 + 2 * RULES.perHintGapMs }))).toBeNull()
    expect(
      pickHint(input({ cooldowns: closed, now: T0 + RULES.closedGapMs + 1_000 })),
    ).not.toBeNull()
  })
})

describe('pickHint — eligibility', () => {
  it('greeting shows only while not greeted', () => {
    const greeting = hint({ id: 'greeting', type: 'greeting', priority: 0 })
    expect(pickHint(input({ candidates: [greeting] }))?.id).toBe('greeting')
    expect(
      pickHint(
        input({
          candidates: [greeting],
          settings: { ...DEFAULT_MASCOT_SETTINGS, greeted: true },
        }),
      ),
    ).toBeNull()
  })

  it('respects screen restrictions', () => {
    const surveyOnly = hint({ screens: ['/client/onboarding'] })
    expect(pickHint(input({ candidates: [surveyOnly], screen: '/dashboard' }))).toBeNull()
    expect(
      pickHint(input({ candidates: [surveyOnly], screen: '/client/onboarding' })),
    ).not.toBeNull()
    // Sub-paths of an allowed screen also count.
    expect(
      pickHint(input({ candidates: [surveyOnly], screen: '/client/onboarding' })),
    ).not.toBeNull()
  })

  it('muted types never show', () => {
    const edu = hint({ type: 'education' })
    const settings = { ...DEFAULT_MASCOT_SETTINGS, dismissedHints: ['education'] }
    expect(pickHint(input({ candidates: [edu], settings }))).toBeNull()
  })

  it('picks the highest-priority candidate', () => {
    const err = hint({ id: 'err', type: 'error', priority: 1 })
    const mot = hint({ id: 'mot', type: 'motivation', priority: 5 })
    expect(pickHint(input({ candidates: [mot, err] }))?.id).toBe('err')
  })
})

describe('pickHint — problem class (Батч D)', () => {
  const problem = (over: Partial<ResolvedHint> = {}): ResolvedHint =>
    hint({ id: 'clients_at_risk', type: 'problem', priority: 2, ...over })

  it('uses the short 30s global gap instead of the 90s one', () => {
    const shown = registerShown(EMPTY_COOLDOWNS, 'other', '/gri', T0)
    const now = T0 + RULES.problemGlobalGapMs + 1_000
    // Sanity: still inside the normal 90s window a regular hint would be blocked by.
    expect(now - T0).toBeLessThan(RULES.globalGapMs)
    expect(pickHint(input({ candidates: [problem()], cooldowns: shown, now }))?.id).toBe(
      'clients_at_risk',
    )
    // A regular hint at the same instant is still blocked by the 90s gap.
    expect(pickHint(input({ candidates: [hint()], cooldowns: shown, now }))).toBeNull()
    // Before even the 30s problem gap → blocked.
    expect(
      pickHint(
        input({
          candidates: [problem()],
          cooldowns: shown,
          now: T0 + RULES.problemGlobalGapMs - 1_000,
        }),
      ),
    ).toBeNull()
  })

  it('bypasses the session cap for the first problemSessionBudget shows, then respects it', () => {
    const atCap = { sessionShownCount: RULES.sessionMax }
    expect(
      pickHint(input({ candidates: [problem()], ...atCap, problemShownCount: 0 })),
    ).not.toBeNull()
    expect(
      pickHint(
        input({ candidates: [problem()], ...atCap, problemShownCount: RULES.problemSessionBudget - 1 }),
      ),
    ).not.toBeNull()
    // Budget spent → the problem hint respects the session cap like any other.
    expect(
      pickHint(
        input({ candidates: [problem()], ...atCap, problemShownCount: RULES.problemSessionBudget }),
      ),
    ).toBeNull()
    // A non-problem hint never gets the exemption.
    expect(pickHint(input({ candidates: [hint()], ...atCap }))).toBeNull()
  })
})

describe('cooldown state transitions', () => {
  it('registerShown stamps global, per-hint and per-screen', () => {
    const c = registerShown(EMPTY_COOLDOWNS, 'h1', '/gri', T0)
    expect(c.lastGlobalAt).toBe(T0)
    expect(c.perHint.h1).toBe(T0)
    expect(c.perScreen['/gri']).toBe(T0)
  })

  it('pruneCooldowns drops entries older than their windows', () => {
    const stale: CooldownState = {
      lastGlobalAt: T0,
      perHint: { old: T0 - RULES.perHintGapMs - 1, fresh: T0 },
      perScreen: { '/old': T0 - RULES.perScreenGapMs - 1, '/fresh': T0 },
      closed: { old: T0 - RULES.closedGapMs - 1, fresh: T0 },
    }
    const pruned = pruneCooldowns(stale, T0)
    expect(pruned.perHint).toEqual({ fresh: T0 })
    expect(pruned.perScreen).toEqual({ '/fresh': T0 })
    expect(pruned.closed).toEqual({ fresh: T0 })
  })
})
