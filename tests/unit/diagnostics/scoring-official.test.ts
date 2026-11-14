/**
 * R-034 (BI-47) — the diagnostic pipeline scores Point A ONLY through the
 * official snapshot: no v1 calculation, no is_current insert of its own.
 */
import { describe, it, expect, vi } from 'vitest'
import { scoreViaSnapshot, NoSurveyDataError, PointAUnavailableError, type ScoringIO, type DiagnosticRow } from '@/lib/diagnostics/scoring'

const PRELIMINARY_ROW: DiagnosticRow = {
  id: 'd-pre', overall_score: null, health_index: null, stage: null,
  finance_score: null, sales_score: null, operations_score: null, marketing_score: null, strategy_score: null,
  risks: [], insights: [], quick_wins: [], data_gaps: [], calculated_at: new Date('2026-11-10T00:00:00Z'),
}

function io(over: Partial<ScoringIO> = {}): ScoringIO & { link: ReturnType<typeof vi.fn> } {
  const link = vi.fn(async (row: DiagnosticRow, o: { verified: boolean }) => (o.verified ? new Date('2026-11-14T00:00:00Z') : row.calculated_at))
  return {
    profile: async () => ({ id: 'co', name: 'Co', ownerId: 'owner', industry: null, stage: null, size: null, businessModel: null }),
    answeredKeys: async () => 1,
    snapshot: async () => ({ status: 'unchanged', snapshotId: 's1' }),
    currentRow: async () => PRELIMINARY_ROW,
    snapshotRow: async () => ({ engine: 'v4', config_version: 'c|v4', overall: null, v4: { assessment: 'preliminary' }, blocks: [{ key: 'finance', score: 40 }] }),
    ...over,
    link: link as never,
  } as ScoringIO & { link: ReturnType<typeof vi.fn> }
}

describe('scoreViaSnapshot (R-034)', () => {
  it('R-034 golden: 1 answer in the survey → the preliminary snapshot row, no score / stage (was a v1 overall + stage inserted as is_current)', async () => {
    const snapshot = vi.fn(async () => ({ status: 'written' as const }) as never)
    const w = io({ snapshot })
    const r = await scoreViaSnapshot(w, 'co', 'sess')
    expect(snapshot).toHaveBeenCalledWith('co')
    expect(r.diagnosticId).toBe('d-pre')
    expect(r.reused).toBe(false)
    expect(r.official.state).toBe('preliminary')
    expect(r.official.overall).toBeNull()
    expect(r.official.stage).toBeNull()
    expect(r.official.blocks.every((b) => b.score === null)).toBe(true)
  })

  it('R-034: a v1 zero of a block v4 found without data reaches the agent steps as null, not «0 — критично»', async () => {
    const row: DiagnosticRow = { ...PRELIMINARY_ROW, id: 'd-ns', overall_score: '31', stage: 'seed', finance_score: { score: 0, status: 'critical', top_issues: [], recommendations: [] }, sales_score: { score: 55, status: 'average', top_issues: [], recommendations: [] } }
    const w = io({
      currentRow: async () => row,
      snapshotRow: async () => ({ engine: 'v1', config_version: 'c|v4', overall: null, v4: { assessment: 'full' }, blocks: [{ key: 'finance', score: null }, { key: 'sales', score: 55 }] }),
    })
    const r = await scoreViaSnapshot(w, 'co', null)
    expect(r.official.state).toBe('no_score')
    expect(r.pointA.blocks.finance).toBeNull()
    expect(r.pointA.blocks.sales).toMatchObject({ score: 55 })
  })

  it('«unchanged» → the current row is reused and its calculated_at moves (verified against current inputs)', async () => {
    const w = io()
    const r = await scoreViaSnapshot(w, 'co', 'sess')
    expect(r.reused).toBe(true)
    expect(w.link).toHaveBeenCalledWith(PRELIMINARY_ROW, { sessionId: 'sess', companyId: 'co', verified: true })
    expect(r.calculatedAt.toISOString()).toBe('2026-11-14T00:00:00.000Z')
  })

  it('a failed / busy snapshot: the current row is linked as is; none at all → PointAUnavailableError (never a v1 insert)', async () => {
    const failing = io({ snapshot: async () => { throw new Error('boom') } })
    expect((await scoreViaSnapshot(failing, 'co', null)).diagnosticId).toBe('d-pre')
    expect(failing.link).toHaveBeenCalledWith(PRELIMINARY_ROW, expect.objectContaining({ verified: false }))
    await expect(scoreViaSnapshot(io({ snapshot: async () => ({ status: 'skipped', reason: 'busy' }), currentRow: async () => null }), 'co', null)).rejects.toBeInstanceOf(PointAUnavailableError)
  })

  it('no owner / no answers → NoSurveyDataError', async () => {
    await expect(scoreViaSnapshot(io({ answeredKeys: async () => 0 }), 'co', null)).rejects.toBeInstanceOf(NoSurveyDataError)
    await expect(scoreViaSnapshot(io({ profile: async () => null }), 'co', null)).rejects.toBeInstanceOf(NoSurveyDataError)
    await expect(scoreViaSnapshot(io({ snapshot: async () => ({ status: 'skipped', reason: 'no_answers' }) }), 'co', null)).rejects.toBeInstanceOf(NoSurveyDataError)
  })

  it('the module has no v1 engine call left', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('lib/diagnostics/scoring.ts', 'utf8')
    expect(src).not.toMatch(/calculatePointA\(/)
    expect(src).not.toMatch(/INSERT INTO public\.diagnostics/)
  })
})
