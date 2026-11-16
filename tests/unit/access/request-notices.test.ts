/**
 * R4 (N4B-1, решение PO 2026-11-16): заявка на оплату доходит до тех, кто её
 * разбирает — Admin и Super Admin (лента персонала + Telegram, если привязан):
 *   • новая заявка и новый раздел к открытой заявке → ОДНО уведомление каждое,
 *     повтор того же раздела ничего не шлёт;
 *   • тумблер «Заявка на оплату» (admin_notifications.access_requested) — по
 *     умолчанию включён, выключенный глушит уведомления;
 *   • срок ответа 4 ч: просроченная открытая заявка → одно напоминание, повтор
 *     прохода крона ничего не повторяет; ночью проход ждёт утра.
 * Ничего реального не уходит: notifyStaff подменён (его дедупликация по ключу —
 * как у настоящего: второй вызов с тем же ключом — duplicate).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeService, newRequestsDb, type FakeRequestsDb } from './fake-admin-requests'

const s = vi.hoisted(() => ({
  db: null as unknown as FakeRequestsDb,
  notices: [] as Array<Record<string, unknown>>,
  toggles: {} as Record<string, boolean>,
  slaHours: 4,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: '44444444-4444-4444-8444-444444444444' } } }) } }),
}))
vi.mock('@/lib/supabase-service', async () => {
  const { fakeService: make } = await import('./fake-admin-requests')
  return { createServiceClient: () => make(s.db), requireServiceRoleKey: () => 'service' }
})
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ limited: false, reason: 'ok', limit: 5, remaining: 5, retryAfterSeconds: 0, backend: 'memory' }),
  rateLimitResponse: () => new Response('{"ok":false}', { status: 429 }),
}))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: async () => null }))
vi.mock('@/lib/settings/store', () => ({
  getSetting: async (key: string) => {
    if (key === 'request_sla_hours') return s.slaHours
    if (key === 'admin_notifications') return { user_registered: true, ...s.toggles }
    throw new Error('unexpected setting ' + key)
  },
}))
vi.mock('@/lib/notifications/staff', () => ({
  notifyStaff: async (n: Record<string, unknown>) => {
    const key = n.dedupeKey as string
    const events = (s.db.extra!.notification_events ??= [])
    if (events.some((e) => e.dedupe_key === key)) return { eventId: 'e', duplicate: true, deliveries: [] }
    events.push({ dedupe_key: key })
    s.notices.push(n)
    return { eventId: `e${s.notices.length}`, duplicate: false, deliveries: [] }
  },
}))

const lib = await import('@/lib/access/upgrade-requests')
const notices = await import('@/lib/access/request-notices')
const route = await import('@/app/api/v1/upgrade-request/route')
const cron = await import('@/app/api/cron/access-requests/route')

const ME = '44444444-4444-4444-8444-444444444444'
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const SUPER = 'aaaaaaaa-0000-4000-8000-000000000002'
const SEXPERT = 'aaaaaaaa-0000-4000-8000-000000000003'
const ADMIN_BLOCKED = 'aaaaaaaa-0000-4000-8000-000000000004'

// 11:00 Алматы — рабочее время (тихие часы уведомлений по умолчанию 23–8).
const DAY = new Date('2026-11-16T06:00:00Z')
// 01:00 Алматы — тихие часы.
const NIGHT = new Date('2026-11-16T20:00:00Z')
const hoursBefore = (at: Date, h: number) => new Date(at.getTime() - h * 3_600_000).toISOString().replace('Z', '')

/** The staff notice runs in the background after the row is stored. */
const settle = () => new Promise((r) => setTimeout(r, 30))

beforeEach(() => {
  s.notices = []
  s.toggles = {}
  s.slaHours = 4
  s.db = newRequestsDb()
  s.db.profiles.push(
    { id: ME, full_name: 'Иван Петров', email: 'ivan@corp.kz', role: 'client' },
    { id: ADMIN, status: 'approved' },
    { id: SUPER, status: 'approved' },
    { id: SEXPERT, status: 'approved' },
    { id: ADMIN_BLOCKED, status: 'blocked' },
  )
  s.db.companies.push({ user_id: ME, name: 'ТОО Ромашка' })
  s.db.extra = {
    staff_roles: [
      { user_id: ADMIN, role: 'admin' },
      { user_id: SUPER, role: 'super_admin' },
      { user_id: SEXPERT, role: 'super_expert' },
      { user_id: ADMIN_BLOCKED, role: 'admin' },
    ],
    notification_events: [],
  }
})

