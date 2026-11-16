/**
 * N4A-12 (R4-A2) — after a Point A recalculation the paid AI analysis (fireAiFanOut, up to 150 s)
 * and the AI hypotheses (a model call per block without data) ran in the background with no common
 * limit: a wave of snapshots (the nightly pass after a config-version change, a bulk «→ Pro») started
 * one of each per company at once. Now both take a slot of lib/point-a/ai-slots.ts: at most 2 per
 * process, the rest wait; too many waiting → the analysis is marked failed ('busy', «Повторить»).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  inFlight: 0,
  peak: 0,
  hypotheses: 0,
  hold: 30,
}))

/** One AI job: counted while it runs. */
async function aiJob(): Promise<void> {
  h.inFlight += 1
  h.peak = Math.max(h.peak, h.inFlight)
  await new Promise((r) => setTimeout(r, h.hold))
  h.inFlight -= 1
}

vi.mock('@/lib/agents/queue', () => ({ enqueueAgentTask: async () => ({ id: 't-1' }) }))
vi.mock('@/lib/background', () => ({
  runInBackground: async (_l: string, work: () => Promise<unknown>) => { await work() },
  trackBackground: () => undefined,
}))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => undefined }))
vi.mock('@/lib/internal-auth', () => ({ internalBaseUrl: () => 'https://app.test', internalFetchHeaders: () => ({}) }))
vi.mock('@/lib/ai/budget', () => ({ assertAiBudget: async () => undefined, isAiBudgetError: () => false }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  }),
}))
vi.mock('@/lib/point-a/v4/hypotheses', () => ({
  blocksNeedingHypothesis: (blocks: Array<{ status?: string }>) => blocks.filter((b) => b.status === 'insufficient_data'),
  carryOverHypotheses: (blocks: unknown[]) => [...blocks],
  generateHypotheses: async (blocks: unknown[]) => {
    h.hypotheses += 1
    await aiJob()
    return { blocks, generated: 0 }
  },
}))

const { fireAiFanOut } = await import('@/lib/point-a/diagnostic-row')
const { runAfterWrite } = await import('@/lib/point-a/snapshot')
const { pointAAiSlots, resetPointAAiSlotsForTests } = await import('@/lib/point-a/ai-slots')
const { createSemaphore } = await import('@/lib/agents/run-slots')

const BASE = 'https://app.test'
const ANALYZE = '/api/v1/diagnostics/ai-analyze' as const
const BLOCK_NEEDING = { key: 'marketing', title: 'Маркетинг', weight: 0.2, hiddenForClient: false, informational: false, order: 1, status: 'insufficient_data', score: null, coverage: 0.2, confidence: 0.1, earned: 1, possible: 2, checks: [], top_issues: [], recommendations: [], needs: [], conflicts: [], inputsHash: 'x' }

const fetchImpl: typeof fetch = async () => {
  await aiJob()
  return new Response('{"ok":true}', { status: 200 })
}

beforeEach(() => {
  h.inFlight = 0
  h.peak = 0
  h.hypotheses = 0
  h.hold = 30
  resetPointAAiSlotsForTests()
  process.env.OPENROUTER_API_KEY = 'k'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  resetPointAAiSlotsForTests()
})

describe('N4A-12 the Point A AI slots', () => {
  it('two per process by default, read from the environment once', () => {
    expect(pointAAiSlots().limit).toBe(2)
    expect(pointAAiSlots()).toBe(pointAAiSlots())
    resetPointAAiSlotsForTests()
    vi.stubEnv('POINT_A_AI_MAX_CONCURRENCY', '3')
    expect(pointAAiSlots().limit).toBe(3)
  })

  it('10 analyses fired at once: at most 2 run, all 10 finish, none is marked failed', async () => {
    const works: Promise<unknown>[] = []
    const failed: string[] = []
    for (let i = 0; i < 10; i += 1) {
      fireAiFanOut({ baseUrl: BASE, diagnosticId: `d-${i}`, userId: `u-${i}`, locale: 'ru', paths: [ANALYZE] }, {
        fetchImpl, track: (w) => { works.push(w) }, markFailed: async (_p, o) => { failed.push(o.diagnosticId) }, log: () => {},
      })
    }
    expect(works).toHaveLength(10) // tracked at once: a redeploy waits for the waiting ones too
    await Promise.all(works)
    expect(h.peak).toBe(2)
    expect(failed).toEqual([])
    expect(pointAAiSlots().active()).toBe(0)
  })

  it('too many waiting: the extra analysis is marked failed «busy» at once (the client gets «Повторить»)', async () => {
    const slots = createSemaphore({ limit: 2, maxWaiting: 1, maxWaitMs: 60_000 })
    const works: Promise<unknown>[] = []
    const failed: Array<{ id: string; reason: string }> = []
    let fetched = 0
    const counting: typeof fetch = async (...args) => { fetched += 1; return fetchImpl(...args) }
    for (let i = 0; i < 4; i += 1) {
      fireAiFanOut({ baseUrl: BASE, diagnosticId: `d-${i}`, userId: 'u', locale: 'ru', paths: [ANALYZE] }, {
        fetchImpl: counting, slots, track: (w) => { works.push(w) }, markFailed: async (_p, o, reason) => { failed.push({ id: o.diagnosticId, reason }) }, log: () => {},
      })
    }
    await Promise.all(works)
    expect(fetched).toBe(3)
    expect(failed).toEqual([{ id: 'd-3', reason: 'busy' }])
    expect(h.peak).toBe(2)
  })

  it('a call that throws gives its slot back', async () => {
    const slots = createSemaphore({ limit: 1, maxWaiting: 5, maxWaitMs: 60_000 })
    const works: Promise<unknown>[] = []
    const reasons: string[] = []
    const opts = (i: number) => ({ baseUrl: BASE, diagnosticId: `d-${i}`, userId: 'u', locale: 'ru', paths: [ANALYZE] })
    const deps = { slots, track: (w: Promise<unknown>) => { works.push(w) }, markFailed: async (_p: string, _o: unknown, r: string) => { reasons.push(r) }, log: () => {} }
    fireAiFanOut(opts(1), { ...deps, fetchImpl: async () => { throw new TypeError('fetch failed') } })
    fireAiFanOut(opts(2), { ...deps, fetchImpl })
    await Promise.all(works)
    expect(reasons).toEqual(['TypeError'])
    expect(slots.active()).toBe(0)
  })

  it('10 snapshots written at once: hypotheses and analyses together, never more than 2 AI jobs', async () => {
    vi.stubGlobal('fetch', fetchImpl)
    const input = (i: number) => ({
      companyId: `co-${i}`, ownerId: `owner-${i}`, diagnosticId: `d-${i}`, snapshotId: `s-${i}`, engine: 'v4' as const,
      written: { overall_score: 61 } as never, preliminary: false, noScore: false, changes: [], trigger: 'schedule' as const,
      locale: 'ru', blocks: [BLOCK_NEEDING] as never, industry: null, paidPaths: [ANALYZE] as const,
    })

    await Promise.all(Array.from({ length: 10 }, (_, i) => runAfterWrite(input(i))))
    // the analyses are fire-and-forget: wait until the slots are free again
    await vi.waitFor(() => expect(pointAAiSlots().active() + pointAAiSlots().waiting()).toBe(0), { timeout: 5_000 })

    expect(h.hypotheses).toBe(10)
    expect(h.peak).toBe(2)
  })
})
