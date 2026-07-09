import { describe, it, expect } from 'vitest'
import {
  selectNextBestAction,
  NBA_BASE_WEIGHTS,
  type NbaSignal,
} from '@/lib/nba/select'

function signal(over: Partial<NbaSignal> & Pick<NbaSignal, 'key'>): NbaSignal {
  return {
    actionKey: over.key,
    active: true,
    title: `do ${over.key}`,
    reason: 'because',
    cta: { label: 'Открыть', href: '/' },
    source: { type: over.key },
    ...over,
  }
}

describe('selectNextBestAction — single main action', () => {
  it('returns the highest-weighted active signal', () => {
    const a = selectNextBestAction([
      signal({ key: 'red_zone', actionKey: 'red_zone:sales' }),
      signal({ key: 'crm_overdue', actionKey: 'crm_overdue' }),
    ])
    expect(a?.key).toBe('crm_overdue') // 90 > 85
    expect(a?.score).toBe(NBA_BASE_WEIGHTS.crm_overdue)
  })

  it('returns exactly one action or null, never a list (invariant, test #18)', () => {
    const many = (['crm_overdue', 'red_zone', 'gri_limit', 'survey_incomplete', 'plan_task', 'pulse_stale'] as const)
      .map((key) => signal({ key, actionKey: key }))
    const a = selectNextBestAction(many)
    // The public contract is a single object (or null) — not an array.
    expect(Array.isArray(a)).toBe(false)
    expect(a).not.toBeNull()
    expect(a?.key).toBe('crm_overdue')
  })

  it('returns null when there are no active signals', () => {
    expect(selectNextBestAction([])).toBeNull()
    expect(selectNextBestAction([signal({ key: 'red_zone', active: false })])).toBeNull()
  })
})

describe('selectNextBestAction — cooldowns', () => {
  it('suppresses a dismissed action (72h cooldown) so the next one wins', () => {
    const a = selectNextBestAction(
      [
        signal({ key: 'crm_overdue', actionKey: 'crm_overdue' }),
        signal({ key: 'red_zone', actionKey: 'red_zone:sales' }),
      ],
      undefined,
      { dismissedWithinCooldown: (k) => k === 'crm_overdue' },
    )
    expect(a?.key).toBe('red_zone')
  })

  it('returns null when every candidate is in cooldown', () => {
    const a = selectNextBestAction(
      [signal({ key: 'crm_overdue', actionKey: 'crm_overdue' })],
      undefined,
      { dismissedWithinCooldown: () => true },
    )
    expect(a).toBeNull()
  })

  it('suppresses a recently completed action (7d cooldown)', () => {
    const a = selectNextBestAction(
      [signal({ key: 'plan_task', actionKey: 'plan_task:42' })],
      undefined,
      { completedWithinCooldown: (k) => k === 'plan_task:42' },
    )
    expect(a).toBeNull()
  })
})

describe('selectNextBestAction — modifiers', () => {
  it('applies the stage boost (seed lifts onboarding-ish signals)', () => {
    const a = selectNextBestAction([signal({ key: 'survey_incomplete', actionKey: 'survey_incomplete' })], { stage: 'seed' })
    expect(a?.score).toBe(NBA_BASE_WEIGHTS.survey_incomplete + 10)
  })

  it('adds a small goal-alignment boost', () => {
    const a = selectNextBestAction(
      [signal({ key: 'gri_limit', actionKey: 'gri_limit:c1' })],
      { goalAlignedKeys: ['gri_limit'] },
    )
    expect(a?.score).toBe(NBA_BASE_WEIGHTS.gri_limit + 5)
  })

  it('clamps the psych boost to at most +10 (never lets personalization dominate)', () => {
    const a = selectNextBestAction(
      [signal({ key: 'crm_overdue', actionKey: 'crm_overdue' })],
      { psychBoost: { crm_overdue: 50 } },
    )
    expect(a?.score).toBe(NBA_BASE_WEIGHTS.crm_overdue + 10)
  })

  it('breaks ties by fixed signal priority (earlier signal wins)', () => {
    // Equalize gri_limit(80)+5 goal = 85 to tie red_zone(85); red_zone is higher priority.
    const a = selectNextBestAction(
      [
        signal({ key: 'gri_limit', actionKey: 'gri_limit:c1' }),
        signal({ key: 'red_zone', actionKey: 'red_zone:sales' }),
      ],
      { goalAlignedKeys: ['gri_limit'] },
    )
    expect(a?.score).toBe(85)
    expect(a?.key).toBe('red_zone')
  })
})

describe('selectNextBestAction — count bonus', () => {
  it('adds a bounded bonus for repeated instances (e.g. several overdue reminders)', () => {
    const base = NBA_BASE_WEIGHTS.crm_overdue
    const one = selectNextBestAction([signal({ key: 'crm_overdue', actionKey: 'crm_overdue', count: 1 })])
    const three = selectNextBestAction([signal({ key: 'crm_overdue', actionKey: 'crm_overdue', count: 3 })])
    const many = selectNextBestAction([signal({ key: 'crm_overdue', actionKey: 'crm_overdue', count: 50 })])
    expect(one?.score).toBe(base)
    expect(three?.score).toBe(base + 4) // +2 per extra instance
    expect(many?.score).toBe(base + 10) // capped at +10
  })
})
