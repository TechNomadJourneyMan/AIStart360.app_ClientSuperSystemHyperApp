/**
 * R-033 (BI-02) / R-035 (BI-46) — the official Point A: «нет данных» = null,
 * never a v1 zero; red zones = critical + weak (critical first), blocks with data only.
 */
import { describe, it, expect } from 'vitest'
import { officialPointA, officialRedBlocks, officialBlockScore, getOfficialPointA, officialDiagnosticRow } from '@/lib/point-a/official'
import { memoryClient } from '../data-layer/memory-client'

const v1Block = (score: number, status: string) => ({ score, status, top_issues: [`v1 ${score}`], recommendations: [] })

/** A v1-fallback diagnostics row as written before R-033: unanswered = 0. */
const V1_ROW = {
  id: 'diag-1', overall_score: 31, health_index: 25, stage: 'seed',
  finance_score: v1Block(0, 'critical'), sales_score: v1Block(40, 'weak'), operations_score: v1Block(60, 'average'),
  marketing_score: v1Block(20, 'critical'), strategy_score: v1Block(35, 'weak'),
  risks: [{ level: 'important', area: 'Финансы', text: 't', impact: 'i' }], insights: [], quick_wins: [], data_gaps: [],
}

const v4Blocks = (scores: Record<string, number | null>) =>
  Object.entries(scores).map(([key, score], i) => ({ key, title: key.toUpperCase(), score, order: i, informational: false, hiddenForClient: false, top_issues: [], recommendations: [] }))

describe('officialPointA (R-033, BI-02)', () => {
  it('R-033 golden: sent questionnaire, finance «не знаю», v4 has no overall → no score, finance = no data (was «Финансы 0 — критично», overall 31)', () => {
    const snapshot = {
      engine: 'v1', config_version: 'cfg|v4', overall: null, stage: null,
      v4: { assessment: 'full', health_index: null },
      blocks: v4Blocks({ finance: null, sales: 55, operations: 62, marketing: null, strategy: null }),
    }
    const o = officialPointA(V1_ROW, snapshot)
    expect(o.state).toBe('no_score')
    expect(o.overall).toBeNull()
    expect(o.stage).toBeNull()
    expect(o.health_index).toBeNull()
    const finance = o.blocks.find((b) => b.key === 'finance')!
    expect(finance.score).toBeNull()
    expect(finance.status).toBe('no_data')
    expect(o.blocks.find((b) => b.key === 'sales')).toMatchObject({ score: 55, status: 'average' })
    expect(o.blocksWithoutData).toEqual(['finance', 'marketing', 'strategy'])
    // No block nobody answered is «critical» anywhere.
    expect(o.blocks.filter((b) => b.score === 0)).toEqual([])
    expect(o.risks).toHaveLength(1) // findings are kept
  })

  it('v4 scored: overall from v4; a block v4 could not score is no data, not the v1 zero of the row', () => {
    const snapshot = {
      engine: 'v4', config_version: 'cfg|v4', overall: 62, stage: 'early',
      v4: { assessment: 'full', health_index: 57 },
      blocks: [...v4Blocks({ finance: null, sales: 70, operations: 62, marketing: 45, strategy: 12 }), { key: 'team', title: 'Команда', score: 80, order: 9 }],
    }
    const o = officialPointA({ ...V1_ROW, overall_score: 62, stage: 'early' }, snapshot)
    expect(o).toMatchObject({ state: 'scored', source: 'snapshot_v4', overall: 62, stage: 'early', health_index: 57, diagnosticId: 'diag-1' })
    expect(officialBlockScore(o, 'finance')).toBeNull()
    expect(officialBlockScore(o, 'strategy')).toBe(12)
    expect(o.blocks.map((b) => b.key)).toEqual(['finance', 'sales', 'operations', 'marketing', 'strategy', 'team'])
  })

  it('before the full questionnaire: no numbers at all (PO 2026-11-02), even with v4 off', () => {
    for (const config_version of ['cfg|v4', 'cfg|v1']) {
      const o = officialPointA(V1_ROW, { engine: 'v1', config_version, overall: null, v4: { assessment: 'preliminary' }, blocks: v4Blocks({ finance: 40, sales: 50 }) })
      expect(o.state).toBe('preliminary')
      expect(o.overall).toBeNull()
      expect(o.blocks.every((b) => b.score === null)).toBe(true)
      expect(officialRedBlocks(o)).toEqual([])
    }
  })

  it('v4 off: the v1 row by the setting, but a block v4 found without data stays no data', () => {
    const o = officialPointA(V1_ROW, { engine: 'v1', config_version: 'cfg|v1', overall: 50, v4: { assessment: 'full' }, blocks: v4Blocks({ finance: null, sales: 50, operations: 60, marketing: 30, strategy: 40 }) })
    expect(o).toMatchObject({ state: 'scored', source: 'diagnostic_v1', overall: 31, stage: 'seed' })
    expect(officialBlockScore(o, 'finance')).toBeNull()
    expect(officialBlockScore(o, 'sales')).toBe(40) // the v1 value of the row
  })

  it('no snapshot: the row; a missing overall / column is null, never 0', () => {
    expect(officialPointA({ ...V1_ROW, overall_score: null, finance_score: null }, null)).toMatchObject({ state: 'no_score', overall: null, stage: null })
    const o = officialPointA({ ...V1_ROW, finance_score: null }, null)
    expect(o.state).toBe('scored')
    expect(officialBlockScore(o, 'finance')).toBeNull()
    expect(officialPointA(null, null).state).toBe('none')
  })
})

