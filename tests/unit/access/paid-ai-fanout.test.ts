/**
 * R2-A (ревью M-3): the paid AI of Point A (analysis, ~4 model calls) and the
 * Point B bridge are not run for a Free owner — no cost, nothing left
 * «processing» or marked «failed»; after the move to Pro the skipped AI runs
 * (catchUpPaidAi, from billing and from opening a section individually).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPointASnapshot, type SnapshotDeps } from '@/lib/point-a/snapshot'
import { resolveAllMetrics } from '@/lib/metrics/resolver'
import { memoryClient } from '../data-layer/memory-client'
import { CURRENT_TYPICAL } from '../point-a/fixtures/answer-sets'

const s = vi.hoisted(() => ({
  sections: { point_a: false, point_b: false } as Record<string, boolean>,
  official: { state: 'scored' } as { state: string } | null,
}))

vi.mock('@/lib/access/decision', async () => {
  const real = await vi.importActual<typeof import('@/lib/access/decision')>('@/lib/access/decision')
  return {
    ...real,
    resolveFeature: async (_sb: unknown, _u: string, f: string) => ({ allowed: !!s.sections[f], reason: s.sections[f] ? 'entitled' : 'upgrade_required', ent: {}, gatesEnabled: true }),
  }
})
vi.mock('@/lib/point-a/official', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/lib/point-a/official')),
  getOfficialPointA: async () => s.official,
}))

const row = await import('@/lib/point-a/diagnostic-row')
const ANALYZE = '/api/v1/diagnostics/ai-analyze'
const POINT_B = '/api/v1/diagnostics/point-b/ai-generate'

beforeEach(() => {
  s.sections = { point_a: false, point_b: false }
  s.official = { state: 'scored' }
})

describe('paidFanOutPaths — decided for the OWNER', () => {
  it('Free → no paid call; Pro → the analysis only (R3, S3: the Point B AI strategy is a staff draft); Point A only → the analysis', async () => {
    expect(await row.paidFanOutPaths({} as never, 'owner')).toEqual([])
    s.sections = { point_a: true, point_b: true }
    expect(await row.paidFanOutPaths({} as never, 'owner')).toEqual([ANALYZE])
    expect(await row.paidFanOutPaths({} as never, 'owner')).not.toContain(POINT_B)
    s.sections = { point_a: true, point_b: false }
    expect(await row.paidFanOutPaths({} as never, 'owner')).toEqual([ANALYZE])
  })
})

describe('fireAiFanOut honours the paths', () => {
  it('only the given calls are made; none → no request at all', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: string) => { urls.push(url); return new Response('{}', { status: 200 }) }) as unknown as typeof fetch
    const works: Promise<unknown>[] = []
    process.env.INTERNAL_TOKEN_SECRET = 'test-internal-secret-0123456789abcdef'
    row.fireAiFanOut({ baseUrl: 'https://app.test', diagnosticId: 'd', userId: 'u', locale: 'ru', paths: [ANALYZE] }, { fetchImpl, track: (w) => { works.push(w) }, markFailed: async () => undefined })
    row.fireAiFanOut({ baseUrl: 'https://app.test', diagnosticId: 'd', userId: 'u', locale: 'ru', paths: [] }, { fetchImpl, track: (w) => { works.push(w) }, markFailed: async () => undefined })
    await Promise.all(works)
    delete process.env.INTERNAL_TOKEN_SECRET
    expect(urls).toEqual([`https://app.test${ANALYZE}`])
  })
})

describe('the Point A snapshot for a Free owner', () => {
  function setup() {
    const m = memoryClient({ companies: [{ id: 'co', user_id: 'owner', industry: 'Услуги' }], point_a_snapshots: [], diagnostics: [] })
    const after = vi.fn()
    const store = vi.fn(async (_db: unknown, o: { result: { overall_score: number }; aiStatus: string }) => ({ ok: true as const, diag: { id: 'diag-1', overall_score: o.result.overall_score } }))
    const deps: SnapshotDeps = {
      service: () => m.client,
      materialize: async () => ({ values: resolveAllMetrics({ companyId: 'co', userId: 'owner', surveyAnswers: CURRENT_TYPICAL, documents: [], now: new Date('2026-10-12') }), surveyAnswers: CURRENT_TYPICAL }),
      useV4: async () => false,
      store: store as unknown as SnapshotDeps['store'],
      lock: async () => ({ release: async () => undefined }),
      afterWrite: after,
      paidAi: async (sb, owner) => row.paidFanOutPaths(sb, owner),
    }
    return { deps, after, store }
  }

  it('Free: the diagnostic is stored with ai_status «none» (not «processing»), afterWrite gets no paid path', async () => {
    const prev = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = 'k'
    try {
      const { deps, after, store } = setup()
      await buildPointASnapshot('co', { trigger: 'event' }, deps)
      expect(store.mock.calls[0][1]).toMatchObject({ aiStatus: 'none' })
      expect(after).toHaveBeenCalledWith(expect.objectContaining({ paidPaths: [] }))
    } finally {
      process.env.OPENROUTER_API_KEY = prev
    }
  })

  it('Pro: «processing» and the paid analysis (never the Point B AI strategy — R3, S3)', async () => {
    const prev = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = 'k'
    s.sections = { point_a: true, point_b: true }
    try {
      const { deps, after, store } = setup()
      await buildPointASnapshot('co', { trigger: 'event' }, deps)
      expect(store.mock.calls[0][1]).toMatchObject({ aiStatus: 'processing' })
      expect(after).toHaveBeenCalledWith(expect.objectContaining({ paidPaths: [ANALYZE] }))
    } finally {
      process.env.OPENROUTER_API_KEY = prev
    }
  })
})

describe('catchUpPaidAi — after the move to Pro', () => {
  function fakeSb(diag: Record<string, unknown> | null) {
    const updates: unknown[] = []
    const sb = {
      updates,
      from: () => {
        const b: Record<string, unknown> = {}
        const self = () => b
        let updating = false
        Object.assign(b, {
          select: self, eq: self, is: self,
          update: (p: unknown) => { updates.push(p); updating = true; return b },
          maybeSingle: async () => ({ data: diag, error: null }),
          // the claim (R3-PA M1) reads the rows it changed
          then: (res: (v: unknown) => unknown) => Promise.resolve({ data: updating && diag ? [{ id: diag.id }] : null, error: null }).then(res),
        })
        return b
      },
    }
    return sb
  }

  it('Pro now: the analysis that did not run (ai_status none) is fired — not the Point B AI strategy (R3, S3)', async () => {
    s.sections = { point_a: true, point_b: true }
    const sb = fakeSb({ id: 'd-1', ai_status: 'none' })
    const fire = vi.fn()
    const fired = await row.catchUpPaidAi('owner', { sb: sb as never, baseUrl: 'https://app.test', fire })
    expect(fired).toEqual([ANALYZE])
    expect(sb.updates).toEqual([{ ai_status: 'processing', ai_started_at: expect.any(String) }])
    expect(fire).toHaveBeenCalledWith(expect.objectContaining({ diagnosticId: 'd-1', userId: 'owner', paths: [ANALYZE] }))
  })

  it('still Free / no scored Point A / analysis already done → nothing (or only the missing part)', async () => {
    const fire = vi.fn()
    expect(await row.catchUpPaidAi('owner', { sb: fakeSb({ id: 'd-1', ai_status: 'none' }) as never, baseUrl: 'https://app.test', fire })).toEqual([])
    s.sections = { point_a: true, point_b: true }
    s.official = { state: 'preliminary' }
    expect(await row.catchUpPaidAi('owner', { sb: fakeSb({ id: 'd-1', ai_status: 'none' }) as never, baseUrl: 'https://app.test', fire })).toEqual([])
    s.official = { state: 'scored' }
    // the analysis is done: nothing is left to run (the Point B AI strategy is a staff draft — R3, S3)
    expect(await row.catchUpPaidAi('owner', { sb: fakeSb({ id: 'd-1', ai_status: 'completed' }) as never, baseUrl: 'https://app.test', fire })).toEqual([])
    expect(fire).not.toHaveBeenCalled()
  })

  it('billing runs the catch-up when the plan gives Pro; opening Точка А / Б individually too', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('lib/payments/billing.ts', 'utf8')).toMatch(/res\.profile_tier === 'pro'[\s\S]{0,400}catchUpPaidAi\(userId\)/)
    expect(readFileSync('app/api/giga-admin/users/[id]/access/route.ts', 'utf8')).toMatch(/point_a === true \|\| patch\.feature_flags\.point_b === true[\s\S]{0,400}catchUpPaidAi\(userId\)/)
    // R3-PA (B4): the recalculation route has no fan-out of its own any more — a
    // company goes only through the snapshot, which decides the paid calls for
    // the OWNER (deps.paidAi → paidFanOutPaths); without a company there is no AI.
    const recalc = readFileSync('app/api/v1/diagnostics/recalculate/route.ts', 'utf8')
    expect(recalc).not.toContain('fireAiFanOut')
    expect(recalc).toContain('buildPointASnapshot(')
    expect(readFileSync('lib/point-a/snapshot.ts', 'utf8')).toContain("paidAi: async (service, ownerId) => (await import('./diagnostic-row')).paidFanOutPaths(service, ownerId)")
  })
})
