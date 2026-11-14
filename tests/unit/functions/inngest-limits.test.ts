/**
 * BE-05 / BE-06 — every Inngest function has a function-wide concurrency limit (the project rule:
 * background work at most two at a time; a limit only per conversation / company lets N
 * conversations run N processors at once) and `timeouts` (start: a run that waited too long in the
 * queue is dropped — the Postgres queues and the next cron pick the work up; finish: a run that never
 * ends is cancelled instead of holding its concurrency slot forever).
 */
import { describe, expect, it } from 'vitest'
import { inngestFunctionsForRole } from '@/lib/functions/registry'
import { INNGEST_FUNCTION_CONCURRENCY } from '@/lib/functions/limits'

type Conc = { limit: number; key?: string; scope?: string }
type Cfg = { id: string; concurrency?: number | Conc | Conc[]; timeouts?: { start?: string; finish?: string } }

const cfgOf = (fn: unknown): Cfg => {
  const f = fn as { opts?: Cfg; cfg?: Cfg }
  return (f.opts ?? f.cfg) as Cfg
}

/** "45s", "2m", "26h", "4d", "1h30m" → ms. */
function durationMs(value: string): number {
  const parts = [...value.matchAll(/(\d+)([wdhms])/g)]
  if (!parts.length || parts.map((p) => p[0]).join('') !== value) return Number.NaN
  const unit: Record<string, number> = { w: 604_800_000, d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 }
  return parts.reduce((sum, p) => sum + Number(p[1]) * unit[p[2]], 0)
}

/** A limit that holds across all runs of the function: no key, or a constant (quoted) key. */
function functionWideLimit(c: Cfg['concurrency']): number | null {
  if (c === undefined) return null
  if (typeof c === 'number') return c
  const list = Array.isArray(c) ? c : [c]
  const wide = list.filter((x) => !x.key || /^"[^"]*"$/.test(x.key))
  return wide.length ? Math.min(...wide.map((x) => x.limit)) : null
}

const all = inngestFunctionsForRole('all').map(cfgOf)

describe('BE-05/06 Inngest limits', () => {
  it('covers every registered function', () => {
    expect(all.length).toBeGreaterThanOrEqual(18)
  })

  it.each(all.map((c) => [c.id, c] as const))('%s has a function-wide concurrency limit ≤ 2', (_id, cfg) => {
    const limit = functionWideLimit(cfg.concurrency)
    expect(limit).not.toBeNull()
    expect(limit!).toBeLessThanOrEqual(Math.max(2, INNGEST_FUNCTION_CONCURRENCY))
  })

  it.each(all.map((c) => [c.id, c] as const))('%s has timeouts.start and timeouts.finish', (_id, cfg) => {
    expect(cfg.timeouts?.start).toBeTruthy()
    expect(cfg.timeouts?.finish).toBeTruthy()
    expect(durationMs(cfg.timeouts!.start!)).toBeGreaterThan(0)
    expect(durationMs(cfg.timeouts!.finish!)).toBeGreaterThan(0)
  })

  it('the two event-driven processors that only had a per-key limit now share a global one', () => {
    const byId = new Map(all.map((c) => [c.id, c]))
    for (const id of ['process-omnichannel-message', 'point-a-recalc']) {
      const c = byId.get(id)!.concurrency as Conc[]
      expect(Array.isArray(c)).toBe(true)
      expect(c.find((x) => !x.key)?.limit).toBe(INNGEST_FUNCTION_CONCURRENCY)
      expect(c.find((x) => x.key)?.limit).toBe(1) // per conversation / company: still one at a time
    }
    expect(INNGEST_FUNCTION_CONCURRENCY).toBe(2)
  })

  it('a cron run that waited longer than its period is dropped (start < period)', () => {
    const byId = new Map(all.map((c) => [c.id, c]))
    expect(durationMs(byId.get('agents-maintenance')!.timeouts!.start!)).toBeLessThan(60_000)
    expect(durationMs(byId.get('comm-escalations')!.timeouts!.start!)).toBeLessThan(5 * 60_000)
    expect(durationMs(byId.get('omnichannel-outbound-delivery-maintenance')!.timeouts!.start!)).toBeLessThan(5 * 60_000)
  })

  it('finish never cuts a run that legitimately sleeps (reply delay up to 24 h, campaign windows)', () => {
    const byId = new Map(all.map((c) => [c.id, c]))
    expect(durationMs(byId.get('process-omnichannel-message')!.timeouts!.finish!)).toBeGreaterThan(24 * 3_600_000)
    expect(durationMs(byId.get('comm-campaign-run')!.timeouts!.finish!)).toBeGreaterThanOrEqual(3 * 86_400_000)
  })
})
