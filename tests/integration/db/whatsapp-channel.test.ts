/**
 * WhatsApp notification channel on the real database (migration 104).
 *
 *   • schema: notification_deliveries accepts 'whatsapp'; outbox is server-only;
 *     a person reads their own link but never the code hash;
 *   • outbox: two workers never claim / send the same row; idempotent enqueue;
 *     timeouts after the send become delivery_unknown and are never resent;
 *     a dead worker's lease is reaped (queued before the fence, unknown after);
 *     provider errors retry with backoff up to max_attempts;
 *   • authorization: opt-in + verified number required, mute, number changes;
 *   • status webhook: sent → delivered → read, failed, mirrored delivery rows;
 *   • linking: code by template, HMAC stored, wrong / burnt / expired codes,
 *     consent, rate limit;
 *   • fan-out: staff levels / quiet hours / cooldown / dedupe, experts,
 *     escalation adapter (template, not free text), client digest;
 *   • WhatsApp Web bridge fallback: staff only, only with the flag.
 * Every provider call goes to a recording fetch; nothing leaves the box.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

interface Call { url: string; headers: Record<string, string>; body: Record<string, any> }

describe.skipIf(!dbTestsEnabled)('whatsapp channel (104)', async () => {
  const { prisma } = await import('@/lib/db')
  const { testPool, closeTestPool, inRollback, asUser, pgErrorCode } = await import('../../helpers/pg-rls')
  const outbox = await import('@/lib/whatsapp/outbox')
  const links = await import('@/lib/whatsapp/links')
  const templates = await import('@/lib/whatsapp/templates')
  const { notifyStaff } = await import('@/lib/notifications/staff')
  const { notifyExpertsWhatsApp } = await import('@/lib/whatsapp/experts')
  const { enqueueReportReviewWhatsApp } = await import('@/lib/whatsapp/report-review')
  const { WhatsAppEscalationAdapter } = await import('@/lib/assistant/escalation/whatsapp-adapter')
  const { whatsappChannel } = await import('@/lib/crm/digest-channels')
  const { __setRateLimitStoreForTests } = await import('@/lib/rate-limit')

  const tag = `wa${Date.now()}`
  const users: string[] = []
  const calls: Call[] = []
  const bridgeCalls: Call[] = []
  let mode: 'ok' | 'timeout' | 'http500' | 'http400' = 'ok'
  let delayMs = 0
  let seq = 0
  let phoneSeq = Math.floor(Math.random() * 1_000_000)

  const PNID = '1098765432'
  const BRIDGE_ENV = {
    WHATSAPP_WEB_BRIDGE_ENABLED: '1',
    WHATSAPP_WEB_BRIDGE_URL: 'http://127.0.0.1:9',
    WHATSAPP_WEB_BRIDGE_SESSION_ID: 'main',
    WHATSAPP_WEB_BRIDGE_API_SECRET: 'a'.repeat(40),
    WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET: 'b'.repeat(40),
    NODE_ENV: 'test',
  }
  const ENV_KEYS = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_SECRET', 'WHATSAPP_EXPERTS_TO', 'WHATSAPP_WEB_BRIDGE_FALLBACK',
    'NOTIFY_QUIET_HOURS', 'NOTIFY_COOLDOWN_MINUTES', 'TELEGRAM_ADMIN_CHAT_IDS', 'TELEGRAM_CHAT_ID', 'ADMIN_NOTIFICATION_EMAIL', 'ADMIN_EMAIL',
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_BOT_TOKEN', 'CRM_DIGEST_WHATSAPP', 'ASSISTANT_ESCALATION_WHATSAPP', ...Object.keys(BRIDGE_ENV).filter((k) => k !== 'NODE_ENV')]
  const saved: Record<string, string | undefined> = {}

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input)
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (url.startsWith('http://127.0.0.1:9/')) {
      bridgeCalls.push({ url, headers, body })
      return new Response(JSON.stringify({ message_id: `bridge-${++seq}` }), { status: 200 })
    }
    if (!url.startsWith('https://graph.facebook.com/')) return new Response('{}', { status: 404 })
    calls.push({ url, headers, body })
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    if (mode === 'timeout') throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    if (mode === 'http500') return new Response(JSON.stringify({ error: { message: 'Service temporarily unavailable', code: 2, is_transient: true } }), { status: 500 })
    if (mode === 'http400') return new Response(JSON.stringify({ error: { message: 'Template name does not exist in the translation', code: 132001 } }), { status: 400 })
    return new Response(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.${tag}.${++seq}` }] }), { status: 200 })
  }

  const phone = () => `+7701${String(++phoneSeq % 10_000_000).padStart(7, '0')}`
  const sendsTo = (p: string) => calls.filter((c) => c.body.to === p.slice(1))

  async function mkUser(role = 'client', staffRole: string | null = null): Promise<string> {
    const id = randomUUID()
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${id}::uuid, ${`${tag}.${id.slice(0, 8)}@test.local`})`
    await prisma.$executeRaw`UPDATE public.profiles SET role = ${role}, status = 'approved' WHERE id = ${id}::uuid`
    if (staffRole) await prisma.$executeRaw`INSERT INTO public.staff_roles (user_id, role) VALUES (${id}::uuid, ${staffRole})`
    users.push(id)
    return id
  }

  async function link(userId: string, kind: 'staff' | 'expert' | 'client', p: string, o: { optIn?: boolean; minLevel?: string; mutedUntil?: Date | null } = {}) {
    await prisma.$executeRaw`
      INSERT INTO public.whatsapp_links (user_id, recipient_kind, phone_e164, verified_at, opt_in_at, min_level, muted_until)
      VALUES (${userId}::uuid, ${kind}, ${p}, now() - interval '1 day', ${o.optIn === false ? null : new Date(Date.now() - 86_400_000)},
              ${o.minLevel ?? 'INFO'}, ${o.mutedUntil ?? null})
      ON CONFLICT (user_id, recipient_kind) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164, verified_at = EXCLUDED.verified_at,
        opt_in_at = EXCLUDED.opt_in_at, opt_out_at = NULL, min_level = EXCLUDED.min_level, muted_until = EXCLUDED.muted_until`
  }

  async function row(id: string) {
    const r = await prisma.$queryRaw<Array<{ status: string; attempts: number; last_error: string | null; provider_message_id: string | null; transport: string | null; next_attempt_at: Date }>>`
      SELECT status, attempts::int, last_error, provider_message_id, transport, next_attempt_at FROM public.whatsapp_outbox WHERE id = ${id}::uuid`
    return r[0]
  }

  const digest = (n = 1) => templates.digestTemplate({ overdue: n, sleeping: 2, weakBlock: null })

  async function clientRow(o: { optIn?: boolean; maxAttempts?: number; level?: 'INFO' | 'WARNING' | 'CRITICAL'; mutedUntil?: Date | null } = {}) {
    const u = await mkUser()
    const p = phone()
    await link(u, 'client', p, { optIn: o.optIn, mutedUntil: o.mutedUntil })
    const r = await outbox.enqueueWhatsApp({ idempotencyKey: `${tag}:${randomUUID()}`, kind: 'client', userId: u, phoneE164: p, payload: digest(), maxAttempts: o.maxAttempts, level: o.level })
    return { userId: u, phone: p, id: r.id }
  }

  beforeAll(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k]
    for (const k of ENV_KEYS) delete process.env[k]
    process.env.WHATSAPP_TOKEN = 'test-token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = PNID
    process.env.WHATSAPP_VERIFY_SECRET = 'verify-secret-for-tests'
    process.env.NOTIFY_QUIET_HOURS = ''
    process.env.TELEGRAM_ADMIN_CHAT_IDS = ''
    vi.stubGlobal('fetch', fakeFetch)
    __setRateLimitStoreForTests(null)
  })

  beforeEach(() => {
    mode = 'ok'
    delayMs = 0
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    if (users.length) {
      await prisma.$executeRaw`DELETE FROM public.whatsapp_outbox WHERE user_id = ANY (${users}::uuid[]) OR idempotency_key LIKE ${`%${tag}%`}`
      await prisma.$executeRaw`DELETE FROM public.notification_events WHERE dedupe_key LIKE ${`${tag}%`}`
      await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ANY (${users}::uuid[])`
    }
    await closeTestPool()
  })

  // ── Schema / RLS ──────────────────────────────────────────────────────────

  describe('schema', () => {
    it('notification_deliveries accepts the whatsapp channel (087 did not)', async () => {
      const [e] = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO public.notification_events (level, type, title, dedupe_key) VALUES ('INFO', 'test.whatsapp', 't', ${`${tag}:schema`}) RETURNING id::text`
      await prisma.$executeRaw`INSERT INTO public.notification_deliveries (event_id, channel, target, status) VALUES (${e.id}::uuid, 'whatsapp', 'wa:x', 'queued')`
      const code = await pgErrorCode(prisma.$executeRaw`INSERT INTO public.notification_deliveries (event_id, channel, target) VALUES (${e.id}::uuid, 'sms', 'x')`)
      expect(code).not.toBeNull()
    })

    it('outbox is server-only; a person reads only their own link and never the code hash', async () => {
      const owner = await mkUser()
      const other = await mkUser()
      await link(owner, 'client', phone())
      await inRollback(async (db) => {
        expect(await pgErrorCode(asUser(db, owner, () => db.query('SELECT id FROM public.whatsapp_outbox LIMIT 1')))).toBe('42501')
        const own = await asUser(db, owner, () => db.query('SELECT user_id, phone_e164, opt_in_at FROM public.whatsapp_links'))
        expect(own.rows.map((r) => r.user_id)).toEqual([owner])
        expect(await pgErrorCode(asUser(db, owner, () => db.query('SELECT verify_code_hash FROM public.whatsapp_links')))).toBe('42501')
        expect(await pgErrorCode(asUser(db, owner, () => db.query(`UPDATE public.whatsapp_links SET opt_in_at = now() WHERE user_id = '${owner}'`)))).toBe('42501')
        const theirs = await asUser(db, other, () => db.query('SELECT user_id FROM public.whatsapp_links'))
        expect(theirs.rows).toHaveLength(0)
        expect(await pgErrorCode(asUser(db, owner, () => db.query(`SELECT public.claim_whatsapp_outbox('x', 1, 60, NULL)`)))).toBe('42501')
      })
    })
  })

  // ── Outbox ────────────────────────────────────────────────────────────────

  describe('outbox', () => {
    it('two workers never claim the same row (FOR UPDATE SKIP LOCKED)', async () => {
      const ids: string[] = []
      for (let i = 0; i < 10; i++) ids.push((await clientRow()).id)
      const a = await testPool().connect()
      const b = await testPool().connect()
      try {
        await a.query('BEGIN')
        await b.query('BEGIN')
        const ra = await a.query(`SELECT id::text FROM public.claim_whatsapp_outbox('worker-a', 5, 120, $1::uuid[])`, [ids])
        const rb = await b.query(`SELECT id::text FROM public.claim_whatsapp_outbox('worker-b', 10, 120, $1::uuid[])`, [ids])
        await a.query('COMMIT')
        await b.query('COMMIT')
        const sa = ra.rows.map((r) => r.id)
        const sb = rb.rows.map((r) => r.id)
        expect(sa).toHaveLength(5)
        expect(sb).toHaveLength(5)
        expect(sa.filter((id) => sb.includes(id))).toEqual([])
        expect(new Set([...sa, ...sb])).toEqual(new Set(ids))
        const again = await a.query(`SELECT id FROM public.claim_whatsapp_outbox('worker-c', 10, 120, $1::uuid[])`, [ids])
        expect(again.rows).toHaveLength(0)
      } finally {
        await prisma.$executeRaw`UPDATE public.whatsapp_outbox SET status = 'skipped', lease_owner = NULL, lease_token = NULL, lease_until = NULL WHERE id = ANY (${ids}::uuid[])`
        a.release()
        b.release()
      }
    })

    it('concurrent drains send every row exactly once', async () => {
      const rows = []
      for (let i = 0; i < 12; i++) rows.push(await clientRow())
      const ids = rows.map((r) => r.id)
      delayMs = 15
      const results = await Promise.all([1, 2, 3].map(() => outbox.drainWhatsAppOutbox({ ids, limit: 12 })))
      expect(results.reduce((n, r) => n + r.sent, 0)).toBe(12)
      for (const r of rows) {
        expect(sendsTo(r.phone)).toHaveLength(1)
        expect((await row(r.id)).status).toBe('sent')
      }
    })

    it('enqueue is idempotent: the same key is one row and one message', async () => {
      const u = await mkUser()
      const p = phone()
      await link(u, 'client', p)
      const key = `${tag}:idem:${u}`
      const first = await outbox.enqueueWhatsApp({ idempotencyKey: key, kind: 'client', userId: u, phoneE164: p, payload: digest() })
      const second = await outbox.enqueueWhatsApp({ idempotencyKey: key, kind: 'client', userId: u, phoneE164: p, payload: digest(9) })
      expect(second).toEqual({ id: first.id, status: 'queued', created: false })
      await outbox.drainWhatsAppOutbox({ ids: [first.id] })
      const third = await outbox.enqueueWhatsApp({ idempotencyKey: key, kind: 'client', userId: u, phoneE164: p, payload: digest() })
      expect(third.created).toBe(false)
      expect(third.status).toBe('sent')
      await outbox.drainWhatsAppOutbox({ ids: [first.id] })
      expect(sendsTo(p)).toHaveLength(1)
      expect(sendsTo(p)[0].body.template.components[0].parameters[0].text).toBe('1')
    })

    it('a timeout after the send is delivery_unknown and is never resent', async () => {
      const r = await clientRow()
      mode = 'timeout'
      const res = await outbox.drainWhatsAppOutbox({ ids: [r.id] })
      expect(res.unknown).toBe(1)
      expect((await row(r.id)).status).toBe('delivery_unknown')
      mode = 'ok'
      await prisma.$executeRaw`UPDATE public.whatsapp_outbox SET next_attempt_at = now() - interval '1 hour' WHERE id = ${r.id}::uuid`
      const again = await outbox.drainWhatsAppOutbox({ ids: [r.id] })
      expect(again.claimed).toBe(0)
      expect(sendsTo(r.phone)).toHaveLength(1)
    })

    it('a dead worker: before the fence the row is retried, after it the row is unknown', async () => {
      const before = await clientRow()
      const after = await clientRow()
      const owner = `dead-${tag}`
      const claimed = await prisma.$queryRaw<Array<{ id: string; lease_token: string }>>`
        SELECT id::text, lease_token::text FROM public.claim_whatsapp_outbox(${owner}, 2, 30, ${[before.id, after.id]}::uuid[])`
      expect(claimed).toHaveLength(2)
      const fenced = claimed.find((c) => c.id === after.id)!
      const ok = await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT public.start_whatsapp_outbox_send(${fenced.id}::uuid, ${fenced.lease_token}::uuid, 'cloud_api') AS ok`
      expect(ok[0].ok).toBe(true)
      // A second fence on the same lease is refused (one provider request per lease).
      const twice = await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT public.start_whatsapp_outbox_send(${fenced.id}::uuid, ${fenced.lease_token}::uuid, 'cloud_api') AS ok`
      expect(twice[0].ok).toBe(false)
      await prisma.$executeRaw`UPDATE public.whatsapp_outbox SET lease_until = now() - interval '1 second' WHERE id = ANY (${[before.id, after.id]}::uuid[])`

      const res = await outbox.drainWhatsAppOutbox({ ids: [before.id, after.id] })
      expect(res.sent).toBe(1)
      expect((await row(before.id)).status).toBe('sent')
      expect(await row(after.id)).toMatchObject({ status: 'delivery_unknown', last_error: 'lease_expired_after_send' })
      expect(sendsTo(after.phone)).toHaveLength(0)
    })

    it('provider errors retry with backoff, then fail after max_attempts', async () => {
      const r = await clientRow({ maxAttempts: 2 })
      mode = 'http500'
      const first = await outbox.drainWhatsAppOutbox({ ids: [r.id] })
      expect(first.retried).toBe(1)
      const after1 = await row(r.id)
      expect(after1).toMatchObject({ status: 'queued', attempts: 1 })
      expect(after1.last_error).toContain('HTTP 500')
      expect(after1.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 20_000)
      // Not due yet: nothing is claimed.
      expect((await outbox.drainWhatsAppOutbox({ ids: [r.id] })).claimed).toBe(0)
      await prisma.$executeRaw`UPDATE public.whatsapp_outbox SET next_attempt_at = now() WHERE id = ${r.id}::uuid`
      await outbox.drainWhatsAppOutbox({ ids: [r.id] })
      expect(await row(r.id)).toMatchObject({ status: 'failed', attempts: 2 })
      expect(sendsTo(r.phone)).toHaveLength(2)
    })

    it('a permanent provider error fails at once; the stored error has no phone number', async () => {
      const r = await clientRow()
      mode = 'http400'
      await outbox.drainWhatsAppOutbox({ ids: [r.id] })
      const after = await row(r.id)
      expect(after.status).toBe('failed')
      expect(after.last_error).toContain('132001')
      expect(after.last_error).not.toContain(r.phone.slice(1))
    })
  })

  // ── Authorization ─────────────────────────────────────────────────────────

  describe('authorization at send time', () => {
    it('without opt-in nothing is sent', async () => {
      const r = await clientRow({ optIn: false })
      const res = await outbox.drainWhatsAppOutbox({ ids: [r.id] })
      expect(res.skipped).toBe(1)
      expect(await row(r.id)).toMatchObject({ status: 'skipped', last_error: 'not_opted_in' })
      expect(sendsTo(r.phone)).toHaveLength(0)
    })

    it('opt-out after enqueue stops the message; a changed number too', async () => {
      const a = await clientRow()
      await links.optOut(a.userId, 'client')
      await outbox.drainWhatsAppOutbox({ ids: [a.id] })
      expect((await row(a.id)).last_error).toBe('not_opted_in')

      const b = await clientRow()
      await prisma.$executeRaw`UPDATE public.whatsapp_links SET phone_e164 = ${phone()} WHERE user_id = ${b.userId}::uuid`
      await outbox.drainWhatsAppOutbox({ ids: [b.id] })
      expect((await row(b.id)).last_error).toBe('phone_changed')
      expect(sendsTo(a.phone).length + sendsTo(b.phone).length).toBe(0)
    })

    it('mute holds back non-critical messages only', async () => {
      const muted = new Date(Date.now() + 3_600_000)
      const warn = await clientRow({ level: 'WARNING', mutedUntil: muted })
      const crit = await clientRow({ level: 'CRITICAL', mutedUntil: muted })
      await outbox.drainWhatsAppOutbox({ ids: [warn.id, crit.id] })
      expect(await row(warn.id)).toMatchObject({ status: 'skipped', last_error: 'muted' })
      expect((await row(crit.id)).status).toBe('sent')
    })
  })

  // ── Status webhook ────────────────────────────────────────────────────────

  describe('status webhook', () => {
    it('moves sent → delivered → read monotonically and mirrors failures into the delivery log', async () => {
      const r = await clientRow()
      await outbox.drainWhatsAppOutbox({ ids: [r.id] })
      const pid = (await row(r.id)).provider_message_id!
      expect(pid).toMatch(/^wamid\./)
      const at = new Date().toISOString()
      expect(await outbox.applyWhatsAppOutboxStatus({ providerMessageId: pid, status: 'delivered', occurredAt: at })).toEqual({ matched: true, status: 'delivered' })
      expect((await outbox.applyWhatsAppOutboxStatus({ providerMessageId: pid, status: 'sent', occurredAt: at })).status).toBe('delivered')
      expect((await outbox.applyWhatsAppOutboxStatus({ providerMessageId: pid, status: 'read', occurredAt: at })).status).toBe('read')
      expect((await outbox.applyWhatsAppOutboxStatus({ providerMessageId: pid, status: 'failed', occurredAt: at })).status).toBe('read')
      expect(await outbox.applyWhatsAppOutboxStatus({ providerMessageId: `wamid.unknown.${tag}`, status: 'read', occurredAt: null })).toEqual({ matched: false, status: null })
    })
  })

  // ── Linking ───────────────────────────────────────────────────────────────

  describe('linking and verification', () => {
    const lastCode = (p: string) => {
      const c = sendsTo(p).at(-1)!
      expect(c.body.template.name).toBe('phone_verification')
      const code = c.body.template.components[0].parameters[0].text as string
      expect(c.body.template.components[1]).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] })
      return code
    }

    it('sends a code, stores only its HMAC, verifies and records the opt-in', async () => {
      const u = await mkUser()
      const p = phone()
      expect(await links.startVerification(u, 'client', p, false)).toEqual({ ok: false, code: 'consent_required' })
      expect(await links.startVerification(u, 'client', '12345', true)).toEqual({ ok: false, code: 'invalid_phone' })
      const start = await links.startVerification(u, 'client', `8${p.slice(2)}`, true) // KZ/RU 8XXXXXXXXXX → +7…
      expect(start).toMatchObject({ ok: true, delivery: 'sent' })
      const code = lastCode(p)
      expect(code).toMatch(/^\d{6}$/)
      const [stored] = await prisma.$queryRaw<Array<{ verify_code_hash: string; pending_phone_e164: string; opt_in_at: Date | null }>>`
        SELECT verify_code_hash, pending_phone_e164, opt_in_at FROM public.whatsapp_links WHERE user_id = ${u}::uuid AND recipient_kind = 'client'`
      expect(stored.verify_code_hash).toMatch(/^[a-f0-9]{64}$/)
      expect(stored.verify_code_hash).not.toContain(code)
      expect(stored.pending_phone_e164).toBe(p)
      expect(stored.opt_in_at).toBeNull()

      const wrong = code === '000000' ? '111111' : '000000'
      expect(await links.confirmVerification(u, 'client', wrong)).toEqual({ ok: false, code: 'invalid_code' })
      expect(await links.confirmVerification(u, 'client', code)).toEqual({ ok: true, phone: p })
      const status = await links.getLinkStatus(u, 'client')
      expect(status).toMatchObject({ phone: p, verified: true, optedIn: true, pending: null })
      // The code is single-use.
      expect(await links.confirmVerification(u, 'client', code)).toEqual({ ok: false, code: 'expired' })
    })

    it('five wrong codes burn the code; an expired code is refused', async () => {
      const u = await mkUser()
      const p = phone()
      await links.startVerification(u, 'expert', p, true)
      const code = lastCode(p)
      const wrong = code === '000000' ? '111111' : '000000'
      for (let i = 0; i < 4; i++) expect((await links.confirmVerification(u, 'expert', wrong)).ok).toBe(false)
      expect(await links.confirmVerification(u, 'expert', wrong)).toEqual({ ok: false, code: 'too_many_attempts' })
      expect(await links.confirmVerification(u, 'expert', code)).toEqual({ ok: false, code: 'expired' })

      const v = await mkUser()
      const q = phone()
      await links.startVerification(v, 'client', q, true)
      const c2 = lastCode(q)
      expect(await links.confirmVerification(v, 'client', c2, { now: new Date(Date.now() + 11 * 60_000) })).toEqual({ ok: false, code: 'expired' })
    })

    it('rate limits code requests per person (fail-closed bucket)', async () => {
      const u = await mkUser()
      const results = []
      for (let i = 0; i < 4; i++) results.push(await links.startVerification(u, 'client', phone(), true))
      expect(results.slice(0, 3).every((r) => r.ok)).toBe(true)
      expect(results[3]).toMatchObject({ ok: false, code: 'rate_limited' })
    })

    it('without Cloud API (and no bridge for clients) linking is unavailable', async () => {
      const u = await mkUser()
      const res = await links.startVerification(u, 'client', phone(), true, { env: { WHATSAPP_VERIFY_SECRET: 's', ...BRIDGE_ENV, WHATSAPP_WEB_BRIDGE_FALLBACK: '1' } })
      expect(res).toEqual({ ok: false, code: 'not_configured' })
    })
  })

  // ── Fan-out ───────────────────────────────────────────────────────────────

  describe('staff fan-out', () => {
    let staffId = ''
    let staffPhone = ''
    beforeAll(async () => {
      staffId = await mkUser('client', 'admin')
      staffPhone = phone()
      await link(staffId, 'staff', staffPhone, { minLevel: 'WARNING' })
    })

    it('a WARNING reaches linked staff once, through the staff_alert template, logged without the number', async () => {
      const key = `${tag}:staff:1`
      const res = await notifyStaff({ level: 'WARNING', type: 'agent.failed', title: 'Агент не справился', lines: ['Агент: x'], dedupeKey: key, link: '/admin-giga-panel/agents/tasks/1' })
      expect(res.deliveries).toContainEqual({ channel: 'whatsapp', target: `wa:${staffId}`, status: 'sent' })
      const c = sendsTo(staffPhone).at(-1)!
      expect(c.body.template.name).toBe('staff_alert')
      expect(c.body.template.components[1].parameters[0].text).toBe('admin-giga-panel/agents/tasks/1')
      const [d] = await prisma.$queryRaw<Array<{ status: string; target: string; provider_message_id: string | null }>>`
        SELECT d.status, d.target, d.provider_message_id FROM public.notification_deliveries d
        JOIN public.notification_events e ON e.id = d.event_id WHERE e.dedupe_key = ${key} AND d.channel = 'whatsapp'`
      expect(d).toMatchObject({ status: 'sent', target: `wa:${staffId}` })
      expect(d.provider_message_id).toMatch(/^wamid\./)

      const before = sendsTo(staffPhone).length
      await notifyStaff({ level: 'WARNING', type: 'agent.failed', title: 'Агент не справился', dedupeKey: key })
      expect(sendsTo(staffPhone)).toHaveLength(before)
    })

    it('below the level, in cooldown or at night nothing is sent; CRITICAL still goes at night', async () => {
      const before = sendsTo(staffPhone).length
      const info = await notifyStaff({ level: 'INFO', type: 'client.created', title: 'Новый клиент', dedupeKey: `${tag}:staff:info` })
      expect(info.deliveries).toContainEqual({ channel: 'whatsapp', target: `wa:${staffId}`, status: 'skipped', reason: 'below_platform_level' })
      const cooled = await notifyStaff({ level: 'WARNING', type: 'agent.failed', title: 'Снова', dedupeKey: `${tag}:staff:2` })
      expect(cooled.deliveries).toContainEqual({ channel: 'whatsapp', target: `wa:${staffId}`, status: 'skipped', reason: 'cooldown' })

      process.env.NOTIFY_QUIET_HOURS = '23-8'
      const night = new Date('2026-10-06T20:00:00Z') // 01:00 Asia/Almaty
      try {
        const quiet = await notifyStaff({ level: 'WARNING', type: 'integration.failed', title: 'Ночью', dedupeKey: `${tag}:staff:night` }, { now: night })
        expect(quiet.deliveries).toContainEqual({ channel: 'whatsapp', target: `wa:${staffId}`, status: 'skipped', reason: 'quiet_hours' })
        expect(sendsTo(staffPhone)).toHaveLength(before)
        const crit = await notifyStaff({ level: 'CRITICAL', type: 'diagnostic.critical_risk', title: 'Критично', dedupeKey: `${tag}:staff:crit` }, { now: night })
        expect(crit.deliveries).toContainEqual({ channel: 'whatsapp', target: `wa:${staffId}`, status: 'sent' })
      } finally {
        process.env.NOTIFY_QUIET_HOURS = ''
      }
    })
  })

  describe('expert fan-out, escalation, report review, client digest', () => {
    it('experts get the expert_notification template by their own level; duplicates are not resent', async () => {
      const e1 = await mkUser('expert')
      const e2 = await mkUser('expert')
      const p1 = phone()
      const p2 = phone()
      await link(e1, 'expert', p1, { minLevel: 'INFO' })
      await link(e2, 'expert', p2, { minLevel: 'CRITICAL' })
      const notice = { kind: 'diagnostic.completed' as const, dedupeKey: `${tag}:exp:1`, lines: ['Клиент: Ромашка'], level: 'SUCCESS' as const }
      const out = await notifyExpertsWhatsApp(notice)
      expect(out).toContainEqual(expect.objectContaining({ userId: e1, status: 'queued' }))
      expect(out).toContainEqual({ userId: e2, status: 'skipped', reason: 'below_personal_level' })
      expect(sendsTo(p1)).toHaveLength(1)
      expect(sendsTo(p1)[0].body.template.name).toBe('expert_notification')
      expect(sendsTo(p2)).toHaveLength(0)
      const again = await notifyExpertsWhatsApp(notice)
      expect(again).toContainEqual({ userId: e1, status: 'skipped', reason: 'duplicate' })
      expect(sendsTo(p1)).toHaveLength(1)
    })

    it('the escalation adapter sends an approved template, not free-form text', async () => {
      const envNumber = phone()
      process.env.WHATSAPP_EXPERTS_TO = envNumber
      try {
        await new WhatsAppEscalationAdapter().notify({
          id: `tmp_${tag}`, userId: randomUUID(), status: 'new', priority: 'high', triggerType: 'manual',
          title: 'Обращение', summary: 'Компания: Ромашка.', detectedIssues: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        })
      } finally {
        delete process.env.WHATSAPP_EXPERTS_TO
      }
      const c = sendsTo(envNumber)
      expect(c).toHaveLength(1)
      expect(c[0].body.type).toBe('template')
      expect(c[0].body.template.name).toBe('expert_notification')
      expect(c[0].body.text).toBeUndefined()
    })

    it('report review: one report_review message per expert and version', async () => {
      const ex = await mkUser('expert')
      const p = phone()
      await link(ex, 'expert', p)
      const owner = await mkUser()
      const companyId = randomUUID()
      await prisma.$executeRaw`INSERT INTO public.companies (id, name, user_id, "updatedAt") VALUES (${companyId}, ${`Ромашка ${tag}`}, ${owner}::uuid, now())`
      const [v] = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO public.report_versions (company_id, report_type, version, status, title, content, provenance, data_hash, created_by)
        VALUES (${companyId}, 'point_a', 3, 'draft', 'Диагностика бизнеса', '{}'::jsonb, '{}'::jsonb, ${`hash-${tag}`}, 'test')
        RETURNING id::text`
      const res = await enqueueReportReviewWhatsApp(v.id, [ex])
      expect(res).toEqual([expect.objectContaining({ userId: ex, created: true })])
      const c = sendsTo(p)
      expect(c).toHaveLength(1)
      expect(c[0].body.template.name).toBe('report_review')
      expect(c[0].body.template.components[0].parameters.map((x: { text: string }) => x.text).slice(0, 2)).toEqual(['Диагностика бизнеса', '3'])
      await enqueueReportReviewWhatsApp(v.id, [ex])
      expect(sendsTo(p)).toHaveLength(1)
      await prisma.$executeRaw`DELETE FROM public.report_versions WHERE id = ${v.id}::uuid`
      await prisma.$executeRaw`DELETE FROM public.companies WHERE id = ${companyId}`
    })

    it('client digest: template digest once per day to the verified number', async () => {
      const u = await mkUser()
      const p = phone()
      await link(u, 'client', p)
      const msg = { title: 't', body: 'b', data: { overdue: 4, sleeping: 7, weakBlock: { label: 'Операции', score: 2.5 } }, day: '2026-10-06' }
      expect(await whatsappChannel.send({ userId: u, phone: p, whatsappOptIn: true }, msg)).toBe(true)
      expect(await whatsappChannel.send({ userId: u, phone: p, whatsappOptIn: true }, msg)).toBe(false)
      const c = sendsTo(p)
      expect(c).toHaveLength(1)
      expect(c[0].body.template.name).toBe('digest')
      expect(c[0].body.template.components[0].parameters.map((x: { text: string }) => x.text)).toEqual(['4', '7', 'Операции (2.5)'])
    })
  })

  // ── Bridge fallback ───────────────────────────────────────────────────────

  describe('WhatsApp Web bridge fallback', () => {
    const noCloud = { WHATSAPP_VERIFY_SECRET: 's', ...BRIDGE_ENV }

    async function staffRow() {
      const s = await mkUser('client', 'admin')
      const p = phone()
      await link(s, 'staff', p)
      const r = await outbox.enqueueWhatsApp({
        idempotencyKey: `${tag}:${randomUUID()}`, kind: 'staff', userId: s, phoneE164: p, level: 'CRITICAL',
        payload: templates.staffAlertTemplate({ levelLabel: 'Критично', title: 'Сбой', lines: ['x'], path: '/admin-giga-panel' }),
      })
      return { id: r.id, phone: p }
    }

    it('staff + flag: no Cloud API → the bridge, with our idempotency key', async () => {
      const r = await staffRow()
      const before = bridgeCalls.length
      const res = await outbox.drainWhatsAppOutbox({ ids: [r.id], env: { ...noCloud, WHATSAPP_WEB_BRIDGE_FALLBACK: '1' } })
      expect(res).toMatchObject({ sent: 1, viaBridge: 1 })
      const b = bridgeCalls.slice(before)
      expect(b).toHaveLength(1)
      expect(b[0].url).toBe('http://127.0.0.1:9/v1/sessions/main/messages')
      expect(b[0].headers['Idempotency-Key']).toBe(`wa-outbox:${r.id}`)
      expect(b[0].body).toMatchObject({ to: `${r.phone.slice(1)}@s.whatsapp.net`, type: 'text', idempotency_key: `wa-outbox:${r.id}` })
      expect(b[0].body.text).toContain('Сбой')
      expect(await row(r.id)).toMatchObject({ status: 'sent', transport: 'web_bridge' })
    })

    it('without the flag the bridge is never used', async () => {
      const r = await staffRow()
      const before = bridgeCalls.length
      await outbox.drainWhatsAppOutbox({ ids: [r.id], env: noCloud })
      expect(await row(r.id)).toMatchObject({ status: 'failed', last_error: 'not_configured' })
      // In pull delivery mode the bridge has no inbound URL: no direct fallback either.
      const pulled = await staffRow()
      await outbox.drainWhatsAppOutbox({ ids: [pulled.id], env: { ...noCloud, WHATSAPP_WEB_BRIDGE_FALLBACK: '1', WHATSAPP_WEB_DELIVERY_MODE: 'pull' } })
      expect(await row(pulled.id)).toMatchObject({ status: 'failed', last_error: 'not_configured' })
      expect(bridgeCalls.length).toBe(before)
    })

    it('clients never go through the bridge, even with the flag', async () => {
      const r = await clientRow()
      const before = bridgeCalls.length
      await outbox.drainWhatsAppOutbox({ ids: [r.id], env: { ...noCloud, WHATSAPP_WEB_BRIDGE_FALLBACK: '1' } })
      expect(await row(r.id)).toMatchObject({ status: 'failed', last_error: 'not_configured' })
      expect(bridgeCalls.length).toBe(before)
    })

    it('a permanent Cloud API refusal falls back for staff only; a timeout never does', async () => {
      const withCloud = { ...noCloud, WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: PNID, WHATSAPP_WEB_BRIDGE_FALLBACK: '1' }
      mode = 'http400'
      const s = await staffRow()
      const c = await clientRow()
      const before = bridgeCalls.length
      await outbox.drainWhatsAppOutbox({ ids: [s.id, c.id], env: withCloud })
      expect(await row(s.id)).toMatchObject({ status: 'sent', transport: 'web_bridge' })
      expect((await row(c.id)).status).toBe('failed')
      expect(bridgeCalls.length).toBe(before + 1)

      mode = 'timeout'
      const t = await staffRow()
      await outbox.drainWhatsAppOutbox({ ids: [t.id], env: withCloud })
      expect((await row(t.id)).status).toBe('delivery_unknown')
      expect(bridgeCalls.length).toBe(before + 1)
    })
  })
})
