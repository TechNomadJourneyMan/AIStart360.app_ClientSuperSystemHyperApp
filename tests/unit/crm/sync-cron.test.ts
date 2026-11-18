/**
 * lib/crm/sync-cron.ts — the automatic CRM sync run, with a fake clock, a fake service client and a
 * fake per-connection sync:
 *   • which connections: active, never synced first, then those older than 6 h (the queries);
 *   • never more than 2 syncs at once (the incident rule for background work);
 *   • the run ends within 44 s: each sync's deadline is ≤ the run's end, and no sync starts with
 *     less than 12 s left — the rest is deferred to the next run;
 *   • a failure (or a throw) of one connection does not stop the others; a throw is recorded on that
 *     connection as 'error', and the error hook fires for it.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CRM_AUTO_SYNC_INTERVAL_MS,
  CRM_AUTO_SYNC_MIN_START_MS,
  CRM_AUTO_SYNC_RUN_MS,
  runCrmAutoSync,
} from '@/lib/crm/sync-cron'
import type { CrmSyncReport, SyncConnection, SyncOptions } from '@/lib/crm/sync'

type Filter = [string, string, unknown]

function fakeSb(never: SyncConnection[], stale: SyncConnection[]) {
  const queries: Filter[][] = []
  const updates: Array<{ patch: Record<string, unknown>; filters: Filter[] }> = []
  const from = (table: string) => {
    expect(table).toBe('crm_provider_connections')
    const filters: Filter[] = []
    let patch: Record<string, unknown> | null = null
    const q = {
      select: () => q,
      update: (p: Record<string, unknown>) => { patch = p; return q },
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return q },
      is: (c: string, v: unknown) => { filters.push(['is', c, v]); return q },
      lt: (c: string, v: unknown) => { filters.push(['lt', c, v]); return q },
      order: (c: string, o: unknown) => { filters.push(['order', c, o]); return q },
      limit: (n: number) => { filters.push(['limit', '', n]); return q },
      then: (ok: (r: unknown) => unknown) => {
        if (patch) { updates.push({ patch, filters }); return Promise.resolve({ data: null, error: null }).then(ok) }
        queries.push(filters)
        const data = filters.some((f) => f[0] === 'is') ? never : stale
        return Promise.resolve({ data, error: null }).then(ok)
      },
    }
    return q
  }
  return { sb: { from } as unknown as SupabaseClient, queries, updates }
}

const conn = (i: number): SyncConnection => ({ id: `c${i}`, user_id: `u${i}`, provider: 'bitrix24', base_url: 'acme.bitrix24.kz', access_token: 't' })
const report = (status: CrmSyncReport['status']) => ({ status, message: status } as CrmSyncReport)

/** A clock that only moves when a fake sync says so. */
function clock(t0 = Date.UTC(2026, 10, 18, 10, 17)) {
  let t = t0
  return { now: () => t, advance: (ms: number) => { t += ms }, t0 }
}

