import { describe, expect, it, vi } from 'vitest'
import { analyzeWithInputCache, pointAAnalysisInputHash, stableStringify } from '@/lib/point-a/analysis-cache'

const base = {
  answers: { s1_company_name: 'Альфа', s1_current_revenue_month: 1_000_000 },
  pointA: { overall_score: 55, blocks: { finance: { score: 40 } } },
  company: { id: 'c1', name: 'Альфа', industry: 'retail', updated_at: '2026-09-01' },
  expertNotes: {},
  locale: 'ru',
}

describe('Point A analysis input hash', () => {
  it('is independent of object key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }))
      .toBe(stableStringify({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }))
  })

  it('ignores volatile company columns but reacts to real changes', () => {
    const h = pointAAnalysisInputHash(base)
    expect(pointAAnalysisInputHash({ ...base, company: { ...base.company, updated_at: '2026-09-24', id: 'c2' } })).toBe(h)
    expect(pointAAnalysisInputHash({ ...base, answers: { ...base.answers, s1_current_revenue_month: 1_000_001 } })).not.toBe(h)
    expect(pointAAnalysisInputHash({ ...base, locale: 'kk' })).not.toBe(h)
  })
})

describe('analyzeWithInputCache', () => {
  it('skips the LLM entirely on a cache hit and records the hit', async () => {
    const analyze = vi.fn(async (): Promise<Record<string, boolean> | null> => ({ fresh: true }))
    const onCacheHit = vi.fn()
    const r = await analyzeWithInputCache('h', { findCached: async (): Promise<Record<string, boolean> | null> => ({ cached: true }), analyze, onCacheHit })
    expect(r).toEqual({ result: { cached: true }, cached: true })
    expect(analyze).not.toHaveBeenCalled()
    expect(onCacheHit).toHaveBeenCalledTimes(1)
  })

  it('runs the analysis on a miss or when the cache lookup fails', async () => {
    const analyze = vi.fn(async () => ({ fresh: true }))
    await expect(analyzeWithInputCache('h', { findCached: async () => null, analyze })).resolves.toEqual({ result: { fresh: true }, cached: false })
    await expect(analyzeWithInputCache('h', { findCached: async () => { throw new Error('no column') }, analyze })).resolves.toMatchObject({ cached: false })
    expect(analyze).toHaveBeenCalledTimes(2)
  })
})
