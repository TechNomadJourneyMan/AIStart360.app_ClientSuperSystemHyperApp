/**
 * R5 review (wave 1B, M-2) on the real database: the claims of lib/email/send.ts
 * (email_deliveries) and lib/notifications/store.ts (automation_sends, migration 158) under REAL
 * concurrency. The service client is a minimal supabase-js → SQL adapter: every call runs on its
 * own pooled connection in autocommit, like separate PostgREST requests of separate processes, so
 * two callers race on the unique index and on the conditional UPDATE of the takeover for real.
 * Resend is faked (counts letters). Rows are committed under a unique suffix and deleted afterwards.
 *   • two concurrent callers, fresh key            → one letter; the other is retryable, not «sent»;
 *   • two concurrent callers, crashed (stale) claim → one letter (one takeover), the row 'sent';
 *   • a fresh claim of a crashed process            → retryable; after the window → delivered once;
 *   • the same for claimSend, and end to end through notifyClient (crash → retry → delivered,
 *     confirmed; two concurrent notifyClient → one feed entry and one letter).
 */
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

const h = vi.hoisted(() => ({
  pool: null as unknown,
  letters: [] as Array<{ to: unknown; idempotencyKey?: string }>,
  feed: [] as unknown[],
  /** ms the fake Resend takes: the window in which a second caller finds the claim «pending». */
  resendDelayMs: 150,
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>, opts?: { idempotencyKey?: string }) => {
        h.letters.push({ to: payload.to, idempotencyKey: opts?.idempotencyKey })
        await new Promise((r) => setTimeout(r, h.resendDelayMs))
        return { data: { id: `res-${h.letters.length}` }, error: null }
      },
    }
  },
}))
vi.mock('@/lib/notifications/create', () => ({ createNotification: async (input: unknown) => { h.feed.push(input); return true } }))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: async () => true }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => undefined }))

// ── supabase-js → SQL (only what lib/email/send.ts and lib/notifications/store.ts call) ─────────
type Op = 'insert' | 'select' | 'update' | 'delete'
const IDENT = /^[a-z_][a-z0-9_]*$/
const ident = (s: string) => { if (!IDENT.test(s)) throw new Error(`bad identifier ${s}`); return s }
const cols = (list: string) => list.split(',').map((c) => ident(c.trim())).join(', ')

function builder(table: string, op: Op, payload?: Record<string, unknown>, selectCols?: string) {
  const where: Array<[string, '=' | '<', unknown]> = []
  let returning: string | null = op === 'select' ? selectCols ?? '*' : null
  const run = async (): Promise<{ data: Record<string, unknown>[] | null; error: { code?: string; message: string } | null }> => {
    const args: unknown[] = []
    const arg = (v: unknown) => { args.push(v); return `$${args.length}` }
    const cond = where.length ? ` WHERE ${where.map(([c, o, v]) => `${ident(c)} ${o} ${arg(v)}`).join(' AND ')}` : ''
    let sql: string
    if (op === 'insert') {
      const keys = Object.keys(payload!).map(ident)
      sql = `INSERT INTO public.${ident(table)} (${keys.join(', ')}) VALUES (${keys.map((k) => arg(payload![k])).join(', ')})`
    } else if (op === 'update') {
      const keys = Object.keys(payload!).map(ident)
      sql = `UPDATE public.${ident(table)} SET ${keys.map((k) => `${k} = ${arg(payload![k])}`).join(', ')}${cond}`
    } else if (op === 'delete') {
      sql = `DELETE FROM public.${ident(table)}${cond}`
    } else {
      sql = `SELECT ${cols(returning!)} FROM public.${ident(table)}${cond}`
    }
    if (op !== 'select' && returning) sql += ` RETURNING ${cols(returning)}`
    try {
      const { rows } = await (h.pool as pg.Pool).query(sql, args)
      return { data: rows, error: null }
    } catch (e) {
      return { data: null, error: { code: (e as { code?: string }).code, message: (e as Error).message } }
    }
  }
  const b = {
    eq: (c: string, v: unknown) => { where.push([c, '=', v]); return b },
    lt: (c: string, v: unknown) => { where.push([c, '<', v]); return b },
    select: (c: string) => { returning = c; return b },
    single: async () => { const r = await run(); return { data: r.data?.[0] ?? null, error: r.error } },
    maybeSingle: async () => { const r = await run(); return { data: r.data?.[0] ?? null, error: r.error } },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
  }
  return b
}
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => builder(table, 'insert', row),
      select: (c: string) => builder(table, 'select', undefined, c),
      update: (patch: Record<string, unknown>) => builder(table, 'update', patch),
      delete: () => builder(table, 'delete'),
    }),
  }),
}))

