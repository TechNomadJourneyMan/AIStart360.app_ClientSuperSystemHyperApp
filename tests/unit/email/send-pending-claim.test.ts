/**
 * R-152: the idempotency claim of a letter (email_deliveries.dedupe_key) is «pending» until the
 * letter is sent. A process that dies between the claim and the send no longer loses the letter
 * forever: a claim older than 10 minutes is taken over (conditional UPDATE — one taker) and sent
 * with the same Resend idempotency key as the first attempt. A fresh claim is never sent twice.
 * Before migration 158 (CHECK without 'pending') the claim falls back to the old «sent».
 *
 * R5 review (wave 1B): a fresh claim of ANOTHER process is not «delivered» — the caller gets a
 * distinct retryable result (ok: false, retryable: true), so a job retry is not completed as sent
 * and comes back after the stale window (M-2). The outcome write checks the error the client
 * returns, retries once, then logs loudly (L-4); a takeover that re-rendered the letter is
 * refused by Resend (409 invalid_idempotent_request) — that proves the first attempt went out,
 * so the row is recorded «sent» and nothing is sent twice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; dedupe_key: string | null; status: string; claimed_at: string; provider_id?: string | null }

const s = vi.hoisted(() => ({
  rows: [] as Row[],
  sendCalls: [] as Array<{ subject: unknown; idempotencyKey?: string }>,
  pendingAllowed: true,
  /** Runs inside resend.emails.send — to interleave a second caller. */
  duringSend: null as null | (() => Promise<void>),
  /** Scripted Resend answers (first in, first out); empty — success. */
  replies: [] as Array<{ data?: { id: string } | null; error?: { name: string; message: string; statusCode: number } | null }>,
  /** The next N status writes (outcome) return an error instead of writing. */
  outcomeErrors: 0,
  /** The next N reads of the claim return an error. */
  readErrors: 0,
  /** Runs right after a 23505 of the claim insert — to interleave another process. */
  afterConflict: null as null | (() => void),
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
        s.sendCalls.push({ subject: payload.subject, idempotencyKey: opts?.idempotencyKey })
        const hook = s.duringSend
        s.duringSend = null
        if (hook) await hook()
        const scripted = s.replies.shift()
        if (scripted) return { data: scripted.data ?? null, error: scripted.error ?? null }
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
            if (key && s.rows.some((r) => r.dedupe_key === key)) {
              const hook = s.afterConflict
              s.afterConflict = null
              hook?.()
              return { data: null, error: { code: '23505', message: 'duplicate' } }
            }
            const r: Row = { id: `row-${++seq}`, dedupe_key: key, status: String(row.status ?? 'sent'), claimed_at: new Date().toISOString() }
            s.rows.push(r)
            return { data: { id: r.id }, error: null }
          },
        }),
      }),
      select: () => chain(async (f) => {
        if (s.readErrors > 0) { s.readErrors -= 1; return { data: null, error: { message: 'read failed' } } }
        return { data: s.rows.filter((r) => match(r, f)), error: null }
      }),
      update: (patch: Record<string, unknown>) => chain(async (f) => {
        if ('status' in patch && s.outcomeErrors > 0) { s.outcomeErrors -= 1; return { data: null, error: { message: 'outcome write failed' } } }
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
  s.replies = []
  s.outcomeErrors = 0
  s.readErrors = 0
  s.afterConflict = null
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
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

  it('a concurrent call while the first is still sending does not send twice — and does not report «delivered»', async () => {
    let second: Awaited<ReturnType<typeof sendTransactionalEmail>> | null = null
    s.duringSend = async () => { second = await sendTransactionalEmail(input('q:u2')) }
    await sendTransactionalEmail(input('q:u2'))
    expect(second).toMatchObject({ ok: false, retryable: true })
    expect(second).not.toHaveProperty('skipped')
    expect(s.sendCalls).toHaveLength(1)
  })

  it('a fresh «pending» claim left by another process is not sent again, and the caller is told to retry', async () => {
    s.rows.push({ id: 'row-x', dedupe_key: 'q:u3', status: 'pending', claimed_at: minutesAgo(1) })
    const res = await sendTransactionalEmail(input('q:u3'))
    expect(res).toMatchObject({ ok: false, retryable: true })
    expect(res.error).toBeTruthy()
    expect(s.sendCalls).toHaveLength(0)
  })

  it('a job retry within the stale window is retryable; after the window the same retry sends (crash recovered)', async () => {
    s.rows.push({ id: 'row-crash', dedupe_key: 'q:u3b', status: 'pending', claimed_at: minutesAgo(3) })
    expect(await sendTransactionalEmail(input('q:u3b'))).toMatchObject({ ok: false, retryable: true })
    s.rows[0].claimed_at = minutesAgo(11)
    expect(await sendTransactionalEmail(input('q:u3b'))).toMatchObject({ ok: true, providerId: 'res-1' })
    expect(s.sendCalls).toEqual([expect.objectContaining({ idempotencyKey: 'aistart360-row-crash' })])
  })

  it('the claim cannot be read after the conflict → retryable, nothing sent', async () => {
    s.rows.push({ id: 'row-r', dedupe_key: 'q:u3c', status: 'pending', claimed_at: minutesAgo(30) })
    s.readErrors = 1
    expect(await sendTransactionalEmail(input('q:u3c'))).toMatchObject({ ok: false, retryable: true })
    expect(s.sendCalls).toHaveLength(0)
  })

  it('the conflicting claim vanished (its failed send released the key) → claimed again and sent once', async () => {
    s.rows.push({ id: 'row-f', dedupe_key: 'q:u3d', status: 'pending', claimed_at: minutesAgo(1) })
    s.afterConflict = () => { s.rows[0].dedupe_key = null; s.rows[0].status = 'failed' }
    expect(await sendTransactionalEmail(input('q:u3d'))).toMatchObject({ ok: true })
    expect(s.sendCalls).toHaveLength(1)
    expect(s.rows.filter((r) => r.dedupe_key === 'q:u3d')).toEqual([expect.objectContaining({ status: 'sent' })])
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
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => r.retryable)).toHaveLength(1)
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

describe('sendTransactionalEmail — the outcome write (R5 review L-4)', () => {
  it('a «sent» write that RETURNS an error is retried once', async () => {
    s.outcomeErrors = 1
    expect(await sendTransactionalEmail(input('o:1'))).toMatchObject({ ok: true, providerId: 'res-1' })
    expect(s.rows[0]).toMatchObject({ status: 'sent', provider_id: 'res-1' })
  })

  it('both writes fail: the letter went out (ok), the claim stays pending, and it is logged loudly', async () => {
    s.outcomeErrors = 2
    const loud = vi.mocked(console.error)
    expect(await sendTransactionalEmail(input('o:2'))).toMatchObject({ ok: true, providerId: 'res-1' })
    expect(s.rows[0].status).toBe('pending')
    expect(loud.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/журнал.*sent/i)
  })

  it('a «failed» write that returns an error is retried once — the key is released', async () => {
    s.replies = [{ error: { name: 'validation_error', message: 'bad address', statusCode: 422 } }]
    s.outcomeErrors = 1
    expect(await sendTransactionalEmail(input('o:3'))).toMatchObject({ ok: false, error: 'bad address' })
    expect(s.rows[0]).toMatchObject({ status: 'failed', dedupe_key: null })
  })

  it('a takeover whose letter was re-rendered: Resend refuses the reused key (409) — recorded «sent», never sent again', async () => {
    // The first attempt reached Resend with this key, then its outcome write was lost.
    s.rows.push({ id: 'row-lost', dedupe_key: 'o:4', status: 'pending', claimed_at: minutesAgo(15) })
    s.replies = [{ error: { name: 'invalid_idempotent_request', message: 'Same idempotency key used with a different request payload', statusCode: 409 } }]
    const res = await sendTransactionalEmail({ ...input('o:4'), subject: 'Анкета заполнена (новая ссылка)' })
    expect(res).toMatchObject({ ok: true, skipped: true })
    expect(s.sendCalls).toEqual([expect.objectContaining({ idempotencyKey: 'aistart360-row-lost' })])
    expect(s.rows).toHaveLength(1)
    expect(s.rows[0]).toMatchObject({ id: 'row-lost', status: 'sent', dedupe_key: 'o:4' })
    // A later caller sees «sent»: no letter with a fresh key.
    expect(await sendTransactionalEmail(input('o:4'))).toMatchObject({ ok: true, skipped: true })
    expect(s.sendCalls).toHaveLength(1)
  })

  it('Resend says the same key is still in progress (409 concurrent) — retried, not failed', async () => {
    s.replies = [{ error: { name: 'concurrent_idempotent_requests', message: 'Same idempotency key used while original request is still in progress', statusCode: 409 } }]
    expect(await sendTransactionalEmail(input('o:5'))).toMatchObject({ ok: true, providerId: 'res-2' })
    expect(s.sendCalls).toHaveLength(2)
    expect(new Set(s.sendCalls.map((c) => c.idempotencyKey)).size).toBe(1)
    expect(s.rows[0]).toMatchObject({ status: 'sent' })
  })
})
