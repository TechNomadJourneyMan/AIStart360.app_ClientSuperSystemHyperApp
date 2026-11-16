/**
 * R4 ревью WB-1 (решение PO: «уведомление сразу»): заявка на оплату, оставленная в
 * тихие часы (23–08 Алматы), доходит до Admin / Super Admin в Telegram СРАЗУ, а не
 * только через 4 часа напоминанием. Флаг quietHoursExempt снимает только тихие часы:
 * «без звука» сотрудника действует, остальные уведомления ночью по-прежнему молчат.
 * Prisma подменена, Telegram — записывающий fetch.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingFetch } from '../telegram/_bot-harness'

interface LinkRow { user_id: string; chat_id: string; min_level: string; muted_until: Date | null; profile_role: string | null; staff_role: string | null }

const db = vi.hoisted(() => ({
  staff: [] as LinkRow[],
  events: new Map<string, { id: string; created_at: Date }>(),
  deliveries: new Map<string, string>(),
  seq: 0,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (sql.includes('INSERT INTO public.notification_events')) {
        const key = values[10] as string | null
        if (key && db.events.has(key)) return []
        const row = { id: `00000000-0000-4000-8000-${String(++db.seq).padStart(12, '0')}`, created_at: new Date() }
        if (key) db.events.set(key, row)
        return [row]
      }
      if (sql.includes('FROM public.notification_events WHERE dedupe_key')) {
        const row = db.events.get(values[0] as string)
        return row ? [row] : []
      }
      if (sql.includes('FROM public.staff_telegram_links l')) return db.staff
      if (sql.includes('INSERT INTO public.notification_deliveries')) {
        const k = `${values[0]}|${values[1]}|${values[2]}`
        if (db.deliveries.has(k)) return []
        db.deliveries.set(k, 'queued')
        return [{ id: k }]
      }
      if (sql.includes('count(*) AS n FROM public.notification_deliveries')) return [{ n: BigInt(0) }]
      return []
    }),
    $executeRaw: vi.fn(async (_s: TemplateStringsArray, ...values: unknown[]) => {
      db.deliveries.set(`${values[0]}|${values[1]}|${values[2]}`, String(values[3]))
      return 1
    }),
  },
}))
vi.mock('@/lib/whatsapp/config', () => ({ whatsappTransportAvailable: () => false }))

const { notifyStaff } = await import('@/lib/notifications/staff')
const { accessRequestNotice } = await import('@/lib/access/request-notices')

const ENV = ['TELEGRAM_ADMIN_BOT_TOKEN', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'NOTIFY_QUIET_HOURS', 'NOTIFY_TIMEZONE', 'NOTIFY_TELEGRAM_MIN_LEVEL',
  'TELEGRAM_ADMIN_CHAT_IDS', 'TELEGRAM_CHAT_ID', 'ADMIN_NOTIFICATION_EMAIL', 'ADMIN_EMAIL', 'AUTH_URL']
const saved: Record<string, string | undefined> = {}
const admin = (n: number, over: Partial<LinkRow> = {}): LinkRow => ({
  user_id: `u${n}`, chat_id: String(100 + n), min_level: 'INFO', muted_until: null, profile_role: 'admin', staff_role: 'admin', ...over,
})
const sentTo = (r: { deliveries: Array<{ target: string; status: string }> }) => r.deliveries.filter((d) => d.status === 'sent').map((d) => d.target).sort()
const skipped = (r: { deliveries: Array<{ target: string; status: string; reason?: string }> }) => r.deliveries.filter((d) => d.status === 'skipped').map((d) => d.reason)

// 07:30 Алматы — ещё тихие часы (до 08:00); 03:00 Алматы — глубокая ночь.
const EARLY = new Date('2026-11-16T02:30:00Z')
const NIGHT = new Date('2026-11-15T22:00:00Z')

const request = (id: string, now: Date) => accessRequestNotice(
  { requestId: id, userId: 'client-1', person: { name: 'Иван Петров', email: 'ivan@corp.kz', company: 'ТОО Ромашка' }, features: ['point_a'], added: null, createdAt: null },
  { slaHours: 4, now, audience: ['u1', 'u2'] },
)

describe('WB-1: a request for paid access reaches Telegram at once, also in the quiet hours', () => {
  beforeAll(() => {
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'admin-token'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    process.env.AUTH_URL = 'https://portal.test'
    process.env.NOTIFY_QUIET_HOURS = '23-8'
  })
  afterAll(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })
  beforeEach(() => {
    db.events.clear()
    db.deliveries.clear()
    db.staff = [admin(1), admin(2, { staff_role: 'super_admin', profile_role: 'super_admin' }), admin(3, { staff_role: 'support', profile_role: 'support' })]
  })

  for (const [label, at] of [['07:30 Алматы', EARLY], ['03:00 Алматы', NIGHT]] as const) {
    it(`${label}: Admin and Super Admin get the Telegram message now (not «skipped: quiet_hours»); support does not`, async () => {
      const tg = recordingFetch()
      const r = await notifyStaff(request(`req-${label}`, at), { fetchImpl: tg.fetchImpl, now: at })
      expect(sentTo(r)).toEqual(['101', '102'])
      expect(skipped(r)).not.toContain('quiet_hours')
      expect(tg.texts()[0]).toContain('Новая заявка на оплату: Иван Петров · ТОО Ромашка')
      expect(tg.texts()[0]).not.toContain('ivan@corp.kz')
    })
  }

  it('a personal mute still holds it; other WARNING events still wait out the quiet hours', async () => {
    db.staff = [admin(1, { muted_until: new Date(EARLY.getTime() + 3_600_000) }), admin(2)]
    const tg = recordingFetch()
    const r = await notifyStaff(request('req-muted', EARLY), { fetchImpl: tg.fetchImpl, now: EARLY })
    expect(sentTo(r)).toEqual(['102'])
    expect(skipped(r)).toEqual(['muted'])
    db.staff = [admin(1), admin(2)]
    const other = await notifyStaff({ level: 'WARNING', type: 'comm.inbound', title: 'Новое сообщение', dedupeKey: 'comm.inbound:x', skipCooldown: true }, { fetchImpl: tg.fetchImpl, now: EARLY })
    expect(sentTo(other)).toEqual([])
    expect(skipped(other)).toEqual(['quiet_hours', 'quiet_hours'])
  })
})
