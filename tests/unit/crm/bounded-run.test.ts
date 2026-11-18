/**
 * lib/crm/bounded-run.ts + the digest's budget (review: crm-digest ran 25 owners at a time; the
 * platform's rule for background work is ≤ 2 at a time and ≤ 45 s per run).
 */
import { describe, expect, it } from 'vitest'
import { dayRotation, runBounded } from '@/lib/crm/bounded-run'
import { DIGEST_CONCURRENCY, DIGEST_MIN_START_MS, DIGEST_RUN_MS } from '@/lib/crm/digest'

describe('runBounded', () => {
  it('never runs more than `concurrency` items at once', async () => {
    let running = 0
    let peak = 0
    const res = await runBounded(Array.from({ length: 9 }, (_, i) => i), { concurrency: 2, deadlineAt: Date.now() + 60_000, minStartMs: 0 }, async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 2))
      running--
    })
    expect(peak).toBe(2)
    expect(res).toEqual({ started: 9, deferred: 0 })
  })

  it('starts nothing with less than minStartMs left; the rest is reported as deferred', async () => {
    let t = 0
    const done: number[] = []
    const res = await runBounded([1, 2, 3, 4, 5], { concurrency: 2, deadlineAt: 40, minStartMs: 15, now: () => t }, async (i) => {
      t += 10 // every item takes 10 «ms»
      done.push(i)
    })
    // starts at t=0 and t=10 → after those, 20 left ≥ 15 → one more start (t=20); then 10 left < 15
    expect(res.started).toBe(3)
    expect(res.deferred).toBe(2)
    expect(done).toEqual([1, 2, 3])
  })

  it('one failing item does not stop the others', async () => {
    const res = await runBounded([1, 2, 3], { concurrency: 1, deadlineAt: Date.now() + 60_000, minStartMs: 0 }, async (i) => {
      if (i === 2) throw new Error('boom')
    })
    expect(res).toEqual({ started: 3, deferred: 0 })
  })

  it('the digest keeps to the rule: ≤ 2 at a time, the run within 45 s', () => {
    expect(DIGEST_CONCURRENCY).toBeLessThanOrEqual(2)
    expect(DIGEST_RUN_MS).toBeLessThanOrEqual(45_000)
    expect(DIGEST_MIN_START_MS).toBeGreaterThan(0)
  })

  it('dayRotation is stable within a day and differs between days', () => {
    expect(dayRotation('2026-11-19', 'u1')).toBe(dayRotation('2026-11-19', 'u1'))
    const order = (day: string) => ['a', 'b', 'c', 'd', 'e', 'f'].sort((x, y) => dayRotation(day, x) - dayRotation(day, y)).join('')
    expect(order('2026-11-19')).not.toBe(order('2026-11-20'))
  })
})
