/**
 * Blocks without data for readers of the diagnostics row (survey Ф2 — v1 zeros
 * after the express flow must not read as weak blocks).
 */
import { describe, expect, it } from 'vitest'
import { blocksWithoutDataOf, isV1Fallback, loadPointAQuality } from '@/lib/point-a/blocks-without-data'
import { commDb } from '../comm/_db'

const blocks = [{ key: 'finance', score: null }, { key: 'sales', score: 55 }, { key: 'team', score: null }]

describe('blocksWithoutDataOf', () => {
  it('v4 snapshot → v4 blocks without a score', () => {
    expect(blocksWithoutDataOf({ engine: 'v4', config_version: 'x|v4', blocks }, null)).toEqual(['finance', 'team'])
  })
  it('v1 fallback of a v4 company → still the v4 blocks', () => {
    const snap = { engine: 'v1', config_version: 'default@3|v4', blocks }
    expect(isV1Fallback(snap)).toBe(true)
    expect(blocksWithoutDataOf(snap, { finance_score: { score: 0 } })).toEqual(['finance', 'team'])
  })
  it('v4 switched off (…|v1) → the diagnostics columns decide', () => {
    const snap = { engine: 'v1', config_version: 'default@3|v1', blocks }
    expect(isV1Fallback(snap)).toBe(false)
    expect(blocksWithoutDataOf(snap, { finance_score: { score: 10 }, sales_score: null, operations_score: {}, marketing_score: {}, strategy_score: {} })).toEqual(['sales'])
  })
})

describe('loadPointAQuality', () => {
  it('reads the newest snapshot of the user company', async () => {
    const { sb } = commDb({
      companies: [{ id: 'c1', user_id: 'u1' }],
      point_a_snapshots: [
        { id: 'a', company_id: 'c1', created_at: '2026-10-01T00:00:00Z', engine: 'v4', config_version: 'd|v4', blocks: [{ key: 'sales', score: null }] },
        { id: 'b', company_id: 'c1', created_at: '2026-10-20T00:00:00Z', engine: 'v1', config_version: 'd|v4', blocks },
      ],
    })
    expect(await loadPointAQuality(sb, 'u1')).toEqual({ blocksWithoutData: ['finance', 'team'], v1Fallback: true })
    expect(await loadPointAQuality(sb, 'nobody')).toEqual({ blocksWithoutData: [], v1Fallback: false })
  })
})