describe('N4B-1: a request for paid access reaches Admin / Super Admin at once', () => {
  it('a new request → ONE notice: feed + Telegram of the approved Admin / Super Admin, the 4 h deadline, a link to «Заявки»', async () => {
    const r = await lib.submitAccessRequest(fakeService(s.db) as never, { userId: ME, featureKey: 'point_a' })
    await settle()
    expect(s.notices).toHaveLength(1)
    const n = s.notices[0]
    expect(n).toMatchObject({
      level: 'WARNING',
      type: 'access_request.new',
      dedupeKey: `access_request.new:${r.id}`,
      link: '/admin-giga-panel/requests',
      entityType: 'admin_request',
      entityId: r.id,
      skipCooldown: true,
    })
    // Who decides: approved Admin and Super Admin; not the SuperExpert, not a blocked admin.
    expect(new Set(n.audienceUserIds as string[])).toEqual(new Set([ADMIN, SUPER]))
    expect(String(n.title)).toContain('Иван Петров · ТОО Ромашка')
    const text = (n.lines as string[]).join('\n')
    expect(text).toContain('Разделы: Точка А')
    expect(text).toContain('срок 4 ч')
    expect(text).toContain('Назначить Pro')
  })

  it('review WB-2: no client e-mail in the text — the GIGA feed is open to every staff role (analyst, content manager)', async () => {
    const r = await lib.submitAccessRequest(fakeService(s.db) as never, { userId: ME, featureKey: 'point_a' })
    await lib.submitAccessRequest(fakeService(s.db) as never, { userId: ME, featureKey: 'market' })
    await settle()
    expect(s.notices).toHaveLength(2)
    for (const n of s.notices) {
      expect(JSON.stringify([n.title, n.lines])).not.toContain('ivan@corp.kz')
      expect((n.lines as string[])[0]).toBe('Клиент: Иван Петров · ТОО Ромашка')
    }
    expect(s.notices[0].entityId).toBe(r.id)
  })

  it('review WB-1: the notice about a request is delivered «at once» — also in the quiet hours (the overdue reminder still waits for the morning)', async () => {
    await lib.submitAccessRequest(fakeService(s.db) as never, { userId: ME, featureKey: 'point_a' })
    await lib.submitAccessRequest(fakeService(s.db) as never, { userId: ME, featureKey: 'market' })
    await settle()
    expect(s.notices.map((n) => n.quietHoursExempt)).toEqual([true, true])
    const person = { name: 'Иван', email: 'ivan@corp.kz', company: null }
    const reminder = notices.overdueNotice({ id: 'x', userId: ME, person, features: ['point_a'], createdAt: hoursBefore(DAY, 5) + 'Z' }, { slaHours: 4, now: DAY, audience: [ADMIN] })
    expect(reminder.quietHoursExempt).toBeUndefined()
  })

  it('review WB-6: staff and experts do not leave a request for paid access (403, nothing stored, nobody notified)', async () => {
    const post = () => route.POST(new NextRequest('http://x/api/v1/upgrade-request', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ featureKey: 'point_a' }),
    }))
    // A staff member with a client profile (staff_roles row) …
    s.db.extra!.staff_roles.push({ user_id: ME, role: 'support' })
    const staff = await post()
    expect(staff.status).toBe(403)
    expect(await staff.json()).toMatchObject({ error: 'not_client' })
    // … and an expert.
    s.db.extra!.staff_roles = s.db.extra!.staff_roles.filter((r) => r.user_id !== ME)
    s.db.profiles[0].role = 'expert'
    expect((await post()).status).toBe(403)
    await settle()
    expect(s.db.rows).toHaveLength(0)
    expect(s.notices).toHaveLength(0)
    // A client — as before.
    s.db.profiles[0].role = 'client'
    expect((await post()).status).toBe(200)
    await settle() // its background notice belongs to this test
    expect(s.notices).toHaveLength(1)
  })

  it('the same section again (a second click, the other paywall) sends NOTHING more', async () => {
    const svc = fakeService(s.db) as never
    await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'point_a' })
    await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'point_a' })
    await lib.submitAccessRequest(svc, { userId: ME, featureKey: '/point-a' })
    await settle()
    expect(s.notices).toHaveLength(1)
  })

  it('«Добавить раздел к заявке» → one more notice about that section, once', async () => {
    const svc = fakeService(s.db) as never
    const first = await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'point_a' })
    const added = await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'market' })
    expect(added).toMatchObject({ created: false, added: 'market' })
    await lib.submitAccessRequest(svc, { userId: ME, featureKey: 'market' })
    await settle()
    expect(s.notices.map((n) => n.dedupeKey)).toEqual([`access_request.new:${first.id}`, `access_request.added:${first.id}:market`])
    expect(s.notices[1]).toMatchObject({ type: 'access_request.added' })
    expect(String(s.notices[1].title)).toContain('Рынок')
    expect((s.notices[1].lines as string[]).join('\n')).toContain('Разделы: Точка А, Рынок')
  })

  it('the notice is idempotent by its key: a repeated call for the same request records nothing new', async () => {
    const info = { requestId: 'req-x', userId: ME, person: { name: 'Иван', email: 'ivan@corp.kz', company: null }, features: ['point_a'], added: null, createdAt: null }
    expect(await notices.notifyStaffAccessRequested(fakeService(s.db) as never, info, DAY)).toBe('sent')
    await notices.notifyStaffAccessRequested(fakeService(s.db) as never, info, DAY)
    expect(s.notices).toHaveLength(1)
  })

  it('the GIGA switch «Заявка на оплату» off → no notice (the request is still stored)', async () => {
    s.toggles = { access_requested: false }
    const r = await lib.submitAccessRequest(fakeService(s.db) as never, { userId: ME, featureKey: 'point_b' })
    await settle()
    expect(r.created).toBe(true)
    expect(s.notices).toHaveLength(0)
  })

  it('the switch exists in «Уведомления администраторам» and is ON by default (also for a stored value without it)', async () => {
    const { NOTIFICATION_TYPES, coerceSetting } = await import('@/lib/settings/registry')
    expect(NOTIFICATION_TYPES).toHaveProperty('access_requested')
    expect(coerceSetting('admin_notifications', { user_registered: false }).access_requested).toBe(true)
  })

  it('POST /api/v1/upgrade-request (the paywall button) tells staff; a repeat does not', async () => {
    const post = () => route.POST(new NextRequest('http://x/api/v1/upgrade-request', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ featureKey: 'gri_full' }),
    }))
    expect((await post()).status).toBe(200)
    expect((await post()).status).toBe(200)
    await settle()
    expect(s.notices).toHaveLength(1)
    expect((s.notices[0].lines as string[]).join('\n')).toContain('Полный GRI')
  })

  it('review WB-7: without any approved Admin / Super Admin — the GIGA feed only (audience []), never every linked staff member or the env chats; a failed read → the same', async () => {
    s.db.extra!.staff_roles = []
    const info = { requestId: 'req-y', userId: ME, person: { name: 'Иван', email: 'ivan@corp.kz', company: null }, features: ['point_a'], added: null, createdAt: null }
    await notices.notifyStaffAccessRequested(fakeService(s.db) as never, info, DAY)
    expect(s.notices[0].audienceUserIds).toEqual([])
    const broken = { from: (t: string) => (t === 'staff_roles' ? { select: () => ({ in: async () => ({ data: null, error: { message: 'down' } }) }) } : fakeService(s.db).from(t)) }
    await notices.notifyStaffAccessRequested(broken as never, { ...info, requestId: 'req-z' }, DAY)
    expect(s.notices[1].audienceUserIds).toEqual([])
  })
})