const { sendTransactionalEmail } = await import('@/lib/email/send')
const { claimSend } = await import('@/lib/notifications/store')
const { notifyClient } = await import('@/lib/notifications/notify')

const sfx = `r5t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const key = (name: string) => `${sfx}:${name}`
const pool = () => h.pool as pg.Pool
const letter = (dedupeKey: string) => ({
  kind: 'notification' as const, to: 'client@example.test', subject: `Тест ${sfx}`, content: { title: 'Тест' }, userId: null, dedupeKey,
})
const emailRow = async (k: string) => (await pool().query(`SELECT id, status FROM public.email_deliveries WHERE dedupe_key = $1`, [k])).rows
const sendRow = async (k: string) => (await pool().query(`SELECT id, status FROM public.automation_sends WHERE dedupe_key = $1`, [k])).rows
const claim = (k: string) => claimSend({ userId: null, kind: sfx, dedupeKey: k, countsTowardCap: false, channels: ['in_app'], pending: true })

describe.skipIf(!dbTestsEnabled)('send claims under real concurrency (R5 M-2, migration 158)', () => {
  let user = ''

  beforeAll(async () => {
    h.pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 8 })
    vi.stubEnv('EMAIL_ALLOW_SEND_IN_TESTS', '1')
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    user = randomUUID()
    // A recipient for notifyClient (handle_new_user builds the profile); deleted afterwards.
    await pool().query(`INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data) VALUES ($1, $2, '{}', '{}')`, [user, `${sfx}@test.local`])
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await pool().query(`DELETE FROM public.email_deliveries WHERE dedupe_key LIKE $1 OR subject = $2`, [`${sfx}:%`, `Тест ${sfx}`])
    await pool().query(`DELETE FROM public.automation_sends WHERE dedupe_key LIKE $1 OR kind = $2`, [`${sfx}:%`, sfx])
    await pool().query(`DELETE FROM public.email_deliveries WHERE user_id = $1`, [user])
    await pool().query(`DELETE FROM public.profiles WHERE id = $1`, [user])
    await pool().query(`DELETE FROM auth.users WHERE id = $1`, [user])
    await pool().end()
  })

  beforeEach(() => {
    h.letters = []
    h.feed = []
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  describe('e-mail (email_deliveries)', () => {
    it('two concurrent callers with a fresh key: one letter; the other is retryable, not «sent»', async () => {
      const k = key('mail-fresh')
      const results = await Promise.all([sendTransactionalEmail(letter(k)), sendTransactionalEmail(letter(k))])
      expect(h.letters).toHaveLength(1)
      expect(results.filter((r) => r.ok && !r.skipped)).toHaveLength(1)
      expect(results.filter((r) => !r.ok && r.retryable)).toHaveLength(1)
      expect(await emailRow(k)).toEqual([expect.objectContaining({ status: 'sent' })])
      // Once sent, a later caller is «already sent».
      expect(await sendTransactionalEmail(letter(k))).toMatchObject({ ok: true, skipped: true })
      expect(h.letters).toHaveLength(1)
    })

    it('a crashed claim: retryable inside the window; after it two concurrent callers send exactly one letter, same key', async () => {
      const k = key('mail-crash')
      const { rows } = await pool().query(
        `INSERT INTO public.email_deliveries (kind, recipient, subject, dedupe_key, status, claimed_at) VALUES ('notification', 'client@example.test', $2, $1, 'pending', now() - interval '2 minutes') RETURNING id`,
        [k, `Тест ${sfx}`],
      )
      expect(await sendTransactionalEmail(letter(k))).toMatchObject({ ok: false, retryable: true })
      expect(h.letters).toHaveLength(0)
      await pool().query(`UPDATE public.email_deliveries SET claimed_at = now() - interval '11 minutes' WHERE id = $1`, [rows[0].id])
      const results = await Promise.all([sendTransactionalEmail(letter(k)), sendTransactionalEmail(letter(k)), sendTransactionalEmail(letter(k))])
      expect(h.letters).toEqual([expect.objectContaining({ idempotencyKey: `aistart360-${rows[0].id}` })])
      expect(results.filter((r) => r.ok && !r.skipped)).toHaveLength(1)
      expect(await emailRow(k)).toEqual([{ id: rows[0].id, status: 'sent' }])
    })
  })

  describe('automation_sends (claimSend, pending: true)', () => {
    it('two concurrent claims of a fresh key: one claimed, one in flight; confirmed → duplicate', async () => {
      const k = key('send-fresh')
      const both = await Promise.all([claim(k), claim(k)])
      expect(both.map((c) => c.result).sort()).toEqual(['claimed', 'in_flight'])
      expect(await sendRow(k)).toEqual([expect.objectContaining({ status: 'pending' })])
      await both.find((c) => c.result === 'claimed')!.confirm!()
      expect(await sendRow(k)).toEqual([expect.objectContaining({ status: 'sent' })])
      expect(await claim(k)).toMatchObject({ result: 'duplicate' })
    })

    it('a crashed claim is taken over after the stale window by exactly one of several concurrent callers', async () => {
      const k = key('send-crash')
      const { rows } = await pool().query(
        `INSERT INTO public.automation_sends (kind, dedupe_key, status, claimed_at) VALUES ($2, $1, 'pending', now() - interval '3 minutes') RETURNING id`, [k, sfx],
      )
      expect(await claim(k)).toMatchObject({ result: 'in_flight' })
      await pool().query(`UPDATE public.automation_sends SET claimed_at = now() - interval '11 minutes' WHERE id = $1`, [rows[0].id])
      const all = await Promise.all([claim(k), claim(k), claim(k), claim(k)])
      expect(all.filter((c) => c.result === 'claimed')).toEqual([expect.objectContaining({ id: rows[0].id })])
      expect(all.filter((c) => c.result === 'in_flight')).toHaveLength(3)
    })

    it('a writer that does not opt in keeps «final at insert» (status defaults to sent)', async () => {
      const k = key('send-legacy')
      expect(await claimSend({ userId: null, kind: sfx, dedupeKey: k, countsTowardCap: false, channels: ['admin'] })).toMatchObject({ result: 'claimed' })
      expect(await sendRow(k)).toEqual([expect.objectContaining({ status: 'sent' })])
    })
  })

  describe('notifyClient end to end', () => {
    const notify = (k: string) => notifyClient({ userId: user, category: 'gri', event: 'gri_completed', title: 'GRI пройден', body: 'Результат в кабинете.', dedupeKey: k })

    it('crash between claim and delivery: retryable inside the window, delivered once after it, then a duplicate', async () => {
      const k = key('notify-crash')
      // The dead process claimed both journals and never sent.
      await pool().query(`INSERT INTO public.automation_sends (user_id, kind, dedupe_key, status, claimed_at) VALUES ($1, 'gri_completed', $2, 'pending', now() - interval '4 minutes')`, [user, k])
      await pool().query(`INSERT INTO public.email_deliveries (kind, recipient, subject, user_id, dedupe_key, status, claimed_at) VALUES ('client_notification', $3, 'GRI пройден', $1, $2, 'pending', now() - interval '4 minutes')`, [user, k, `${sfx}@test.local`])
      expect(await notify(k)).toMatchObject({ ok: false, retryable: true })
      expect(h.letters).toHaveLength(0)
      expect(h.feed).toHaveLength(0)

      await pool().query(`UPDATE public.automation_sends SET claimed_at = now() - interval '11 minutes' WHERE dedupe_key = $1`, [k])
      await pool().query(`UPDATE public.email_deliveries SET claimed_at = now() - interval '11 minutes' WHERE dedupe_key = $1`, [k])
      expect(await notify(k)).toMatchObject({ ok: true, delivered: { inApp: true, email: true } })
      expect(h.letters).toHaveLength(1)
      expect(h.feed).toHaveLength(1)
      expect(await sendRow(k)).toEqual([expect.objectContaining({ status: 'sent' })])
      expect(await emailRow(k)).toEqual([expect.objectContaining({ status: 'sent' })])

      expect(await notify(k)).toMatchObject({ ok: true, skipped: 'duplicate' })
      expect(h.letters).toHaveLength(1)
    })

    it('two concurrent notifyClient with one key: one feed entry and one letter', async () => {
      const k = key('notify-race')
      const results = await Promise.all([notify(k), notify(k)])
      expect(h.letters).toHaveLength(1)
      expect(h.feed).toHaveLength(1)
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      expect(results.filter((r) => r.retryable)).toHaveLength(1)
      expect(await sendRow(k)).toEqual([expect.objectContaining({ status: 'sent' })])
    })
  })
})
