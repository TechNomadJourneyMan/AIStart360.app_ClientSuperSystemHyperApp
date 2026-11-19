/**
 * lib/crm/sync.ts — the ≤ 45 s rule for background work, at the very end of a run (wave 3, L4): the
 * final status write (and the lease release) gets only what is left of the run's budget, so a slow
 * database cannot hold a run past its deadline. A fake client whose writes answer only when aborted.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncCrmConnection, type SyncConnection } from '@/lib/crm/sync'

type Res = { data: unknown; error: { code?: string; message?: string } | null }

/** Reads fail at once (the run ends in 'error'); every write hangs until its signal aborts. */
function hangingWrites() {
  const signals: Array<AbortSignal | undefined> = []
  const from = () => {
    let write = false
    let signal: AbortSignal | undefined
    const q: Record<string, unknown> = {}
    const self = () => q
    Object.assign(q, {
      select: self, eq: self, is: self, in: self, maybeSingle: self,
      update: () => { write = true; return q },
      abortSignal: (s: AbortSignal) => { signal = s; return q },
      then: (ok: (r: Res) => unknown, err?: (e: unknown) => unknown) => {
        if (!write) return Promise.resolve<Res>({ data: null, error: { code: 'XX000', message: 'boom' } }).then(ok, err)
        signals.push(signal)
        return new Promise<Res>((resolve) => {
          if (!signal) return // unbounded: never answers
          if (signal.aborted) resolve({ data: null, error: { message: 'AbortError: aborted' } })
          signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'AbortError: aborted' } }))
        }).then(ok, err)
      },
    })
    return q
  }
  const rpc = () => {
    const q: Record<string, unknown> = {}
    Object.assign(q, {
      abortSignal: () => q,
      then: (ok: (r: Res) => unknown) => Promise.resolve<Res>({ data: '00000000-0000-4000-8000-000000000001', error: null }).then(ok),
    })
    return q
  }
  return { sb: { from, rpc } as unknown as SupabaseClient, signals }
}

const conn: SyncConnection = { id: 'c1', user_id: 'u1', provider: 'bitrix24', base_url: 'acme.bitrix24.kz', access_token: 't' }

describe('syncCrmConnection — the end of the budget', () => {
  it('L4: the final write gets only what is left of the budget — the run never ends after its deadline', async () => {
    const { sb, signals } = hangingWrites()
    const deadlineAt = Date.now() + 2_500
    const report = await syncCrmConnection(sb, conn, { deadlineAt })
    const endedAt = Date.now()
    expect(report.status).toBe('error')
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every((s) => s !== undefined)).toBe(true)
    expect(endedAt).toBeLessThanOrEqual(deadlineAt + 150)
  }, 10_000)
})
