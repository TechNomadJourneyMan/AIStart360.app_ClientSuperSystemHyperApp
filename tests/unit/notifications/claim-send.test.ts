/**
 * R5 review (wave 1B, M-2): the automation_sends claim of notifyClient has the same lifecycle as
 * the e-mail claim (lib/email/send.ts): 'pending' until a channel delivered, then 'sent'
 * (confirm). A claim left 'pending' by a crashed process is taken over after
 * STALE_SEND_CLAIM_MS by ONE caller (conditional UPDATE); a fresh one is 'in_flight' —
 * retryable, never «duplicate». Callers that do not opt in (staff digest, Point B) keep the old
 * meaning: the row is final at insert, a repeat is a duplicate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; dedupe_key: string | null; status?: string; claimed_at: string }
type Filter = [op: 'eq' | 'lt', col: string, val: unknown]

const s = vi.hoisted(() => ({
  rows: [] as Row[],
  /** Before migration 158: automation_sends has no status / claimed_at. */
  noStatusColumn: false,
  /** The next N status writes return an error. */
  statusWriteErrors: 0,
  inserted: [] as Array<Record<string, unknown>>,
}))

const match = (r: Row, f: Filter[]) => f.every(([op, col, val]) => {
  const v = (r as Record<string, unknown>)[col]
  return op === 'eq' ? v === val : typeof v === 'string' && typeof val === 'string' && new Date(v).getTime() < new Date(val).getTime()
})
function chain(run: (f: Filter[]) => Promise<{ data: unknown; error: unknown }>, f: Filter[] = []): Record<string, unknown> {
  return {
    eq: (c: string, v: unknown) => chain(run, [...f, ['eq', c, v]]),
    lt: (c: string, v: unknown) => chain(run, [...f, ['lt', c, v]]),
    select: () => chain(run, f),
    maybeSingle: async () => { const r = await run(f); return { data: (r.data as unknown[] | null)?.[0] ?? null, error: r.error } },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run(f).then(res, rej),
  }
}
const missingColumn = { code: 'PGRST204', message: "Could not find the 'status' column of 'automation_sends' in the schema cache" }
let seq = 0
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            if (s.noStatusColumn && 'status' in row) return { data: null, error: missingColumn }
            s.inserted.push(row)
            const key = (row.dedupe_key as string | null) ?? null
            if (key && s.rows.some((r) => r.dedupe_key === key)) return { data: null, error: { code: '23505', message: 'duplicate' } }
            const r: Row = { id: `send-${++seq}`, dedupe_key: key, claimed_at: new Date().toISOString(), ...(s.noStatusColumn ? {} : { status: String(row.status ?? 'sent') }) }
            s.rows.push(r)
            return { data: { id: r.id }, error: null }
          },
        }),
      }),
      select: (cols: string) => chain(async (f) => {
        if (s.noStatusColumn && /status/.test(cols)) return { data: null, error: { code: '42703', message: 'column automation_sends.status does not exist' } }
        return { data: s.rows.filter((r) => match(r, f)), error: null }
      }),
      update: (patch: Record<string, unknown>) => chain(async (f) => {
        if ('status' in patch && s.statusWriteErrors > 0) { s.statusWriteErrors -= 1; return { data: null, error: { message: 'write failed' } } }
        const hit = s.rows.filter((r) => match(r, f))
        for (const r of hit) Object.assign(r, patch)
        return { data: hit.map((r) => ({ id: r.id })), error: null }
      }),
      delete: () => chain(async (f) => {
        s.rows = s.rows.filter((r) => !match(r, f))
        return { data: null, error: null }
      }),
    }),
  }),
}))

const { claimSend, releaseSend, STALE_SEND_CLAIM_MS } = await import('@/lib/notifications/store')

const claim = (dedupeKey: string, pending = true) =>
  claimSend({ userId: null, kind: 'gri_completed', dedupeKey, countsTowardCap: false, channels: ['in_app'], ...(pending ? { pending: true } : {}) })
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

