/**
 * notifyStaff audience extensions used by lib/comm (new inbound message):
 *   audienceUserIds  only these staff (the conversation's assignee); legacy
 *                    env chats are skipped — they cannot be attributed;
 *   skipCooldown     the per-(type, company) cooldown does not apply (lib/comm
 *                    already notifies once per unanswered conversation).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingFetch } from '../telegram/_bot-harness'

interface LinkRow { user_id: string; chat_id: string; min_level: string; muted_until: Date | null; profile_role: string | null; staff_role: string | null }

const db = vi.hoisted(() => ({
  staff: [] as LinkRow[],
  events: new Map<string, { id: string; created_at: Date }>(),
  deliveries: new Map<string, string>(),
  cooldownHits: 0,
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
      if (sql.includes('count(*) AS n FROM public.notification_deliveries')) return [{ n: BigInt(db.cooldownHits) }]
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

const ENV = ['TELEGRAM_ADMIN_BOT_TOKEN', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'NOTIFY_QUIET_HOURS', 'NOTIFY_TELEGRAM_MIN_LEVEL',
  'TELEGRAM_ADMIN_CHAT_IDS', 'TELEGRAM_CHAT_ID', 'ADMIN_NOTIFICATION_EMAIL', 'ADMIN_EMAIL', 'AUTH_URL']
const saved: Record<string, string | undefined> = {}
const link = (n: number, role: string): LinkRow => ({
  user_id: `u${n}`, chat_id: String(100 + n), min_level: 'INFO', muted_until: null,
  profile_role: role === 'super_admin' ? 'super_admin' : 'admin', staff_role: role === 'super_admin' ? null : role,
})
const sentTo = (r: { deliveries: Array<{ target: string; status: string }> }) => r.deliveries.filter((d) => d.status === 'sent').map((d) => d.target).sort()

const inbound = (over: Record<string, unknown> = {}) => ({
  level: 'WARNING' as const, type: 'comm.inbound', title: 'Новое сообщение: Иван', lines: ['Канал: Telegram'],
  link: '/admin-giga-panel/messages?user=x', dedupeKey: `comm.inbound:${Math.random()}`, ...over,
})

describe('notifyStaff — audienceUserIds / skipCooldown', () => {
  beforeAll(() => {
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'admin-token'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    process.env.AUTH_URL = 'https://portal.test'
  })
  afterAll(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })
  beforeEach(() => {
    db.events.clear()
    db.deliveries.clear()
    db.cooldownHits = 0
    process.env.NOTIFY_QUIET_HOURS = ''
    db.staff = [link(1, 'super_admin'), link(2, 'crm_manager'), link(3, 'support'), link(4, 'super_expert')]
  })

  it('without an assignee: everyone whose role has inbox.manage', async () => {
    const tg = recordingFetch()
    const r = await notifyStaff(inbound({ audiencePermission: 'inbox.manage' }), { fetchImpl: tg.fetchImpl })
    expect(sentTo(r)).toEqual(['101', '102'])
  })

  it('with an assignee: only him (even a role that only views the inbox); legacy env chats are skipped', async () => {
    process.env.TELEGRAM_ADMIN_CHAT_IDS = '999'
    const tg = recordingFetch()
    const r = await notifyStaff(inbound({ audienceUserIds: ['u4'], audiencePermission: 'inbox.view' }), { fetchImpl: tg.fetchImpl })
    expect(sentTo(r)).toEqual(['104'])
    expect(r.deliveries.some((d) => d.target === '999')).toBe(false)
    delete process.env.TELEGRAM_ADMIN_CHAT_IDS
  })

  it('cooldown applies by default and is bypassed with skipCooldown', async () => {
    db.cooldownHits = 1
    const tg = recordingFetch()
    const cooled = await notifyStaff(inbound({ audiencePermission: 'inbox.manage' }), { fetchImpl: tg.fetchImpl })
    expect(sentTo(cooled)).toEqual([])
    const r = await notifyStaff(inbound({ audiencePermission: 'inbox.manage', skipCooldown: true }), { fetchImpl: tg.fetchImpl })
    expect(sentTo(r)).toEqual(['101', '102'])
  })
})
