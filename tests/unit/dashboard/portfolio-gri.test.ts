/**
 * Portfolio GRI on the staff dashboard comes from real GRI assessments
 * (gri_assessments.section_avgs / gri_index, current one per user) — not from
 * Point A block scores with proxies (team ≠ operations, founder ≠ strategy).
 * A section nobody answered is null, not 0; no assessments → null; a DB error
 * is thrown, not reported as "no data".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  error: null as { message: string } | null,
  tables: [] as string[],
  filters: [] as Array<[string, unknown]>,
  ranges: [] as Array<[number, number]>,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    from(table: string) {
      s.tables.push(table)
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => { s.filters.push([c, v]); return b },
        order: () => b,
        range: async (from: number, to: number) => {
          s.ranges.push([from, to])
          if (s.error) return { data: null, error: s.error }
          return { data: s.rows.slice(from, to + 1), error: null }
        },
      }
      return b
    },
  }),
}))

import {
  PORTFOLIO_GRI_DOMAINS,
  aggregatePortfolioGri,
  getPortfolioGRI,
  griIndexDistribution,
  latestPerUser,
} from '@/lib/portfolio-gri'
import { SECTION_TO_CATEGORY } from '@/lib/gri-calculator/assessment-seed'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'

const full = (v: Record<string, number>) => ({
  'product-demand': 0, 'trust-positioning': 0, 'business-model': 0, 'cash-stability': 0,
  operations: 0, team: 0, 'owner-readiness': 0, ...v,
})

beforeEach(() => {
  s.rows = []
  s.error = null
  s.tables = []
  s.filters = []
  s.ranges = []
})

describe('getPortfolioGRI — real GRI assessments', () => {
  it('reads current gri_assessments, never diagnostics', async () => {
    s.rows = [{ id: 'a', user_id: 'u1', gri_index: 6, section_avgs: full({ team: 6 }), created_at: '2026-10-01T00:00:00Z' }]
    await getPortfolioGRI()
    expect(s.tables).toEqual(['gri_assessments'])
    expect(s.filters).toContainEqual(['is_current', true])
  })

  it('averages every section across users and gri_index for overall', async () => {
    s.rows = [
      { id: 'a', user_id: 'u1', gri_index: 6.5, created_at: '2026-10-01T00:00:00Z',
        section_avgs: { 'product-demand': 8, 'trust-positioning': 6, 'business-model': 7, 'cash-stability': 5, operations: 9, team: 2, 'owner-readiness': 4 } },
      { id: 'b', user_id: 'u2', gri_index: '4.25', created_at: '2026-10-02T00:00:00Z',
        section_avgs: { 'product-demand': 6, 'trust-positioning': 4, 'business-model': 3, 'cash-stability': 7, operations: 7, team: 4, 'owner-readiness': '6' } },
    ]
    const p = await getPortfolioGRI()
    expect(p).toEqual({
      overall: 5.38, // (6.5 + 4.25) / 2 = 5.375
      product: 7, trust: 5, bizmodel: 5, cash: 6, ops: 8, team: 3, founder: 5,
      reportCount: 2,
    })
  })

  it('no proxies: team and founder come from their own sections, not operations / strategy', async () => {
    s.rows = [{ id: 'a', user_id: 'u1', gri_index: 5, created_at: null,
      section_avgs: full({ operations: 9, team: 2, 'trust-positioning': 8, 'owner-readiness': 3 }) }]
    const p = await getPortfolioGRI()
    expect(p?.ops).toBe(9)
    expect(p?.team).toBe(2)
    expect(p?.team).not.toBe(p?.ops)
    expect(p?.trust).toBe(8)
    expect(p?.founder).toBe(3)
  })

  it('a section nobody answered is null, not 0; unanswered (0) values are left out of the mean', async () => {
    s.rows = [
      { id: 'a', user_id: 'u1', gri_index: 6, created_at: null, section_avgs: full({ 'product-demand': 6, team: 8 }) },
      { id: 'b', user_id: 'u2', gri_index: 4, created_at: null, section_avgs: { 'product-demand': 4 } },
    ]
    const p = await getPortfolioGRI()
    expect(p?.product).toBe(5)
    expect(p?.team).toBe(8)       // u2 did not answer «Команда» — not averaged as 0
    expect(p?.cash).toBeNull()    // nobody answered
    expect(p?.founder).toBeNull()
    expect(p?.reportCount).toBe(2)
  })

  it('no assessments → null', async () => {
    s.rows = []
    expect(await getPortfolioGRI()).toBeNull()
  })

  it('assessments without any answers → null (nothing to average)', async () => {
    s.rows = [{ id: 'a', user_id: 'u1', gri_index: 0, created_at: null, section_avgs: full({}) }]
    expect(await getPortfolioGRI()).toBeNull()
  })

  it('a database error is thrown, not turned into "no data"', async () => {
    s.error = { message: 'permission denied' }
    await expect(getPortfolioGRI()).rejects.toThrow(/gri_assessments/)
  })

  it('filters by company when asked', async () => {
    await getPortfolioGRI('co-1')
    expect(s.filters).toContainEqual(['company_id', 'co-1'])
  })

  it('pages past the PostgREST row cap', async () => {
    s.rows = Array.from({ length: 1001 }, (_, i) => ({
      id: `r${i}`, user_id: `u${i}`, gri_index: 5, created_at: null, section_avgs: full({ team: 5 }),
    }))
    const p = await getPortfolioGRI()
    expect(s.ranges).toEqual([[0, 999], [1000, 1999]])
    expect(p?.reportCount).toBe(1001)
  })
})

describe('pure helpers', () => {
  it('takes one (the newest) assessment per user', () => {
    const rows = [
      { user_id: 'u1', gri_index: 2, section_avgs: full({ team: 2 }), created_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u1', gri_index: 8, section_avgs: full({ team: 8 }), created_at: '2026-09-01T00:00:00Z' },
      { user_id: 'u2', gri_index: 4, section_avgs: full({ team: 4 }), created_at: '2026-05-01T00:00:00Z' },
    ]
    expect(latestPerUser(rows)).toHaveLength(2)
    const p = aggregatePortfolioGri(rows)
    expect(p?.team).toBe(6)
    expect(p?.overall).toBe(6)
    expect(p?.reportCount).toBe(2)
  })

  it('gri_index distribution uses the 8 / 6 / 4 bands of the 0–10 index, not Point A 90 / 70 / 50', () => {
    const rows = [9.1, 8, 7.99, 6, 5.5, 4, 3.9, 0.5, 0].map((v, i) => ({
      user_id: `u${i}`, gri_index: v, section_avgs: {}, created_at: null,
    }))
    expect(griIndexDistribution(rows)).toEqual({ excellent: 2, strong: 2, developing: 2, critical: 2, total: 8 })
  })

  it('domain section ids are exactly the GRI assessment sections', () => {
    const ids = PORTFOLIO_GRI_DOMAINS.map((d) => d.sectionId).sort()
    expect(ids).toEqual(Object.keys(SECTION_TO_CATEGORY).sort())
    expect(ids).toEqual(GRI_SECTIONS.map((x) => x.id).sort())
  })
})
