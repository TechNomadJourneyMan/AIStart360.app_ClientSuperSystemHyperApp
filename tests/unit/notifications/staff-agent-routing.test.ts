/**
 * notifyStaff routing of agent notifications (lib/notifications/staff.ts):
 * audience narrowed to a permission (agents.view), the person's own level and
 * mute, CRITICAL through a mute, the notification's own buttons for the
 * admin bot, a scheduled digest past thresholds and quiet hours (not past a
 * mute), and the dedupe key. The database is an in-memory fake of the three
 * tables notifyStaff touches; Telegram is a recording fetch.
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
const { lifecycleNotification } = await import('@/lib/agents/lifecycle')

const ENV = ['TELEGRAM_ADMIN_BOT_TOKEN', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'TELEGRAM_CALLBACK_SECRET', 'NOTIFY_QUIET_HOURS', 'NOTIFY_TELEGRAM_MIN_LEVEL',
  'TELEGRAM_ADMIN_CHAT_IDS', 'TELEGRAM_CHAT_ID', 'ADMIN_NOTIFICATION_EMAIL', 'ADMIN_EMAIL', 'AUTH_URL', 'NOTIFY_TIMEZONE']
const saved: Record<string, string | undefined> = {}
const TASK = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'

const link = (n: number, role: string, minLevel = 'INFO', mutedUntil: Date | null = null): LinkRow => ({
  user_id: `u${n}`, chat_id: String(100 + n), min_level: minLevel, muted_until: mutedUntil,
  profile_role: role === 'super_admin' ? 'super_admin' : 'admin', staff_role: role === 'super_admin' ? null : role,
})
const sentTo = (r: { deliveries: Array<{ channel: string; target: string; status: string; reason?: string }> }) =>
  r.deliveries.filter((d) => d.status === 'sent').map((d) => d.target).sort()
const reasonOf = (r: { deliveries: Array<{ target: string; status: string; reason?: string }> }, target: string) =>
  r.deliveries.find((d) => d.target === target)?.reason

const base = { taskId: TASK, agentKey: 'data_collection', agentName: 'Сбор данных', companyId: 'co', companyName: 'Ромашка', attempt: 1, maxAttempts: 3 }

describe('agent notifications through notifyStaff', () => {
  beforeAll(() => {
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'admin-token'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    process.env.NOTIFY_QUIET_HOURS = ''
    process.env.AUTH_URL = 'https://portal.test'
  })
  afterAll(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })
  beforeEach(() => {
    db.events.clear()
    db.deliveries.clear()
    delete process.env.NOTIFY_TELEGRAM_MIN_LEVEL
    delete process.env.NOTIFY_QUIET_HOURS
    process.env.NOTIFY_QUIET_HOURS = ''
  })

  it('reaches only staff with agents.view, at or above their own level', async () => {
    process.env.NOTIFY_TELEGRAM_MIN_LEVEL = 'INFO'
    db.staff = [link(1, 'super_admin'), link(2, 'analyst', 'WARNING'), link(3, 'support'), link(4, 'content_manager'), link(5, 'crm_manager', 'INFO')]
    const tg = recordingFetch()
    const started = await notifyStaff(lifecycleNotification({ ...base, kind: 'started' }), { fetchImpl: tg.fetchImpl })
    // support / content_manager have no agents.view: not even a delivery row.
    expect(started.deliveries.map((d) => d.target).sort()).toEqual(['101', '102', '105'])
    expect(sentTo(started)).toEqual(['101', '105'])
    expect(reasonOf(started, '102')).toBe('below_personal_level')
    expect(tg.calls[0].url).toContain('/botadmin-token/sendMessage')

    const dead = await notifyStaff(lifecycleNotification({ ...base, kind: 'dead', attempt: 3 }), { fetchImpl: tg.fetchImpl })
    expect(sentTo(dead)).toEqual(['101', '102', '105'])
    const buttons = (tg.calls[tg.calls.length - 1].body.reply_markup.inline_keyboard as Array<Array<{ text: string; url?: string }>>).flat()
    expect(buttons.map((b) => b.text)).toEqual(['🔎 Открыть', '🔁 Повторить'])
  })

  it('INFO stays in the feed under the default platform threshold (WARNING)', async () => {
    db.staff = [link(1, 'super_admin', 'INFO')]
    const tg = recordingFetch()
    const r = await notifyStaff(lifecycleNotification({ ...base, kind: 'succeeded' }), { fetchImpl: tg.fetchImpl })
    expect(r.eventId).toBeTruthy()
    expect(reasonOf(r, '101')).toBe('below_platform_level')
    expect(tg.calls).toHaveLength(0)
  })

  it('a mute holds back WARNING but not CRITICAL', async () => {
    const until = new Date(Date.now() + 3_600_000)
    db.staff = [link(1, 'admin', 'INFO', until)]
    const tg = recordingFetch()
    const warn = await notifyStaff(lifecycleNotification({ ...base, kind: 'retrying' }), { fetchImpl: tg.fetchImpl })
    expect(reasonOf(warn, '101')).toBe('muted')
    const crit = await notifyStaff(lifecycleNotification({ ...base, kind: 'stuck', leaseExpired: true }), { fetchImpl: tg.fetchImpl })
    expect(sentTo(crit)).toEqual(['101'])
  })

  it('is idempotent per dedupe key: a repeat notifies nobody', async () => {
    db.staff = [link(1, 'admin')]
    const tg = recordingFetch()
    const first = await notifyStaff(lifecycleNotification({ ...base, kind: 'dead' }), { fetchImpl: tg.fetchImpl })
    const again = await notifyStaff(lifecycleNotification({ ...base, kind: 'dead' }), { fetchImpl: tg.fetchImpl })
    expect(sentTo(first)).toEqual(['101'])
    expect(again).toMatchObject({ duplicate: true, deliveries: [] })
    expect(tg.calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1)
  })

  it('a scheduled digest passes the platform level, personal level and quiet hours — not a mute', async () => {
    process.env.NOTIFY_QUIET_HOURS = '9-11'
    const now = new Date('2026-10-08T05:00:00Z') // 10:00 in Almaty: quiet hours
    db.staff = [link(1, 'admin', 'CRITICAL'), link(2, 'analyst', 'WARNING', new Date('2026-10-08T06:00:00Z')), link(3, 'support')]
    const tg = recordingFetch()
    const r = await notifyStaff({
      level: 'INFO', type: 'agent.digest', title: 'Сводка', lines: ['x'], dedupeKey: 'agent:digest:2026-10-08',
      audiencePermission: 'agents.view', scheduled: true,
    }, { fetchImpl: tg.fetchImpl, now })
    expect(sentTo(r)).toEqual(['101'])
    expect(reasonOf(r, '102')).toBe('muted')
    expect(r.deliveries.some((d) => d.target === '103')).toBe(false)

    process.env.NOTIFY_TELEGRAM_MIN_LEVEL = 'INFO'
    db.staff = [link(1, 'admin', 'INFO')]
    const plain = await notifyStaff({ level: 'INFO', type: 'test.info', title: 'x', dedupeKey: 'plain' }, { fetchImpl: tg.fetchImpl, now })
    expect(reasonOf(plain, '101')).toBe('quiet_hours')
  })
})