describe('officialRedBlocks (R-035, BI-46)', () => {
  it('R-035 golden: finance 12 (critical) and marketing 45 (weak) → finance first; no-data blocks are never red', () => {
    const snapshot = { engine: 'v4', config_version: 'c|v4', overall: 48, stage: 'early', v4: { assessment: 'full' }, blocks: v4Blocks({ finance: 12, sales: null, operations: 75, marketing: 45, strategy: 28 }) }
    const reds = officialRedBlocks(officialPointA(V1_ROW, snapshot))
    expect(reds.map((r) => [r.key, r.status])).toEqual([['finance', 'critical'], ['strategy', 'critical'], ['marketing', 'weak']])
  })

  it('informational and expert-only blocks are not red zones for the client', () => {
    const blocks = [
      { key: 'finance', score: 60 }, { key: 'sales', score: 10, informational: true }, { key: 'operations', score: 15, hiddenForClient: true },
      { key: 'marketing', score: 70 }, { key: 'strategy', score: 70 },
    ]
    const o = officialPointA(V1_ROW, { engine: 'v4', config_version: 'c|v4', overall: 60, v4: { assessment: 'full' }, blocks })
    expect(officialRedBlocks(o)).toEqual([])
    expect(officialRedBlocks(o, { includeHidden: true }).map((r) => r.key)).toEqual(['operations'])
  })
})

describe('getOfficialPointA', () => {
  it('reads the current row and the latest snapshot of the user company', async () => {
    const m = memoryClient({
      diagnostics: [{ ...V1_ROW, user_id: 'u1', is_current: true, calculated_at: '2026-11-10' }, { ...V1_ROW, id: 'old', user_id: 'u1', is_current: false }],
      companies: [{ id: 'co', user_id: 'u1' }],
      point_a_snapshots: [
        { company_id: 'co', created_at: '2026-11-01', engine: 'v4', config_version: 'c|v4', overall: 90, stage: 'scale', v4: { assessment: 'full' }, blocks: v4Blocks({ finance: 90 }) },
        { company_id: 'co', created_at: '2026-11-10', engine: 'v1', config_version: 'c|v4', overall: null, stage: null, v4: { assessment: 'full' }, blocks: v4Blocks({ finance: null, sales: 55 }) },
      ],
    })
    const o = await getOfficialPointA(m.client as never, 'u1')
    expect(o).toMatchObject({ state: 'no_score', diagnosticId: 'diag-1', overall: null })
    expect(officialBlockScore(o, 'finance')).toBeNull()
  })

  it('no snapshots table (before migration 111): the row alone', async () => {
    const m = memoryClient({ diagnostics: [{ ...V1_ROW, user_id: 'u1', is_current: true }], companies: [{ id: 'co', user_id: 'u1' }] }, { missing: ['point_a_snapshots'] })
    const o = await getOfficialPointA(m.client as never, 'u1')
    expect(o).toMatchObject({ state: 'scored', source: 'diagnostic', overall: 31 })
  })
})

describe('officialDiagnosticRow', () => {
  it('the raw row with official numbers: null overall / stage without a score, null block columns without data', () => {
    const snapshot = { engine: 'v1', config_version: 'c|v4', overall: null, v4: { assessment: 'full' }, blocks: v4Blocks({ finance: null, sales: 55, operations: 62, marketing: null, strategy: null }) }
    const row = officialDiagnosticRow(V1_ROW, officialPointA(V1_ROW, snapshot))
    expect(row).toMatchObject({ id: 'diag-1', overall_score: null, stage: null, health_index: null, finance_score: null, marketing_score: null })
    expect(row.sales_score).toMatchObject({ score: 55, status: 'average' })
    expect(row.risks).toEqual(V1_ROW.risks)
  })
})