describe('runCrmAutoSync', () => {
  it('picks active connections never synced, then those last synced more than 6 h ago (oldest first)', async () => {
    const c = clock()
    const f = fakeSb([conn(1)], [conn(2)])
    const synced: string[] = []
    const res = await runCrmAutoSync({ sb: f.sb, now: c.now, sync: async (_sb, x) => { synced.push(x.id); return report('success') } })
    expect(synced.sort()).toEqual(['c1', 'c2'])
    expect(res).toMatchObject({ due: 2, started: 2, success: 2, deferred: 0 })
    const [neverQ, staleQ] = f.queries
    expect(neverQ).toEqual(expect.arrayContaining([['eq', 'is_active', true], ['is', 'last_sync_at', null]]))
    expect(staleQ).toEqual(expect.arrayContaining([
      ['eq', 'is_active', true],
      ['lt', 'last_sync_at', new Date(c.t0 - CRM_AUTO_SYNC_INTERVAL_MS).toISOString()],
      ['order', 'last_sync_at', { ascending: true }],
    ]))
  })

  it('never runs more than two syncs at once', async () => {
    const c = clock()
    const f = fakeSb(Array.from({ length: 7 }, (_, i) => conn(i)), [])
    let inFlight = 0
    let peak = 0
    const res = await runCrmAutoSync({
      sb: f.sb,
      now: c.now,
      sync: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        c.advance(1_000)
        inFlight--
        return report('success')
      },
    })
    expect(peak).toBe(2)
    expect(res.started).toBe(7)
  })

  it('ends within the run budget: no sync starts with < 12 s left, every deadline ≤ the run end', async () => {
    const c = clock()
    const f = fakeSb(Array.from({ length: 10 }, (_, i) => conn(i)), [])
    const starts: number[] = []
    const deadlines: number[] = []
    const res = await runCrmAutoSync({
      sb: f.sb,
      now: c.now,
      sync: async (_sb, _x, opts: SyncOptions) => {
        starts.push(c.now() - c.t0)
        deadlines.push(opts.deadlineAt - c.t0)
        await new Promise((r) => setTimeout(r, 1))
        // A sync takes 10 s, never past its own deadline (the core honours it).
        c.advance(Math.min(10_000, opts.deadlineAt - c.now()))
        return report('success')
      },
    })
    expect(Math.max(...starts)).toBeLessThanOrEqual(CRM_AUTO_SYNC_RUN_MS - CRM_AUTO_SYNC_MIN_START_MS)
    expect(Math.max(...deadlines)).toBeLessThanOrEqual(CRM_AUTO_SYNC_RUN_MS)
    expect(res.started).toBeLessThan(10)
    expect(res.deferred).toBe(10 - res.started)
    expect(res.elapsedMs).toBeLessThanOrEqual(45_000)
  })

  it('syncs that use their whole deadline still end the run by 44 s', async () => {
    const c = clock()
    const f = fakeSb(Array.from({ length: 6 }, (_, i) => conn(i)), [])
    const res = await runCrmAutoSync({
      sb: f.sb,
      now: c.now,
      sync: async (_sb, _x, opts: SyncOptions) => {
        await new Promise((r) => setTimeout(r, 1))
        c.advance(opts.deadlineAt - c.now())
        return report('partial')
      },
    })
    // Two at 0 s (deadline 30 s), two at 30 s with 14 s left (deadline = the run end, 44 s), then none.
    expect(res.elapsedMs).toBe(CRM_AUTO_SYNC_RUN_MS)
    expect(res.started).toBe(4)
    expect(res.deferred).toBe(2)
  })

  it('one failing or throwing connection does not stop the others; a throw is recorded on that connection', async () => {
    const c = clock()
    const f = fakeSb([conn(1), conn(2), conn(3)], [])
    const alerts: string[] = []
    const res = await runCrmAutoSync({
      sb: f.sb,
      now: c.now,
      onError: (x) => alerts.push(x.id),
      sync: async (_sb, x) => {
        if (x.id === 'c1') throw new Error('boom')
        if (x.id === 'c2') return report('error')
        return report('success')
      },
    })
    expect(res).toMatchObject({ started: 3, error: 2, success: 1 })
    expect(alerts.sort()).toEqual(['c1', 'c2'])
    expect(f.updates).toHaveLength(1)
    expect(f.updates[0].patch).toMatchObject({ last_sync_status: 'error' })
    expect(String(f.updates[0].patch.last_sync_error)).toMatch(/boom/)
    expect(f.updates[0].filters).toEqual(expect.arrayContaining([['eq', 'id', 'c1'], ['eq', 'user_id', 'u1']]))
  })

  it('nothing due → nothing started', async () => {
    const f = fakeSb([], [])
    expect(await runCrmAutoSync({ sb: f.sb, sync: async () => { throw new Error('must not run') } })).toMatchObject({ due: 0, started: 0 })
  })
})
