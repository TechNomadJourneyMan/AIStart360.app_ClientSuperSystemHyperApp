/**
 * R4 B3 (N4B-3): POST /api/auth/request-invite — «Запросить приглашение».
 * Публичный, без создания аккаунта: заявка в admin_requests (type registration,
 * "userId" NULL, source/payload.kind invite_request), повтор с той же почтой
 * заявку не плодит, Admin / Super Admin узнают сразу — без почты и телефона в
 * тексте (WB-2); ловушка для ботов, частота, режим.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffNotification } from '@/lib/notifications/staff'

const ADMIN = '00000000-0000-4000-8000-0000000000a1'
const SUPER = '00000000-0000-4000-8000-0000000000a2'
const ANALYST = '00000000-0000-4000-8000-0000000000a3'

const s = vi.hoisted(() => ({
  mode: 'invite' as string,
  limited: false,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ patch: Record<string, unknown>; id: unknown }>,
  notices: [] as unknown[],
  notifications: { user_registered: true, invite_requested: true } as Record<string, boolean>,
  createUser: vi.fn(),
  bg: [] as Array<Promise<unknown>>,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitForRequest: async () => (s.limited
    ? { limited: true, reason: 'limited', limit: 5, remaining: 0, retryAfterSeconds: 60, backend: 'memory' }
    : { limited: false, reason: 'ok', limit: 5, remaining: 4, retryAfterSeconds: 0, backend: 'memory' }),
  rateLimitResponse: (_r: unknown, message: string) => new Response(JSON.stringify({ ok: false, error: message }), { status: 429 }),
}))
vi.mock('@/lib/settings/system-settings', () => ({ getRegistrationMode: async () => s.mode }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (k: string) => (k === 'admin_notifications' ? s.notifications : undefined) }))
vi.mock('@/lib/background', () => ({ runInBackground: (_l: string, work: () => Promise<unknown>) => { const p = work(); s.bg.push(p); return p } }))
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: async (n: unknown) => { s.notices.push(n); return {} } }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    auth: { admin: { createUser: s.createUser } },
    from(table: string) {
      const filters: Array<(r: Record<string, unknown>) => boolean> = []
      let patch: Record<string, unknown> | null = null
      const rows = () => (s.tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
      const get = (r: Record<string, unknown>, c: string) => {
        const m = /^payload->>(\w+)$/.exec(c)
        return m ? (r.payload as Record<string, unknown> | undefined)?.[m[1]] : r[c]
      }
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => get(r, c) === v); return q },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(get(r, c))); return q },
        insert: async (row: Record<string, unknown>) => { s.inserts.push(row); (s.tables[table] ??= []).push(row); return { error: null } },
        update: (p: Record<string, unknown>) => { patch = p; return q },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          if (patch) {
            for (const r of rows()) { s.updates.push({ patch: patch!, id: r.id }); Object.assign(r, patch) }
            return Promise.resolve({ error: null }).then(ok)
          }
          return Promise.resolve({ data: rows(), error: null }).then(ok)
        },
      })
      return q
    },
  }),
}))

const { POST } = await import('@/app/api/auth/request-invite/route')

const body = { name: 'Айгуль Серикова', email: 'Aigul@Corp.kz', company: 'ТОО «Ромашка»', contact: '+7 701 111 22 33', consent: true }
const post = async (b: unknown = body) => {
  const res = await POST(new Request('http://localhost/api/auth/request-invite', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
  }))
  // The staff notice runs after the answer (runInBackground) — let it finish.
  await Promise.all(s.bg.splice(0))
  return res
}

beforeEach(() => {
  s.mode = 'invite'
  s.limited = false
  s.inserts = []
  s.updates = []
  s.notices = []
  s.notifications = { user_registered: true, invite_requested: true }
  s.createUser.mockReset()
  s.tables = {
    admin_requests: [],
    profiles: [],
    staff_roles: [{ user_id: ADMIN, role: 'admin' }, { user_id: SUPER, role: 'super_admin' }, { user_id: ANALYST, role: 'analyst' }],
  }
  s.tables.profiles.push({ id: ADMIN, status: 'approved' }, { id: SUPER, status: 'approved' }, { id: ANALYST, status: 'approved' })
})

describe('POST /api/auth/request-invite', () => {
  it('создаёт заявку «регистрация» без пользователя, с пометкой запроса приглашения; аккаунт не создаётся', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true, message: expect.stringContaining('Заявка принята. Команда AIStart360 свяжется с вами.') })
    expect(json.message).not.toMatch(/час|рабоч|день|дня/)
    expect(s.createUser).not.toHaveBeenCalled()
    expect(s.inserts).toHaveLength(1)
    const row = s.inserts[0]
    expect(row).toMatchObject({ type: 'registration', status: 'new', source: 'invite_request' })
    expect(row).not.toHaveProperty('userId')
    expect(row.payload).toMatchObject({
      kind: 'invite_request', email: 'aigul@corp.kz', name: 'Айгуль Серикова', company: 'ТОО «Ромашка»',
      contact: '+7 701 111 22 33', accountExists: false, repeats: 1,
    })
    expect((row.payload as Record<string, unknown>).consentAt).toEqual(expect.any(String))
    expect(row).toHaveProperty('createdAt')
  })

  it('Admin и Super Admin узнают сразу; в тексте нет ни почты, ни телефона (WB-2)', async () => {
    await post()
    expect(s.notices).toHaveLength(1)
    const n = s.notices[0] as StaffNotification
    expect(n.type).toBe('invite_request.new')
    expect(n.audienceUserIds?.sort()).toEqual([ADMIN, SUPER].sort())
    expect(n.quietHoursExempt).toBe(true)
    expect(n.link).toBe('/admin-giga-panel/requests')
    expect(n.dedupeKey).toBe(`invite_request.new:${s.inserts[0].id}`)
    const text = JSON.stringify(n)
    expect(text).toContain('Айгуль Серикова · ТОО «Ромашка»')
    expect(text).not.toContain('aigul@corp.kz')
    expect(text).not.toContain('701')
  })

  it('повтор с той же почтой не плодит заявки и не шлёт второе уведомление', async () => {
    await post()
    const second = await post({ ...body, email: 'aigul@corp.kz', company: 'ТОО «Ромашка-2»' })
    expect(second.status).toBe(200)
    expect(s.inserts).toHaveLength(1)
    expect(s.notices).toHaveLength(1)
    const p = s.tables.admin_requests[0].payload as Record<string, unknown>
    expect(p.repeats).toBe(2)
    // W3A-5: the first request's data stay; the repeat with other data is kept apart.
    expect(p.company).toBe('ТОО «Ромашка»')
    expect(p.otherRequests).toEqual([expect.objectContaining({ company: 'ТОО «Ромашка-2»' })])
    // закрытая заявка не мешает новой
    s.tables.admin_requests[0].status = 'rejected'
    await post()
    expect(s.inserts).toHaveLength(2)
  })

  it('W3A-5: зная чужую почту, нельзя подменить имя, компанию и контакт открытой заявки', async () => {
    await post()
    await post({ name: 'Служба поддержки', email: 'AIGUL@corp.kz ', company: 'Другая компания', contact: '@someone_else', consent: true })
    const p = s.tables.admin_requests[0].payload as Record<string, unknown>
    expect(p).toMatchObject({ name: 'Айгуль Серикова', company: 'ТОО «Ромашка»', contact: '+7 701 111 22 33', repeats: 2 })
    expect(p.otherRequests).toEqual([{ name: 'Служба поддержки', company: 'Другая компания', contact: '@someone_else', at: expect.any(String) }])
    // the same data again — counted, nothing new kept beside
    await post()
    const q = s.tables.admin_requests[0].payload as Record<string, unknown>
    expect(q.repeats).toBe(3)
    expect(q.otherRequests).toHaveLength(1)
    expect(s.notices).toHaveLength(1)
  })

  it('ловушка для ботов: ответ как у человека, ничего не пишется и никого не зовут', async () => {
    const res = await post({ ...body, website: 'http://spam.example' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(s.inserts).toHaveLength(0)
    expect(s.notices).toHaveLength(0)
  })

  it('частота ограничена (429), без согласия и без почты — 400', async () => {
    s.limited = true
    expect((await post()).status).toBe(429)
    s.limited = false
    expect((await post({ ...body, consent: false })).status).toBe(400)
    expect((await post({ ...body, email: 'не почта' })).status).toBe(400)
    expect(s.inserts).toHaveLength(0)
  })

  it('режим не «по приглашению» — 409, заявка не создаётся', async () => {
    s.mode = 'approval'
    const res = await post()
    expect(res.status).toBe(409)
    expect(s.inserts).toHaveLength(0)
  })

  it('аккаунт с этой почтой уже есть — помечено в заявке, ответ тот же', async () => {
    s.tables.profiles.push({ id: 'u-old', email: 'aigul@corp.kz' })
    const res = await post()
    expect((await res.json()).ok).toBe(true)
    expect((s.inserts[0].payload as Record<string, unknown>).accountExists).toBe(true)
  })

  it('тумблер «Запрос приглашения» выключен — заявка есть, уведомления нет', async () => {
    s.notifications = { user_registered: true, invite_requested: false }
    await post()
    expect(s.inserts).toHaveLength(1)
    expect(s.notices).toHaveLength(0)
  })

  it('свой тумблер: «Новая регистрация» выключена — о запросе приглашения всё равно сообщают', async () => {
    s.notifications = { user_registered: false, invite_requested: true }
    await post()
    expect(s.inserts).toHaveLength(1)
    expect(s.notices).toHaveLength(1)
  })
})
