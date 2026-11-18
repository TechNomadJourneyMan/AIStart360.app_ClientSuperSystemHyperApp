// The production server runs in UTC (Railway); the digest's «today» is the Almaty day (L4/L5).
process.env.TZ = 'UTC'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { dbTestsEnabled } from '../helpers/db-env'
import { pgPostgrest } from '../helpers/pg-postgrest'
import { closeTestPool, inRollback, seedUser, type Db } from '../helpers/pg-rls'

/**
 * L4 — the morning CRM digest (GET /api/cron/crm-digest) counts the SAME buckets as «Кому звонить
 * сегодня»: a reminder due later today is «на сегодня», not «просрочено», and its sleeping count
 * matches the queue. M6 — next-best-action counts only OPEN overdue reminders (a dismissed one kept
 * done_at = null and was counted forever). Real schema and RLS of the disposable test DB; the
 * delivery channels are spies.
 */
const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  createNotification: vi.fn(async () => undefined),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => h.db }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => h.session }))
vi.mock('@/lib/cron-auth', () => ({ isAuthorizedCron: () => ({ ok: true }) }))
vi.mock('@/lib/notifications/create', () => ({ createNotification: h.createNotification }))
vi.mock('@/lib/notifications/notify', () => ({ notifyClient: async () => ({ ok: true, skipped: true }) }))
vi.mock('@/lib/email', () => ({ sendUserEmail: async () => ({ ok: false }) }))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: async () => false }))
vi.mock('@/lib/whatsapp/links', () => ({ optedInRecipients: async () => [] }))
vi.mock('@/lib/whatsapp/config', () => ({ cloudApiConfigured: () => false }))
// next-best-action: no paid sections, no Point A — only the CRM signal is in play
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/events/server', () => ({ trackUserAction: async () => undefined }))
vi.mock('@/lib/access/decision', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access/decision')>()),
  resolveAccess: async () => ({ gatesEnabled: true, ent: null, staff: false, sections: { gri_full: false, point_b: false, point_a: false } }),
}))

const digest = await import('../../app/api/cron/crm-digest/route')
const todayRoute = await import('../../app/api/v1/crm/today/route')
const nba = await import('../../app/api/v1/nba/route')

// 2026-11-19 04:00 UTC = 09:00 in Almaty — the cron's schedule (0 4 * * *).
const NOW = new Date('2026-11-19T04:00:00Z')

function asOwner(db: Db, id: string) {
  h.session = Object.assign(pgPostgrest(db, id), {
    auth: { getUser: async () => ({ data: { user: { id, email: `${id}@test.local` } }, error: null }) },
  })
}
async function addClient(db: Db, userId: string, name: string, extra: { status?: string; last_contact_at?: string; created_at?: string } = {}) {
  const { rows } = await db.query(
    `INSERT INTO public.crm_clients (user_id, name, status, last_contact_at, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, name, extra.status ?? 'customer', extra.last_contact_at ?? null, extra.created_at ?? '2026-11-10T00:00:00Z'],
  )
  return rows[0].id as string
}
async function addReminder(db: Db, userId: string, clientId: string, dueAt: string, status = 'open') {
  await db.query(`INSERT INTO public.crm_reminders (client_id, user_id, due_at, status) VALUES ($1, $2, $3, $4)`, [clientId, userId, dueAt, status])
}

describe.skipIf(!dbTestsEnabled)('CRM digest and next-best-action', () => {
  afterAll(closeTestPool)
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
    h.createNotification.mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => { vi.useRealTimers() })

  it('the digest splits overdue from due-today and counts what the queue shows', () =>
    inRollback(async (db) => {
      h.db = pgPostgrest(db, null) // the cron's service role
      const owner = await seedUser(db)
      // a reminder due 18:00 Almaty today — on the old UTC end-of-day query it was «просрочено»
      const dueLater = await addClient(db, owner, 'Сегодня вечером', { last_contact_at: '2026-11-18T05:00:00Z' })
      await addReminder(db, owner, dueLater, '2026-11-19T13:00:00Z')
      // a reminder due yesterday → overdue
      const late = await addClient(db, owner, 'Вчерашний', { last_contact_at: '2026-11-17T05:00:00Z' })
      await addReminder(db, owner, late, '2026-11-18T06:00:00Z')
      // a dismissed overdue reminder is no reminder at all
      const dismissed = await addClient(db, owner, 'Отменённый', { last_contact_at: '2026-11-18T05:00:00Z' })
      await addReminder(db, owner, dismissed, '2026-11-18T06:00:00Z', 'dismissed')
      // sleeping: a customer untouched for 40 days, and one never touched since creation in August
      await addClient(db, owner, 'Спящий 1', { last_contact_at: '2026-10-10T05:00:00Z' })
      await addClient(db, owner, 'Спящий 2', { created_at: '2026-08-01T00:00:00Z' })

      const res = await digest.GET(new NextRequest('http://localhost/api/cron/crm-digest', { headers: { authorization: 'Bearer test-cron-secret' } }))
      expect(res.status).toBe(200)
      const calls = h.createNotification.mock.calls as unknown as Array<[{ userId: string; title: string; body: string; metadata: Record<string, number> }]>
      const mine = calls.map((c) => c[0]).filter((n) => n.userId === owner)
      expect(mine).toHaveLength(1)
      expect(mine[0].metadata).toEqual({ overdue: 1, dueToday: 1, sleeping: 2 })
      expect(mine[0].body).toContain('Просрочен запланированный контакт: 1 клиент')
      expect(mine[0].body).toContain('Контакт запланирован на сегодня: 1 клиент')
      expect(mine[0].body).toContain('Спящих клиентов: 2')
      expect(mine[0].title).toContain('4 клиента ждут')

      // …the same numbers as the owner's «Кому звонить сегодня»
      asOwner(db, owner)
      const queue = (await (await todayRoute.GET()).json()) as { stats: { queue: Record<string, number> } }
      expect(queue.stats.queue).toMatchObject({ overdue: 1, today: 1, sleeping: 2 })
    }))

  it('next-best-action: a dismissed overdue reminder is not «overdue»; an open one is', () =>
    inRollback(async (db) => {
      const owner = await seedUser(db)
      const c = await addClient(db, owner, 'Клиент', { last_contact_at: '2026-11-18T05:00:00Z' })
      await addReminder(db, owner, c, '2026-11-18T06:00:00Z', 'dismissed')
      await addReminder(db, owner, c, '2026-11-17T06:00:00Z', 'done')
      asOwner(db, owner)
      const first = (await (await nba.GET({} as never)).json()) as { action: { key: string } | null }
      expect(first.action?.key).not.toBe('crm_overdue')

      await addReminder(db, owner, c, '2026-11-18T07:00:00Z', 'open')
      const second = (await (await nba.GET({} as never)).json()) as { action: { key: string; count?: number; title: string } | null }
      expect(second.action?.key).toBe('crm_overdue')
      expect(second.action?.title).toBe('Связаться с клиентом из CRM') // one reminder, not three
    }))
})
