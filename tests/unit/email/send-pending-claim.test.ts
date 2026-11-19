/**
 * R-152: the idempotency claim of a letter (email_deliveries.dedupe_key) is «pending» until the
 * letter is sent. A process that dies between the claim and the send no longer loses the letter
 * forever: a claim older than 10 minutes is taken over (conditional UPDATE — one taker) and sent
 * with the same Resend idempotency key as the first attempt. A fresh claim is never sent twice.
 * Before migration 158 (CHECK without 'pending') the claim falls back to the old «sent».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; dedupe_key: string | null; status: string; claimed_at: string; provider_id?: string | null }

const s = vi.hoisted(() => ({
  rows: [] as Row[],
  sendCalls: [] as Array<{ subject: unknown; idempotencyKey?: string }>,
  pendingAllowed: true,
  /** Runs inside resend.emails.send — to interleave a second caller. */
  duringSend: null as null | (() => Promise<void>),
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
        s.sendCalls.push({ subject: payload.subject, idempotencyKey: opts?.idempotencyKey })
        const hook = s.duringSend
        s.duringSend = null
        if (hook) await hook()
        return { data: { id: `res-${s.sendCalls.length}` }, error: null }
      },
    }
  },
}))

type Filter = [op: 'eq' | 'lt', col: string, val: unknown]
const match = (r: Row, f: Filter[]) => f.every(([op, col, val]) => {
  const v = (r as Record<string, unknown>)[col]
  return op === 'eq' ? v === val : typeof v === 'string' && typeof val === 'string' && new Date(v).getTime() < new Date(val).getTime()
})
function chain(run: (f: Filter[]) => Promise<{ data: unknown; error: unknown }>, f: Filter[] = []): Record<string, unknown> {
  return {
    eq: (c: string, v: unknown) => chain(run, [...f, ['eq', c, v]]),
    lt: (c: string, v: unknown) => chain(run, [...f, ['lt', c, v]]),
    select: () => chain(run, f),
    maybeSingle: async () => { const r = await run(f); return { data: (r.data as unknown[])?.[0] ?? null, error: r.error } },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run(f).then(res, rej),
  }
}
let seq = 0
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            if (row.status === 'pending' && !s.pendingAllowed) return { data: null, error: { code: '23514', message: 'violates check constraint' } }
            const key = (row.dedupe_key as string | null) ?? null
            if (key && s.rows.some((r) => r.dedupe_key === key)) return { data: null, error: { code: '23505', message: 'duplicate' } }
            const r: Row = { id: `row-${++seq}`, dedupe_key: key, status: String(row.status ?? 'sent'), claimed_at: new Date().toISOString() }
            s.rows.push(r)
            return { data: { id: r.id }, error: null }
          },
        }),
      }),
      select: () => chain(async (f) => ({ data: s.rows.filter((r) => match(r, f)), error: null })),
      update: (patch: Record<string, unknown>) => chain(async (f) => {
        const hit = s.rows.filter((r) => match(r, f))
        for (const r of hit) Object.assign(r, patch)
        return { data: hit.map((r) => ({ id: r.id })), error: null }
      }),
    }),
  }),
}))

const { sendTransactionalEmail } = await import('@/lib/email/send')

const input = (dedupeKey: string) => ({
  kind: 'questionnaire_completed' as const,
  to: 'user@company.kz',
  subject: 'Анкета заполнена',
  content: { title: 'Анкета заполнена' },
  userId: null,
  dedupeKey,
})
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

beforeEach(() => {
  process.env.EMAIL_ALLOW_SEND_IN_TESTS = '1'
  process.env.RESEND_API_KEY = 'test-key'
  s.rows = []
  s.sendCalls = []
  s.pendingAllowed = true
  s.duringSend = null
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('sendTransactionalEmail — the claim is pending until the letter is sent (R-152)', () => {
  it('claims as «pending» before the send and marks «sent» after it', async () => {
    let statusDuringSend: string | null = null
    s.duringSend = async () => { statusDuringSend = s.rows[0]?.status ?? null }
    const res = await sendTransactionalEmail(input('q:u1'))
    expect(res).toMatchObject({ ok: true, providerId: 'res-1' })
    expect(statusDuringSend).toBe('pending')
    expect(s.rows[0]).toMatchObject({ status: 'sent', provider_id: 'res-1', dedupe_key: 'q:u1' })
  })

  it('a concurrent call while the first is still sending does not send twice', async () => {
    let second: Awaited<ReturnType<typeof sendTransactionalEmail>> | null = null
    s.duringSend = async () => { second = await sendTransactionalEmail(input('q:u2')) }
    await sendTransactionalEmail(input('q:u2'))
    expect(second).toMatchObject({ ok: true, skipped: true })
    expect(s.sendCalls).toHaveLength(1)
  })

  it('a fresh «pending» claim left by another process is not sent again', async () => {
    s.rows.push({ id: 'row-x', dedupe_key: 'q:u3', status: 'pending', claimed_at: minutesAgo(1) })
    const res = await sendTransactionalEmail(input('q:u3'))
    expect(res).toMatchObject({ ok: true, skipped: true })
    expect(s.sendCalls).toHaveLength(0)
  })

  it('a stale «pending» claim (the process died before the send) is taken over and sent with the same idempotency key', async () => {
    s.rows.push({ id: 'row-dead', dedupe_key: 'q:u4', status: 'pending', claimed_at: minutesAgo(11) })
    const res = await sendTransactionalEmail(input('q:u4'))
    expect(res).toMatchObject({ ok: true, providerId: 'res-1' })
    expect(s.sendCalls).toEqual([expect.objectContaining({ idempotencyKey: 'aistart360-row-dead' })])
    expect(s.rows).toHaveLength(1)
    expect(s.rows[0]).toMatchObject({ id: 'row-dead', status: 'sent' })
  })

  it('two callers racing for one stale claim: exactly one sends', async () => {
    s.rows.push({ id: 'row-dead', dedupe_key: 'q:u5', status: 'pending', claimed_at: minutesAgo(30) })
    const results = await Promise.all([sendTransactionalEmail(input('q:u5')), sendTransactionalEmail(input('q:u5'))])
    expect(s.sendCalls).toHaveLength(1)
    expect(results.filter((r) => r.skipped)).toHaveLength(1)
  })

  it('a letter already «sent» is never sent again, however old', async () => {
    s.rows.push({ id: 'row-old', dedupe_key: 'q:u6', status: 'sent', claimed_at: minutesAgo(600) })
    expect(await sendTransactionalEmail(input('q:u6'))).toMatchObject({ ok: true, skipped: true })
    expect(s.sendCalls).toHaveLength(0)
  })

  it('before migration 158 (no «pending» in the CHECK) the claim falls back to «sent» and stays idempotent', async () => {
    s.pendingAllowed = false
    expect((await sendTransactionalEmail(input('q:u7'))).ok).toBe(true)
    expect(await sendTransactionalEmail(input('q:u7'))).toMatchObject({ ok: true, skipped: true })
    expect(s.sendCalls).toHaveLength(1)
    expect(s.rows[0].status).toBe('sent')
  })
})
