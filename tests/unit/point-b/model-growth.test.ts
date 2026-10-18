/**
 * Simplified growth model (Point B plan Ф2, Task 4): annual run-rate = base · (1 + g)^(t/12).
 */
import { describe, expect, it } from 'vitest'
import { projectGrowth, requiredAnnualGrowth, timeToTarget } from '@/lib/point-b/model/growth'
import { ModelInputError } from '@/lib/point-b/model/types'

const M60 = 60_000_000
const M120 = 120_000_000

describe('projectGrowth', () => {
  it('base 60M, growth 100% annual, 12 months gives 120M', () => {
    const path = projectGrowth({ baseAnnual: M60, annualGrowth: 1, months: 12 })
    expect(path).toHaveLength(12)
    expect(path[11]).toBeCloseTo(M120, 3)
    // the first month is 2^(1/12) times the base
    expect(path[0]).toBeCloseTo(M60 * 2 ** (1 / 12), 3)
  })

  it('is strictly increasing for positive growth, flat for zero and decreasing for negative', () => {
    const up = projectGrowth({ baseAnnual: M60, annualGrowth: 0.25, months: 24 })
    up.forEach((v, i) => i > 0 && expect(v).toBeGreaterThan(up[i - 1]))
    expect(projectGrowth({ baseAnnual: M60, annualGrowth: 0, months: 5 }).every((v) => v === M60)).toBe(true)
    const down = projectGrowth({ baseAnnual: M60, annualGrowth: -0.2, months: 12 })
    expect(down[11]).toBeCloseTo(M60 * 0.8, 3)
  })

  it('zero months give an empty path; nonsense is an input error', () => {
    expect(projectGrowth({ baseAnnual: M60, annualGrowth: 1, months: 0 })).toEqual([])
    expect(() => projectGrowth({ baseAnnual: 0, annualGrowth: 1, months: 3 })).toThrow(ModelInputError)
    expect(() => projectGrowth({ baseAnnual: M60, annualGrowth: -1, months: 3 })).toThrow(ModelInputError)
    expect(() => projectGrowth({ baseAnnual: M60, annualGrowth: NaN, months: 3 })).toThrow(ModelInputError)
    expect(() => projectGrowth({ baseAnnual: M60, annualGrowth: 1, months: 2.5 })).toThrow(ModelInputError)
  })
})

describe('timeToTarget', () => {
  it('timeToTarget(60M, 120M, 1.0) = 12', () => {
    expect(timeToTarget({ baseAnnual: M60, targetAnnual: M120, annualGrowth: 1 })).toBe(12)
  })

  it('doubling at 25% a year takes about 37 months', () => {
    const t = timeToTarget({ baseAnnual: M60, targetAnnual: M120, annualGrowth: 0.25 })!
    expect(t).toBeGreaterThan(37.2)
    expect(t).toBeLessThan(37.3) // 12·ln2/ln1.25 = 37.27
  })

  it('timeToTarget with zero or negative growth is null', () => {
    expect(timeToTarget({ baseAnnual: M60, targetAnnual: M120, annualGrowth: 0 })).toBeNull()
    expect(timeToTarget({ baseAnnual: M60, targetAnnual: M120, annualGrowth: -0.1 })).toBeNull()
    expect(timeToTarget({ baseAnnual: M60, targetAnnual: M120, annualGrowth: NaN })).toBeNull()
  })

  it('target below base gives 0 months', () => {
    expect(timeToTarget({ baseAnnual: M60, targetAnnual: 50_000_000, annualGrowth: 0.3 })).toBe(0)
    expect(timeToTarget({ baseAnnual: M60, targetAnnual: M60, annualGrowth: 0.3 })).toBe(0)
    // even with no growth: nothing to reach
    expect(timeToTarget({ baseAnnual: M60, targetAnnual: 50_000_000, annualGrowth: 0 })).toBe(0)
  })

  it('a base that is not positive cannot be grown', () => {
    expect(timeToTarget({ baseAnnual: 0, targetAnnual: M120, annualGrowth: 1 })).toBeNull()
  })

  it('agrees with projectGrowth: the path crosses the target in the month it names', () => {
    const t = timeToTarget({ baseAnnual: M60, targetAnnual: M120, annualGrowth: 0.5 })!
    const path = projectGrowth({ baseAnnual: M60, annualGrowth: 0.5, months: 40 })
    expect(path[Math.ceil(t) - 1]).toBeGreaterThanOrEqual(M120)
    expect(path[Math.ceil(t) - 2]).toBeLessThan(M120)
  })
})

describe('requiredAnnualGrowth', () => {
  it('requiredAnnualGrowth(60M,120M,12) = 1', () => {
    expect(requiredAnnualGrowth(M60, M120, 12)).toBeCloseTo(1, 12)
  })

  it('stretches over a longer or shorter horizon', () => {
    expect(requiredAnnualGrowth(M60, M120, 24)).toBeCloseTo(Math.SQRT2 - 1, 12)
    expect(requiredAnnualGrowth(M60, M120, 6)).toBeCloseTo(3, 12) // ×2 in half a year = ×4 a year
    expect(requiredAnnualGrowth(M60, 30_000_000, 12)).toBeCloseTo(-0.5, 12)
  })

  it('months ≤ 0 gives null', () => {
    expect(requiredAnnualGrowth(M60, M120, 0)).toBeNull()
    expect(requiredAnnualGrowth(M60, M120, -3)).toBeNull()
    expect(requiredAnnualGrowth(M60, M120, NaN)).toBeNull()
  })

  it('a base or target that is not positive gives null, an overflow gives null', () => {
    expect(requiredAnnualGrowth(0, M120, 12)).toBeNull()
    expect(requiredAnnualGrowth(M60, 0, 12)).toBeNull()
    expect(requiredAnnualGrowth(1, 1e300, 1)).toBeNull()
  })
})
