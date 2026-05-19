import { describe, it, expect } from 'vitest'
import {
  WEIGHT_PROFILES,
  pickWeightProfile,
  applyWeights,
  validateWeights,
  type Block,
} from '@/lib/point-a/weights'

const BLOCKS: Block[] = ['finance', 'sales', 'operations', 'marketing', 'strategy']

describe('WEIGHT_PROFILES', () => {
  it('contains at least 12 profiles', () => {
    expect(WEIGHT_PROFILES.length).toBeGreaterThanOrEqual(12)
  })

  it('every profile has weights summing to 1.0 ± 0.001', () => {
    for (const p of WEIGHT_PROFILES) {
      const sum = BLOCKS.reduce((acc, b) => acc + p.weights[b], 0)
      expect(
        Math.abs(sum - 1),
        `profile ${p.industry}×${p.stage} sums to ${sum}`,
      ).toBeLessThanOrEqual(0.001)
    }
  })

  it('every profile defines all five blocks with finite, non-negative numbers', () => {
    for (const p of WEIGHT_PROFILES) {
      for (const b of BLOCKS) {
        const v = p.weights[b]
        expect(typeof v, `${p.industry}×${p.stage}.${b}`).toBe('number')
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('every profile has a non-empty Russian rationale string', () => {
    const cyrillic = /[А-Яа-яЁё]/
    for (const p of WEIGHT_PROFILES) {
      expect(p.rationale.length).toBeGreaterThan(0)
      expect(cyrillic.test(p.rationale), `rationale for ${p.industry}×${p.stage}`).toBe(true)
    }
  })

  it('includes the baseline default×all matching the current engine weights', () => {
    const baseline = WEIGHT_PROFILES.find(
      (p) => p.industry === 'default' && p.stage === 'all',
    )
    expect(baseline).toBeDefined()
    expect(baseline!.weights).toEqual({
      finance: 0.30,
      sales: 0.25,
      operations: 0.20,
      marketing: 0.15,
      strategy: 0.10,
    })
  })
})

describe('pickWeightProfile', () => {
  it('returns the retail profile for retail × growth (falls back to retail × all)', () => {
    const profile = pickWeightProfile('retail', 'growth')
    expect(profile.industry).toBe('retail')
  })

  it('returns default × all for unknown industry and stage', () => {
    const profile = pickWeightProfile('unknown', 'unknown')
    expect(profile.industry).toBe('default')
    expect(profile.stage).toBe('all')
  })

  it('returns default × all when both inputs are null', () => {
    const profile = pickWeightProfile(null, null)
    expect(profile.industry).toBe('default')
    expect(profile.stage).toBe('all')
  })

  it('prefers a stage-specific profile over industry × all (b2b_saas × seed)', () => {
    const profile = pickWeightProfile('b2b_saas', 'seed')
    expect(profile.industry).toBe('b2b_saas')
    expect(profile.stage).toBe('seed')
    // Stage-specific override: marketing should be 0.10
    expect(profile.weights.marketing).toBeCloseTo(0.10, 5)
    expect(profile.weights.strategy).toBeCloseTo(0.25, 5)
  })

  it('falls back to default × stage when industry lacks a profile but stage exists', () => {
    // 'services' has only services × all; default × seed exists.
    // Resolution prefers same-industry × all over default × stage, so verify services × seed -> services × all.
    const profile = pickWeightProfile('services', 'seed')
    expect(profile.industry).toBe('services')
    expect(profile.stage).toBe('all')
  })

  it('falls back to default × stage when industry is unknown but stage matches', () => {
    const profile = pickWeightProfile('unknown', 'mature')
    expect(profile.industry).toBe('default')
    expect(profile.stage).toBe('mature')
  })
})

describe('applyWeights', () => {
  it('computes the expected weighted average with the default profile', () => {
    const baseline = WEIGHT_PROFILES.find(
      (p) => p.industry === 'default' && p.stage === 'all',
    )!
    const scores = { finance: 80, sales: 60, operations: 50, marketing: 40, strategy: 30 }
    // 80*0.30 + 60*0.25 + 50*0.20 + 40*0.15 + 30*0.10
    // = 24 + 15 + 10 + 6 + 3 = 58
    const result = applyWeights(scores, baseline)
    expect(result).toBeCloseTo(58, 5)
  })

  it('returns 0 for all-zero block scores', () => {
    const baseline = WEIGHT_PROFILES[0]
    const result = applyWeights(
      { finance: 0, sales: 0, operations: 0, marketing: 0, strategy: 0 },
      baseline,
    )
    expect(result).toBeCloseTo(0, 5)
  })

  it('returns 100 when every block scores 100 (weights sum to 1.0)', () => {
    for (const profile of WEIGHT_PROFILES) {
      const result = applyWeights(
        { finance: 100, sales: 100, operations: 100, marketing: 100, strategy: 100 },
        profile,
      )
      expect(
        Math.abs(result - 100),
        `profile ${profile.industry}×${profile.stage}`,
      ).toBeLessThanOrEqual(0.1)
    }
  })
})

describe('validateWeights', () => {
  it('accepts a valid set summing to exactly 1.0', () => {
    const res = validateWeights({
      finance: 0.30,
      sales: 0.25,
      operations: 0.20,
      marketing: 0.15,
      strategy: 0.10,
    })
    expect(res.ok).toBe(true)
    expect(res.sum).toBeCloseTo(1, 5)
  })

  it('accepts a set within the ±0.001 tolerance', () => {
    const res = validateWeights({
      finance: 0.3005,
      sales: 0.25,
      operations: 0.20,
      marketing: 0.15,
      strategy: 0.10,
    })
    expect(res.ok).toBe(true)
  })

  it('detects a sum greater than 1.0', () => {
    const res = validateWeights({
      finance: 0.5,
      sales: 0.3,
      operations: 0.1,
      marketing: 0.1,
      strategy: 0.1,
    })
    expect(res.ok).toBe(false)
    expect(res.sum).toBeCloseTo(1.1, 5)
    expect(res.error).toBeDefined()
  })

  it('detects a sum less than 1.0', () => {
    const res = validateWeights({
      finance: 0.1,
      sales: 0.1,
      operations: 0.1,
      marketing: 0.1,
      strategy: 0.1,
    })
    expect(res.ok).toBe(false)
    expect(res.sum).toBeCloseTo(0.5, 5)
    expect(res.error).toBeDefined()
  })

  it('rejects negative weights', () => {
    const res = validateWeights({
      finance: -0.1,
      sales: 0.3,
      operations: 0.3,
      marketing: 0.3,
      strategy: 0.2,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toBeDefined()
  })
})