beforeEach(() => {
  s.rows = []
  s.inserted = []
  s.noStatusColumn = false
  s.statusWriteErrors = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('claimSend — pending → sent (notifyClient)', () => {
  it('claims as «pending» and confirm() marks it «sent»; a repeat is then a duplicate', async () => {
    const c = await claim('k1')
    expect(c).toMatchObject({ result: 'claimed', id: 'send-' + seq })
    expect(s.rows[0].status).toBe('pending')
    expect(await c.confirm?.()).toBe(true)
    expect(s.rows[0].status).toBe('sent')
    expect(await claim('k1')).toMatchObject({ result: 'duplicate', id: null })
  })

  it('a fresh «pending» claim of another process: in flight (retryable), not a duplicate', async () => {
    await claim('k2')
    expect(await claim('k2')).toMatchObject({ result: 'in_flight', id: null })
  })

  it('a crashed claim (pending, older than the stale window) is taken over — same row, then confirmed', async () => {
    expect(STALE_SEND_CLAIM_MS).toBe(10 * 60_000)
    s.rows.push({ id: 'dead', dedupe_key: 'k3', status: 'pending', claimed_at: minutesAgo(11) })
    const c = await claim('k3')
    expect(c).toMatchObject({ result: 'claimed', id: 'dead' })
    expect(new Date(s.rows[0].claimed_at).getTime()).toBeGreaterThan(Date.now() - 60_000)
    await c.confirm?.()
    expect(s.rows).toEqual([expect.objectContaining({ id: 'dead', status: 'sent' })])
  })

  it('a crashed claim is NOT taken over inside the stale window', async () => {
    s.rows.push({ id: 'dying', dedupe_key: 'k4', status: 'pending', claimed_at: minutesAgo(9) })
    expect(await claim('k4')).toMatchObject({ result: 'in_flight' })
  })

  it('two callers racing for one stale claim: exactly one takes it', async () => {
    s.rows.push({ id: 'dead', dedupe_key: 'k5', status: 'pending', claimed_at: minutesAgo(30) })
    const both = await Promise.all([claim('k5'), claim('k5')])
    expect(both.map((c) => c.result).sort()).toEqual(['claimed', 'in_flight'])
  })

  it('a released claim (nothing delivered) frees the key for the next call', async () => {
    const c = await claim('k6')
    await releaseSend(c.id!)
    expect(await claim('k6')).toMatchObject({ result: 'claimed' })
  })

  it('confirm: a write that returns an error is retried once; two failures are logged loudly', async () => {
    const c1 = await claim('k7')
    s.statusWriteErrors = 1
    expect(await c1.confirm?.()).toBe(true)
    expect(s.rows[0].status).toBe('sent')
    const c2 = await claim('k8')
    s.statusWriteErrors = 2
    expect(await c2.confirm?.()).toBe(false)
    expect(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])).toMatch(/automation_sends.*pending/)
  })

  it('before migration 158 (no status column) it claims the old way: final at insert, no confirm', async () => {
    s.noStatusColumn = true
    const c = await claim('k9')
    expect(c).toMatchObject({ result: 'claimed' })
    expect(c.confirm).toBeUndefined()
    expect(await claim('k9')).toMatchObject({ result: 'duplicate' })
  })
})

describe('claimSend — callers that do not opt in keep «final at insert»', () => {
  it('no status is written, a repeat is a duplicate without any lookup, no confirm', async () => {
    const c = await claim('l1', false)
    expect(c.confirm).toBeUndefined()
    expect(s.inserted[0]).not.toHaveProperty('status')
    expect(s.rows[0].status).toBe('sent') // the column default
    expect(await claim('l1', false)).toMatchObject({ result: 'duplicate' })
  })

  it('a plain claim is never taken over as stale — by a plain repeat or by a pending caller, however old', async () => {
    const c = await claim('l0', false)
    s.rows[0].claimed_at = minutesAgo(24 * 60)
    const before = { ...s.rows[0] }
    expect(await claim('l0', false)).toMatchObject({ result: 'duplicate', id: null })
    const both = await Promise.all([claim('l0'), claim('l0'), claim('l0')])
    expect(both.map((x) => x.result)).toEqual(['duplicate', 'duplicate', 'duplicate'])
    expect(s.rows).toEqual([before])
    expect(c.id).toBe(before.id)
  })

  it('even a stale «pending» row of the same key is a duplicate for them', async () => {
    s.rows.push({ id: 'p', dedupe_key: 'l2', status: 'pending', claimed_at: minutesAgo(60) })
    expect(await claim('l2', false)).toMatchObject({ result: 'duplicate' })
    expect(s.rows[0].status).toBe('pending')
  })
})
