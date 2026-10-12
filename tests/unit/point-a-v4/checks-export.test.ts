import { describe, it, expect } from 'vitest'
import { calculatePointA, pointAChecks, toBlock } from '@/lib/point-a-engine'
import * as sets from '../point-a/fixtures/answer-sets'

describe('pointAChecks reproduces the v1 blocks', () => {
  for (const [name, answers] of Object.entries(sets)) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) continue
    it(name, () => {
      const v1 = calculatePointA(answers as Record<string, unknown>)
      const checks = pointAChecks(answers as Record<string, unknown>)
      for (const b of ['finance', 'sales', 'operations', 'marketing', 'strategy'] as const) {
        expect(toBlock(checks[b])).toEqual(v1.blocks[b])
      }
    })
  }
})
