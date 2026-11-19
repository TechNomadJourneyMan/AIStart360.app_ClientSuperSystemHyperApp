/**
 * refundRateLimit (R5 review of wave 1B, L-3): give back one hit counted by checkRateLimit /
 * isRateLimitedKey — a limiter that should count only FAILED attempts reserves a slot before the
 * check (so concurrent attempts cannot all pass) and refunds it when the attempt succeeded.
 * Every store: memory (here), Upstash (a negative rate — the refund @upstash/ratelimit supports),
 * Postgres (tests/integration/db/rate-limit.test.ts). Never throws; a store without refund is a no-op.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const up = vi.hoisted(() => ({ calls: [] as Array<{ key: string; rate?: number }> }))
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: () => ({}) } }))
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: Object.assign(
    class {
      async limit(key: string, opts?: { rate?: number }) {
        up.calls.push({ key, rate: opts?.rate })
        return { success: true, remaining: 1, reset: Date.now() + 1000 }
      }
    },
    { slidingWindow: () => ({}) },
  ),
}))

const rl = await import('@/lib/rate-limit')
const { createMemoryStore } = await import('@/lib/rate-limit/memory')
const { createUpstashStore } = await import('@/lib/rate-limit/upstash')

afterEach(() => rl.__setRateLimitStoreForTests(null))

describe('memory store refund', () => {
  it('gives one hit back: a full window admits one more', async () => {
    const s = createMemoryStore()
    for (let i = 0; i < 3; i++) expect((await s.hit('k', 60, 3)).allowed).toBe(true)
    expect((await s.hit('k', 60, 3)).allowed).toBe(false)
    await s.refund!('k', 60, 3)
    expect((await s.hit('k', 60, 3)).allowed).toBe(true)
    expect((await s.hit('k', 60, 3)).allowed).toBe(false)
  })

  it('a refund after the window rolled over takes the hit back from the previous window', async () => {
    let t = 60_000 * 16_666_667 // the start of a 60-second window
    const s = createMemoryStore({ now: () => t })
    for (let i = 0; i < 3; i++) await s.hit('k', 60, 3)
    t += 60_000 // the next window starts: the 3 hits now weigh from the previous one
    expect((await s.hit('k', 60, 3)).allowed).toBe(false)
    await s.refund!('k', 60, 3)
    expect((await s.hit('k', 60, 3)).allowed).toBe(true)
  })

  it('never goes below zero; an unknown key is a no-op', async () => {
    const s = createMemoryStore()
    await s.refund!('nobody', 60, 2)
    await s.hit('k', 60, 2)
    await s.refund!('k', 60, 3)
    await s.refund!('k', 60, 3)
    expect((await s.hit('k', 60, 2)).allowed).toBe(true)
    expect((await s.hit('k', 60, 2)).allowed).toBe(true)
    expect((await s.hit('k', 60, 2)).allowed).toBe(false)
  })
})

describe('Upstash store refund', () => {
  it('is a negative rate on the same key (the refund of @upstash/ratelimit)', async () => {
    up.calls = []
    const s = createUpstashStore()
    await s.hit('bucket:abc', 600, 8)
    await s.refund!('bucket:abc', 600, 8)
    expect(up.calls).toEqual([{ key: 'bucket:abc', rate: undefined }, { key: 'bucket:abc', rate: -1 }])
  })
})

describe('refundRateLimit (module)', () => {
  it('refunds the hit of the same identifier and bucket (keys are hashed alike)', async () => {
    rl.__setRateLimitStoreForTests(createMemoryStore())
    const opts = { max: 2, windowMs: 600_000 }
    expect(await rl.isRateLimitedKey('owner@example.test', 'b', opts)).toBe(false)
    expect(await rl.isRateLimitedKey('owner@example.test', 'b', opts)).toBe(false)
    expect(await rl.isRateLimitedKey('owner@example.test', 'b', opts)).toBe(true)
    await rl.refundRateLimit('owner@example.test', 'b', opts)
    expect(await rl.isRateLimitedKey('owner@example.test', 'b', opts)).toBe(false)
  })

  it('never throws: a store without refund, or a failing one, is a no-op', async () => {
    rl.__setRateLimitStoreForTests({ backend: 'postgres', hit: async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }) })
    await expect(rl.refundRateLimit('x', 'b')).resolves.toBeUndefined()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    rl.__setRateLimitStoreForTests({
      backend: 'postgres',
      hit: async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }),
      refund: async () => { throw new Error('db down') },
    })
    await expect(rl.refundRateLimit('x', 'b')).resolves.toBeUndefined()
    quiet.mockRestore()
  })
})