describe('N4B-1: the 4 h answer deadline and ONE reminder when it passes', () => {
  const open = (id: string, createdAt: string, status = 'new') => ({
    id, type: 'access', status, source: 'paywall', createdAt,
    payload: { userId: ME, name: 'Иван Петров', email: 'ivan@corp.kz', company: 'ТОО Ромашка', features: ['point_a'] },
  })

  it('requestSlaDueAt reads the Prisma timestamp without a zone as UTC', () => {
    expect(notices.requestSlaDueAt('2026-11-14T09:00:00', 4)).toBe('2026-11-14T13:00:00.000Z')
    expect(notices.requestSlaDueAt(null, 4)).toBeNull()
  })

  it('an open request older than 4 h → one reminder to Admin / Super Admin; a younger or a closed one → none', async () => {
    s.db.rows.push(open('old', hoursBefore(DAY, 5)), open('young', hoursBefore(DAY, 2)), open('done', hoursBefore(DAY, 50), 'approved'))
    const report = await notices.escalateOverdueAccessRequests(fakeService(s.db) as never, DAY)
    expect(report).toEqual({ open: 2, overdue: 1, notified: 1 })
    expect(s.notices).toHaveLength(1)
    expect(s.notices[0]).toMatchObject({ type: 'access_request.overdue', dedupeKey: 'access_request.overdue:old', level: 'WARNING' })
    expect(new Set(s.notices[0].audienceUserIds as string[])).toEqual(new Set([ADMIN, SUPER]))
    expect(String(s.notices[0].title)).toContain('дольше 4 ч')
    expect((s.notices[0].lines as string[]).join('\n')).toContain('ждёт 5 часов')
  })

  it('the next passes of the cron repeat nothing; a request that becomes overdue later gets its own one', async () => {
    s.db.rows.push(open('old', hoursBefore(DAY, 5)), open('young', hoursBefore(DAY, 2)))
    await notices.escalateOverdueAccessRequests(fakeService(s.db) as never, DAY)
    const again = await notices.escalateOverdueAccessRequests(fakeService(s.db) as never, DAY)
    expect(again.notified).toBe(0)
    const later = new Date(DAY.getTime() + 3 * 3_600_000)
    const third = await notices.escalateOverdueAccessRequests(fakeService(s.db) as never, later)
    expect(third).toMatchObject({ overdue: 2, notified: 1 })
    expect(s.notices.map((n) => n.dedupeKey)).toEqual(['access_request.overdue:old', 'access_request.overdue:young'])
  })

  it('review WB-8: a run killed after the feed row → the next passes (within an hour) call notifyStaff with the same key again; later they leave it', async () => {
    s.db.rows.push(open('old', hoursBefore(DAY, 5)))
    const calls: string[] = []
    let crash = true
    const send = async (n: { dedupeKey?: string | null }) => {
      calls.push(String(n.dedupeKey))
      // The event row is written, then the process dies before Telegram.
      if (crash) {
        s.db.extra!.notification_events.push({ dedupe_key: n.dedupeKey, created_at: DAY.toISOString() })
        crash = false
        throw new Error('killed')
      }
      return { duplicate: true }
    }
    expect(await notices.escalateOverdueAccessRequests(fakeService(s.db) as never, DAY, { notifyStaff: send })).toMatchObject({ notified: 0 })
    const later = new Date(DAY.getTime() + 15 * 60_000)
    await notices.escalateOverdueAccessRequests(fakeService(s.db) as never, later, { notifyStaff: send })
    expect(calls).toEqual(['access_request.overdue:old', 'access_request.overdue:old'])
    const muchLater = new Date(DAY.getTime() + 2 * 3_600_000)
    await notices.escalateOverdueAccessRequests(fakeService(s.db) as never, muchLater, { notifyStaff: send })
    expect(calls).toHaveLength(2)
  })

  it('at night (quiet hours) the reminder waits for the morning instead of being swallowed', async () => {
    s.db.rows.push(open('old', hoursBefore(NIGHT, 6)))
    expect(await notices.escalateOverdueAccessRequests(fakeService(s.db) as never, NIGHT)).toMatchObject({ overdue: 1, notified: 0, skipped: 'quiet_hours' })
    expect(s.notices).toHaveLength(0)
    const morning = new Date('2026-11-17T03:30:00Z') // 08:30 Алматы
    expect(await notices.escalateOverdueAccessRequests(fakeService(s.db) as never, morning)).toMatchObject({ notified: 1 })
  })

  it('the switch off → no reminder; the setting request_sla_hours moves the deadline', async () => {
    s.db.rows.push(open('old', hoursBefore(DAY, 5)))
    s.toggles = { access_requested: false }
    expect(await notices.escalateOverdueAccessRequests(fakeService(s.db) as never, DAY)).toMatchObject({ overdue: 1, notified: 0, skipped: 'disabled' })
    s.toggles = {}
    s.slaHours = 8
    expect(await notices.escalateOverdueAccessRequests(fakeService(s.db) as never, DAY)).toMatchObject({ overdue: 0, notified: 0 })
  })

  it('GET /api/cron/access-requests: CRON_SECRET only; runs the pass', async () => {
    const saved = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'cron-secret-for-tests'
    try {
      const call = (auth?: string) => cron.GET(new NextRequest('http://localhost/api/cron/access-requests', { headers: auth ? { authorization: auth } : {} }))
      expect((await call()).status).toBe(401)
      expect((await call('Bearer wrong')).status).toBe(401)
      s.db.rows.push(open('old', hoursBefore(new Date(), 30)))
      const res = await call('Bearer cron-secret-for-tests')
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, open: 1, overdue: 1 })
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = saved
    }
  })
})
