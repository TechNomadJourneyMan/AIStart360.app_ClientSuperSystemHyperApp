/**
 * Page-load request de-duplication: one onboarding-status / GRI request per
 * burst of mounts, a fresh request once the result is older than the window,
 * and per-request memoisation that is a plain call outside a server render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  SHARED_STALE_MS,
  getGriAssessmentEnvelope,
  getOnboardingStatus,
} from '@/hooks/useOnboardingStatus'
import { requestCache } from '@/lib/request-cache'

const STATUS = {
  survey: { completed_steps: 3, total_steps: 12, percent: 25, is_complete: false, current_goal_12m: null, current_goal_3y: null },
  documents: { count: 2, has_files: true },
}

let calls: string[] = []
beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    if (url === '/api/v1/onboarding/status') return new Response(JSON.stringify({ ok: true, data: STATUS }))
    if (url === '/api/v1/gri/assessment') return new Response(JSON.stringify({ ok: true, data: { current: { gri_index: 7 } } }))
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('shared onboarding-status / GRI reads', () => {
  it('merges concurrent readers into one request each', async () => {
    const qc = new QueryClient()
    const [a, b, c, g1, g2] = await Promise.all([
      getOnboardingStatus(qc),
      getOnboardingStatus(qc),
      getOnboardingStatus(qc),
      getGriAssessmentEnvelope(qc),
      getGriAssessmentEnvelope(qc),
    ])
    expect(a).toEqual(STATUS)
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(g1?.data?.current?.gri_index).toBe(7)
    expect(g2).toBe(g1)
    expect(calls.filter((u) => u === '/api/v1/onboarding/status')).toHaveLength(1)
    expect(calls.filter((u) => u === '/api/v1/gri/assessment')).toHaveLength(1)
  })

  it('reads again once the result is older than the sharing window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const qc = new QueryClient()
    await getOnboardingStatus(qc)
    await getOnboardingStatus(qc)
    expect(calls).toHaveLength(1)
    vi.setSystemTime(Date.now() + SHARED_STALE_MS + 1)
    await getOnboardingStatus(qc)
    expect(calls).toHaveLength(2)
  })

  it('a non-ok answer is "no status", an HTTP error on GRI is "no envelope"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 401 })))
    const qc = new QueryClient()
    expect(await getOnboardingStatus(qc)).toBeNull()
    expect(await getGriAssessmentEnvelope(qc)).toBeNull()
  })
})

describe('requestCache', () => {
  it('outside a server render every call runs (no cross-request memo)', async () => {
    let n = 0
    const f = requestCache(async (x: string) => `${x}${++n}`)
    expect(await f('a')).toBe('a1')
    expect(await f('a')).toBe('a2')
  })
})
