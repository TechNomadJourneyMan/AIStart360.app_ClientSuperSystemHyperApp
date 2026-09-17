import { describe, expect, it } from 'vitest'
import { computeGriIndex, computeSectionAvgs, scoresFingerprint } from '@/lib/gri-assessment/score'

describe('GRI canonical score', () => {
  it('averages answered criteria and skips zeros / junk', () => {
    const avgs = computeSectionAvgs({ team: { a: 4, b: 8, c: 0 }, operations: {}, bad: null as never })
    expect(avgs.team).toBe(6)
    expect(avgs.operations).toBe(0)
    expect(avgs.bad).toBe(0)
  })

  it('index = mean of sections with data, 2 decimals', () => {
    expect(computeGriIndex({ a: 6, b: 7, c: 0 })).toBe(6.5)
    expect(computeGriIndex({ a: 5, b: 5.55 })).toBe(5.28)
    expect(computeGriIndex({})).toBe(0)
  })

  it('fingerprint ignores key order and unanswered criteria', () => {
    const a = scoresFingerprint({ team: { x: 3, y: 5 }, ops: { z: 7 } })
    const b = scoresFingerprint({ ops: { z: 7 }, team: { y: 5, x: 3, w: 0 } })
    expect(a).toBe(b)
    expect(scoresFingerprint({ team: { x: 4, y: 5 }, ops: { z: 7 } })).not.toBe(a)
    expect(scoresFingerprint(null)).toBe('')
  })
})
