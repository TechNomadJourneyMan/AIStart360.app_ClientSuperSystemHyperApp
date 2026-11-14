/**
 * BE-13 — fireAiFanOut (lib/point-a/diagnostic-row.ts) started the AI analysis and the Point B
 * bridge with a bare fetch: no timeout, not tracked (a redeploy cut it), the answer never looked at.
 * When the call failed, `ai_status` stayed 'processing' and the client showed «ИИ анализирует…»
 * forever. Now: a timeout, tracked as background work, and a failed call marks the status 'failed'
 * (which the UI shows with its retry button).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/internal-auth', () => ({ internalFetchHeaders: () => ({ 'x-internal': 't' }) }))

const { fireAiFanOut, FAN_OUT_TIMEOUT_MS } = await import('@/lib/point-a/diagnostic-row')

const BASE = 'https://portal.example.test'
const opts = { baseUrl: BASE, diagnosticId: 'd-1', userId: 'u-1', locale: 'ru' }
const AI = '/api/v1/diagnostics/ai-analyze'
const PB = '/api/v1/diagnostics/point-b/ai-generate'

function deps(answer: (path: string) => Promise<Response>) {
  const tracked: Promise<unknown>[] = []
  const failed: Array<{ path: string; reason: string }> = []
  const fetchImpl = vi.fn<typeof fetch>(async (input) => answer(new URL(String(input)).pathname))
  return {
    tracked,
    failed,
    fetchImpl,
    d: {
      fetchImpl,
      track: (p: Promise<unknown>) => { tracked.push(p) },
      markFailed: async (path: string, _o: typeof opts, reason: string) => { failed.push({ path, reason }) },
      log: () => {},
    },
  }
}

afterEach(() => vi.restoreAllMocks())

describe('BE-13 fireAiFanOut', () => {
  it('has a bounded default timeout', () => {
    expect(FAN_OUT_TIMEOUT_MS).toBeGreaterThan(45_000)
    expect(FAN_OUT_TIMEOUT_MS).toBeLessThanOrEqual(180_000)
  })

  it('tracks both calls as background work and sends each with an abort signal', async () => {
    const t = deps(async () => new Response('{"ok":true}', { status: 200 }))
    fireAiFanOut(opts, t.d)
    expect(t.tracked).toHaveLength(2)
    await Promise.all(t.tracked)
    expect(t.fetchImpl).toHaveBeenCalledTimes(2)
    for (const call of t.fetchImpl.mock.calls) expect(call[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(t.failed).toEqual([])
  })

  it('marks the status failed when a call answers non-2xx', async () => {
    const t = deps(async (path) => new Response('{}', { status: path === AI ? 502 : 200 }))
    fireAiFanOut(opts, t.d)
    await Promise.all(t.tracked)
    expect(t.failed).toEqual([{ path: AI, reason: 'http_502' }])
  })

  it('marks the status failed when a call throws or times out', async () => {
    const t = deps(async (path) => {
      if (path === PB) throw new DOMException('timed out', 'TimeoutError')
      throw new TypeError('fetch failed')
    })
    fireAiFanOut(opts, t.d)
    await Promise.all(t.tracked)
    expect(t.failed.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: AI, reason: 'TypeError' },
      { path: PB, reason: 'TimeoutError' },
    ])
  })

  it('never rejects, even when marking the status fails', async () => {
    const t = deps(async () => { throw new TypeError('fetch failed') })
    fireAiFanOut(opts, { ...t.d, markFailed: async () => { throw new Error('db down') } })
    await expect(Promise.all(t.tracked)).resolves.toBeDefined()
  })
})
