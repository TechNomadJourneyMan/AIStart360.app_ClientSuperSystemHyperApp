import { describe, it, expect, vi } from 'vitest'
import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, effectiveBlocks } from '@/lib/point-a/v4/config'
import { pointAStatus } from '@/lib/point-a/v4/primary'
import { buildPointASnapshot, type SnapshotDeps } from '@/lib/point-a/snapshot'
import { resolveAllMetrics } from '@/lib/metrics/resolver'
import { memoryClient } from '../data-layer/memory-client'
import { CURRENT_FULL_STRONG } from '../point-a/fixtures/answer-sets'

const blocks = effectiveBlocks(DEFAULT_TEMPLATE)

describe('PO 2026-11-02: no overall score and no stage before the full questionnaire', () => {
  it('preliminary: blocks and the checklist are computed, the overall / stage / health are not', () => {
    const r = calculatePointAV4({ answers: CURRENT_FULL_STRONG, blocks, surveyComplete: false })
    expect(r.assessment).toBe('preliminary')
    expect(r.overall).toBeNull()
    expect(r.stage).toBeNull()
    expect(r.health_index).toBeNull()
    expect(r.blocks.some((b) => b.score !== null)).toBe(true)
    expect(r.upload_checklist.length + r.blocks.flatMap((b) => b.top_issues).length).toBeGreaterThan(0)
  })

  it('full: the same answers have an overall and a stage', () => {
    const r = calculatePointAV4({ answers: CURRENT_FULL_STRONG, blocks, surveyComplete: true })
    expect(r.assessment).toBe('full')
    expect(r.overall).not.toBeNull()
    expect(r.stage).not.toBeNull()
  })

  it('pointAStatus says «preliminary»; old snapshots without the field keep their status', () => {
    expect(pointAStatus({ overall: null, blocks: [], assessment: 'preliminary' })).toEqual({ kind: 'preliminary' })
    expect(pointAStatus({ overall: 70, blocks: [{ key: 'finance', score: 70, status: 'ok' }] })).toEqual({ kind: 'full', overall: 70 })
  })
})

describe('the snapshot of a preliminary assessment', () => {
  function setup(surveyComplete: boolean) {
    const m = memoryClient({ companies: [{ id: 'co', user_id: 'owner', industry: 'Услуги' }], point_a_snapshots: [], diagnostics: [] })
    const store = vi.fn(async () => ({ ok: true as const, diag: { id: 'diag-1' } }))
    const after = vi.fn()
    const state = { surveyComplete }
    const deps: SnapshotDeps = {
      service: () => m.client,
      materialize: async () => ({ values: resolveAllMetrics({ companyId: 'co', userId: 'owner', surveyAnswers: CURRENT_FULL_STRONG, documents: [], now: new Date('2026-11-02T00:00:00Z') }), surveyAnswers: CURRENT_FULL_STRONG }),
      useV4: async () => true,
      store: store as unknown as SnapshotDeps['store'],
      lock: async () => ({ release: async () => undefined }),
      afterWrite: after,
      surveyComplete: async () => state.surveyComplete,
    }
    return { m, store, after, deps, state }
  }

  it('stores a diagnostics row without a score and tells afterWrite it is preliminary', async () => {
    const { m, store, after, deps } = setup(false)
    const r = await buildPointASnapshot('co', { trigger: 'event' }, deps)
    expect(r.status).toBe('written')
    if (r.status !== 'written') return
    expect(r.assessment).toBe('preliminary')
    expect(r.engine).toBe('v4')
    expect(store).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ preliminary: true }))
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ preliminary: true }))
    const snap = m.db.point_a_snapshots[0]
    expect(snap.overall).toBeNull()
    expect((snap.v4 as { assessment: string }).assessment).toBe('preliminary')
    expect((snap.inputs as { survey: string }).survey).toBe('preliminary')
  })

  it('sending the full questionnaire is a change: a new full snapshot', async () => {
    const { m, deps, state } = setup(false)
    await buildPointASnapshot('co', { trigger: 'event' }, deps)
    state.surveyComplete = true
    const r = await buildPointASnapshot('co', { trigger: 'event' }, deps)
    expect(r.status).toBe('written')
    if (r.status !== 'written') return
    expect(r.assessment).toBe('full')
    expect(m.db.point_a_snapshots[1].overall).not.toBeNull()
  })
})
