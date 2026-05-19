// Unit tests for lib/point-a/history.ts
// - computeDiff is pure: cover equality, block deltas, risk add/resolve
// - listPointASnapshots / getPointAByVersion use a mocked supabase client

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeDiff,
  listPointASnapshots,
  getPointAByVersion,
} from '@/lib/point-a/history'
import type { PointA, BlockScore, Risk } from '@/types/onboarding'

function block(score: number): BlockScore {
  return { score, status: 'average', top_issues: [], recommendations: [] }
}

function makePointA(overrides: Partial<PointA> = {}): PointA {
  return {
    overall_score: 50,
    health_index: 60,
    stage: 'early',
    blocks: {
      finance: block(50),
      marketing: block(50),
      operations: block(50),
      strategy: block(50),
      sales: block(50),
    },
    risks: [],
    insights: [],
    quick_wins: [],
    data_gaps: [],
    ...overrides,
  }
}

// ─── computeDiff ────────────────────────────────────────────────────────────

describe('computeDiff', () => {
  it('returns zero deltas when PointAs are equal', () => {
    const p = makePointA()
    const diff = computeDiff(p, p)
    expect(diff.overallDelta).toBe(0)
    expect(diff.blockDeltas).toEqual({
      finance: 0,
      marketing: 0,
      operations: 0,
      strategy: 0,
      sales: 0,
    })
    expect(diff.risksAdded).toBe(0)
    expect(diff.risksResolved).toBe(0)
  })

  it('records +20 finance score delta', () => {
    const prev = makePointA()
    const next = makePointA({
      blocks: {
        finance: block(70),
        marketing: block(50),
        operations: block(50),
        strategy: block(50),
        sales: block(50),
      },
    })
    const diff = computeDiff(prev, next, 1, 2)
    expect(diff.blockDeltas.finance).toBe(20)
    expect(diff.blockDeltas.marketing).toBe(0)
    expect(diff.fromVersion).toBe(1)
    expect(diff.toVersion).toBe(2)
  })

  it('propagates overall_score delta', () => {
    const prev = makePointA({ overall_score: 40 })
    const next = makePointA({ overall_score: 65 })
    expect(computeDiff(prev, next).overallDelta).toBe(25)
  })

  it('counts risks added and resolved', () => {
    const rA: Risk = { level: 'critical', area: 'finance', text: 'cash crunch', impact: 'high' }
    const rB: Risk = { level: 'important', area: 'sales',   text: 'churn rising', impact: 'med' }
    const rC: Risk = { level: 'moderate',  area: 'ops',     text: 'no SOPs',     impact: 'low' }

    // prev has A and B; next has B and C → A resolved, C added.
    const prev = makePointA({ risks: [rA, rB] })
    const next = makePointA({ risks: [rB, rC] })

    const diff = computeDiff(prev, next)
    expect(diff.risksResolved).toBe(1)
    expect(diff.risksAdded).toBe(1)
  })

  it('handles missing risks arrays defensively', () => {
    const prev = makePointA({ risks: [] })
    const next = makePointA({
      risks: [{ level: 'critical', area: 'finance', text: 'new risk', impact: 'high' }],
    })
    const diff = computeDiff(prev, next)
    expect(diff.risksAdded).toBe(1)
    expect(diff.risksResolved).toBe(0)
  })
})

// ─── Supabase-backed helpers (mocked) ───────────────────────────────────────

function makeListClient(rows: unknown[], error: unknown = null) {
  const result = { data: rows, error }
  const limit = vi.fn().mockResolvedValue(result)
  // `order(...)` must be both chainable (.limit()) and awaitable (no .limit()).
  const order = vi.fn(() => {
    const node: Record<string, unknown> = { limit }
    node.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve)
    return node
  })
  const eq = vi.fn(() => ({ order }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { from } as unknown as SupabaseClient
}

function makeGetClient(row: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error })
  const eq2 = vi.fn(() => ({ maybeSingle }))
  const eq1 = vi.fn(() => ({ eq: eq2 }))
  const select = vi.fn(() => ({ eq: eq1 }))
  const from = vi.fn(() => ({ select }))
  return { from } as unknown as SupabaseClient
}

describe('listPointASnapshots', () => {
  it('maps DB rows to PointASnapshot shape, newest first', async () => {
    const rows = [
      {
        id: 'd-2',
        version: 2,
        calculated_at: '2026-05-10T00:00:00Z',
        overall_score: 70,
        health_index: 80,
        stage: 'growth',
        is_current: true,
      },
      {
        id: 'd-1',
        version: 1,
        calculated_at: '2026-04-10T00:00:00Z',
        overall_score: 50,
        health_index: 60,
        stage: 'early',
        is_current: false,
      },
    ]
    const sb = makeListClient(rows)
    const result = await listPointASnapshots(sb, 'user-1', 20)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: 'd-2',
      version: 2,
      calculatedAt: '2026-05-10T00:00:00Z',
      overallScore: 70,
      healthIndex: 80,
      stage: 'growth',
      isCurrent: true,
    })
    expect(result[1].isCurrent).toBe(false)
  })

  it('returns [] on supabase error', async () => {
    const sb = makeListClient(null as unknown as unknown[], { message: 'boom' })
    const result = await listPointASnapshots(sb, 'user-1')
    expect(result).toEqual([])
  })
})

describe('getPointAByVersion', () => {
  it('maps a diagnostic row to PointA', async () => {
    const row = {
      id: 'd-1',
      version: 3,
      calculated_at: '2026-05-19T00:00:00Z',
      overall_score: 75,
      health_index: 82,
      stage: 'growth',
      is_current: true,
      finance_score: block(80),
      marketing_score: block(70),
      operations_score: block(60),
      strategy_score: block(65),
      sales_score: block(72),
      risks: [{ level: 'critical', area: 'finance', text: 'x', impact: 'y' }],
      insights: [],
      quick_wins: [],
      data_gaps: [],
    }
    const sb = makeGetClient(row)
    const pa = await getPointAByVersion(sb, 'user-1', 3)
    expect(pa).not.toBeNull()
    expect(pa!.overall_score).toBe(75)
    expect(pa!.stage).toBe('growth')
    expect(pa!.blocks.finance.score).toBe(80)
    expect(pa!.risks).toHaveLength(1)
  })

  it('returns null when no row found', async () => {
    const sb = makeGetClient(null)
    const pa = await getPointAByVersion(sb, 'user-1', 999)
    expect(pa).toBeNull()
  })

  it('returns null on error', async () => {
    const sb = makeGetClient(null, { message: 'oops' })
    const pa = await getPointAByVersion(sb, 'user-1', 1)
    expect(pa).toBeNull()
  })
})
