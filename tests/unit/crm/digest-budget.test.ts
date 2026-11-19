/**
 * GET /api/cron/crm-digest keeps its run budget even when a provider never answers (review,
 * medium): the e-mail send (Resend SDK, no timeout), the in-app write, Telegram and WhatsApp of
 * one owner were awaited without a bound — runBounded only refuses to START an owner with < 10 s
 * left, so one hung send held the run past 45 s. Every per-owner send is now bounded by the run's
 * deadline; an owner whose sends ran out of budget is reported as not delivered.
 */
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const never = () => new Promise<never>(() => {})

const h = vi.hoisted(() => ({
  emailOk: new Set<string>(),
  calls: [] as string[],
}))

vi.mock('@/lib/crm/digest', async (orig) => ({
  ...(await orig<typeof import('@/lib/crm/digest')>()),
  // a 1.5 s run instead of 44 s; every owner at once
  DIGEST_RUN_MS: 1_500,
  DIGEST_MIN_START_MS: 100,
  DIGEST_CONCURRENCY: 6,
}))
vi.mock('@/lib/cron-auth', () => ({ isAuthorizedCron: () => ({ ok: true }) }))
vi.mock('@/lib/notifications/create', () => ({
  createNotification: (n: { userId: string }) => { h.calls.push(`inapp:${n.userId}`); return never() },
}))
vi.mock('@/lib/notifications/notify', () => ({ notifyClient: async () => ({ ok: true, skipped: true }) }))
vi.mock('@/lib/email', () => ({
  sendUserEmail: (m: { to: string }) => {
    h.calls.push(`email:${m.to}`)
    return h.emailOk.has(m.to) ? Promise.resolve({ ok: true }) : never()
  },
}))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: (chat: string) => { h.calls.push(`tg:${chat}`); return never() } }))
vi.mock('@/lib/whatsapp/config', () => ({ cloudApiConfigured: () => true }))
vi.mock('@/lib/whatsapp/links', () => ({ optedInRecipients: async () => [{ userId: 'u-wa', phone: '+77010000009' }] }))
vi.mock('@/lib/crm/digest-channels', () => ({
  EXTRA_DIGEST_CHANNELS: [{
    key: 'whatsapp',
    isEnabled: (r: { userId: string }) => r.userId === 'u-wa',
    send: (r: { userId: string }) => { h.calls.push(`wa:${r.userId}`); return never() },
  }],
}))

/** A service client over fixed rows: every query chain resolves to its table's rows (no second page). */
const off = { in_app: false, email: false, telegram: false }
const tables: Record<string, unknown[]> = {
  crm_clients: ['u-mail', 'u-tg', 'u-inapp', 'u-wa', 'u-fast'].map((u, i) => ({
    id: `c${i}`, user_id: u, status: 'new', next_contact_at: '2026-11-01T00:00:00Z', last_contact_at: null, created_at: '2026-10-01T00:00:00Z',
  })),
  crm_reminders: [],
  gri_assessments: [],
  profiles: [
    { id: 'u-mail', email: 'mail@ex.kz', telegram_chat_id: null, preferences: { notifications: { crm: { ...off, email: true } } } },
    { id: 'u-tg', email: null, telegram_chat_id: '42', preferences: { notifications: { crm: { ...off, telegram: true } } } },
    { id: 'u-inapp', email: null, telegram_chat_id: null, preferences: { notifications: { crm: { ...off, in_app: true } } } },
    { id: 'u-wa', email: null, telegram_chat_id: null, preferences: { notifications: { crm: off } } },
    { id: 'u-fast', email: 'fast@ex.kz', telegram_chat_id: null, preferences: { notifications: { crm: { ...off, email: true } } } },
  ],
}
function fakeService() {
  return {
    from(table: string) {
      let paged = false
      const chain: Record<string, unknown> = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (r: unknown) => unknown, err: (e: unknown) => unknown) =>
              Promise.resolve({ data: paged ? [] : tables[table] ?? [], error: null }).then(ok, err)
          }
          return () => {
            if (prop === 'gt') paged = true
            return chain
          }
        },
      })
      return chain
    },
  }
}
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeService() }))

const digest = await import('../../../app/api/cron/crm-digest/route')

describe('crm-digest run budget', () => {
  it('a provider that never answers does not hold the run: it ends within budget, the owner is not delivered', async () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    h.emailOk = new Set(['fast@ex.kz'])
    h.calls = []
    const started = Date.now()
    const res = await Promise.race([
      digest.GET(new NextRequest('http://localhost/api/cron/crm-digest', { headers: { authorization: 'Bearer test-cron-secret' } })),
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 5_000)),
    ])
    expect(res).not.toBe('hung')
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(3_000)

    const body = (await (res as Response).json()) as { ok: boolean; data: Record<string, number> }
    expect(body.ok).toBe(true)
    // every hung channel was tried (they ran in parallel) and cut at the deadline
    expect(h.calls).toEqual(expect.arrayContaining(['email:mail@ex.kz', 'tg:42', 'inapp:u-inapp', 'wa:u-wa', 'email:fast@ex.kz']))
    expect(body.data).toMatchObject({
      usersNotified: 1, // only the owner whose e-mail went out
      emailsSent: 1,
      telegramSent: 0,
      whatsappSent: 0,
      undelivered: 4,
      timedOut: 4,
      deferred: 0,
    })
  }, 10_000)
})
