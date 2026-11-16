/**
 * R4 B3 (N4B-3): «Запрос приглашения» в ГИГА «Заявки» → «Регистрация».
 *   • список: карточка видна (аккаунта нет — "userId" NULL), почта и контакт
 *     только с users.sensitive;
 *   • «Отправить приглашение» — существующий поток lib/admin/invites.ts
 *     (право users.invite, запись user.invited), заявка закрывается, повтор — 409,
 *     письмо не ушло — заявка снова открыта;
 *   • «Принять» запрос приглашения не закрывает (409), «Отклонить» / «Архив» —
 *     только заявка, без писем и без профилей;
 *   • бейдж «Заявки» считает и запросы приглашения;
 *   • карточка: «Запрос приглашения», контакт, «Отправить приглашение» вместо «Принять».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StaffRole } from '@/lib/admin/rbac'

type Row = Record<string, unknown>
const ME = '00000000-0000-4000-8000-0000000000aa'

const s = vi.hoisted(() => ({
  role: 'admin' as string,
  tables: {} as Record<string, Row[]>,
  invites: [] as Array<Record<string, unknown>>,
  inviteOutcome: 'invited' as 'invited' | 'relinked' | 'failed',
  audit: [] as Array<{ action: string; entityId?: string | null; metadata?: Record<string, unknown> }>,
  approvals: 0,
}))

vi.mock('@/lib/admin/giga-actor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/giga-actor')>()
  const { makeRequireGiga } = await import('../_giga-guard')
  const inner = makeRequireGiga(() => ({ id: '00000000-0000-4000-8000-0000000000aa', kind: 'session', role: s.role as StaffRole, email: 'admin@aistart360.app' }))
  return {
    ...actual,
    requireGiga: async (req: unknown, p: Parameters<typeof inner>[1]) => {
      const g = await inner(req, p)
      return g.actor ? { actor: { ...g.actor, clientScope: 'all' } } : g
    },
  }
})
vi.mock('@/lib/admin/actor-scope', () => ({ actorClientScope: async () => ({ scope: 'all', clientIds: [] }) }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (k: string) => (k === 'request_sla_hours' ? 4 : undefined) }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, entry: { action: string; entityId?: string | null; metadata?: Record<string, unknown> }) => { s.audit.push(entry); return true },
}))
vi.mock('@/lib/audit', () => ({ logAudit: async (e: { action: string; entityId?: string }) => { s.audit.push({ action: e.action, entityId: e.entityId }) } }))
vi.mock('@/lib/users/approval', () => ({ applyApprovalDecision: async () => { s.approvals++; return { affected: 1, profile: null, emailSent: true } } }))
vi.mock('@/lib/admin/invites', () => ({
  sendPlatformInvite: async (input: Record<string, unknown>) => {
    s.invites.push(input)
    return s.inviteOutcome === 'failed'
      ? { email: input.email, outcome: 'failed', message: 'Письмо не отправилось' }
      : { email: input.email, outcome: s.inviteOutcome, message: s.inviteOutcome === 'relinked' ? 'Аккаунт уже был' : 'Приглашение отправлено' }
  },
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let patch: Row | null = null
      let wantRows = false
      const rows = () => (s.tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
      const q: Row = {}
      Object.assign(q, {
        select: () => { wantRows = true; return q },
        order: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q },
        is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q },
        update: (p: Row) => { patch = p; wantRows = false; return q },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          // GET step 1 orders by a column the Prisma table does not have — like PostgREST, refuse.
          if (patch) {
            const hit = rows()
            for (const r of hit) Object.assign(r, patch)
            return Promise.resolve({ data: wantRows ? hit.map((r) => ({ id: r.id })) : null, error: null }).then(ok)
          }
          return Promise.resolve({ data: rows(), error: null }).then(ok)
        },
      })
      const sel = q.select as () => Row
      q.select = (cols?: string) => {
        wantRows = true
        if (table === 'admin_requests' && cols === '*') {
          // select('*').order('created_at') — "created_at" does not exist on admin_requests (Prisma "createdAt").
          const bad: Row = {}
          Object.assign(bad, { order: () => bad, then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'column admin_requests.created_at does not exist' } }).then(ok) })
          return bad
        }
        return sel()
      }
      return q
    },
  }),
}))

const { GET: list } = await import('@/app/api/giga-admin/requests/route')
const { POST: sendInvite } = await import('@/app/api/giga-admin/requests/[id]/invite/route')
const { PATCH: decide } = await import('@/app/api/giga-admin/requests/[id]/route')
const { GET: badges } = await import('@/app/api/giga-admin/nav-badges/route')
const { workBadgeView } = await import('@/lib/admin/nav')

const REQ = 'b0b0b0b0-0000-4000-8000-000000000001'
const inviteRow = (over: Row = {}): Row => ({
  id: REQ, type: 'registration', source: 'invite_request', status: 'new', priority: 'medium',
  createdAt: '2026-11-16T10:00:00', rejectionReason: null,
  payload: {
    kind: 'invite_request', email: 'aigul@corp.kz', name: 'Айгуль Серикова', company: 'ТОО «Ромашка»',
    contact: '+7 701 111 22 33', accountExists: false, repeats: 2, subject: 'Запрос приглашения: Айгуль Серикова · ТОО «Ромашка»',
    description: 'Просит приглашение на платформу',
  },
  ...over,
})

beforeEach(() => {
  s.role = 'admin'
  s.invites = []
  s.audit = []
  s.approvals = 0
  s.inviteOutcome = 'invited'
  s.tables = {
    admin_requests: [inviteRow()],
    profiles: [{ id: ME, status: 'approved', role: 'client' }],
    staff_roles: [{ user_id: ME, role: 'admin' }],
    expert_sla_tasks: [],
  }
})

const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init as never)

describe('GET /api/giga-admin/requests — запрос приглашения в списке', () => {
  it('виден во вкладке «Регистрация» с данными; почта и контакт — для ролей с users.sensitive', async () => {
    const body = await (await list(req('/api/giga-admin/requests'))).json()
    const r = body.requests.find((x: Row) => x.id === REQ)
    expect(r).toMatchObject({
      category: 'registration', source: 'invite_request', status: 'pending', userName: 'Айгуль Серикова',
      userEmail: 'aigul@corp.kz', company: 'ТОО «Ромашка»', contact: '+7 701 111 22 33', accountExists: false, repeats: 2, userId: null,
    })
    expect(r.createdAt).toBe('2026-11-16T10:00:00.000Z')
  })

  it('аналитик (без users.sensitive): почта замаскирована, контакт скрыт', async () => {
    s.role = 'analyst'
    const body = await (await list(req('/api/giga-admin/requests'))).json()
    const r = body.requests.find((x: Row) => x.id === REQ)
    expect(r.userEmail).not.toBe('aigul@corp.kz')
    expect(r.contact).toBe('скрыт')
  })
})

describe('POST /api/giga-admin/requests/:id/invite — «Отправить приглашение»', () => {
  const post = () => sendInvite(req(`/api/giga-admin/requests/${REQ}/invite`, { method: 'POST' }), { params: { id: REQ } })

  it('шлёт приглашение существующим потоком на почту из заявки, закрывает заявку, пишет user.invited', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, outcome: 'invited' })
    expect(s.invites).toEqual([expect.objectContaining({ email: 'aigul@corp.kz', name: 'Айгуль Серикова', company: 'ТОО «Ромашка»', invitedById: ME })])
    expect(s.tables.admin_requests[0].status).toBe('approved')
    expect(s.audit).toContainEqual(expect.objectContaining({ action: 'user.invited', entityId: 'aigul@corp.kz', metadata: expect.objectContaining({ fromRequest: REQ }) }))
  })

  it('повтор (заявка уже закрыта) — 409, второго письма нет', async () => {
    await post()
    const res = await post()
    expect(res.status).toBe(409)
    expect(s.invites).toHaveLength(1)
  })

  it('письмо не ушло — 502, заявка снова открыта', async () => {
    s.inviteOutcome = 'failed'
    const res = await post()
    expect(res.status).toBe(502)
    expect(s.tables.admin_requests[0].status).toBe('new')
  })

  it('без права «Приглашения на платформу» — 403; не запрос приглашения — 404', async () => {
    s.role = 'analyst'
    expect((await post()).status).toBe(403)
    s.role = 'admin'
    s.tables.admin_requests = [inviteRow({ source: 'client_portal' })]
    expect((await post()).status).toBe(404)
    expect(s.invites).toHaveLength(0)
  })
})

describe('PATCH /api/giga-admin/requests/:id — решение по запросу приглашения', () => {
  const patch = (action: string, reason?: string) =>
    decide(req(`/api/giga-admin/requests/${REQ}`, { method: 'PATCH', body: JSON.stringify({ action, reason }) }), { params: { id: REQ } })

  it('«Принять» не закрывает (нужно «Отправить приглашение»)', async () => {
    const res = await patch('approve')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('Отправить приглашение')
    expect(s.tables.admin_requests[0].status).toBe('new')
    expect(s.approvals).toBe(0)
  })

  it('«Отклонить» с причиной и «Архив» меняют только заявку — ни профилей, ни писем', async () => {
    let res = await patch('reject', 'Не наш профиль')
    expect(res.status).toBe(200)
    expect(s.tables.admin_requests[0]).toMatchObject({ status: 'rejected', rejectionReason: 'Не наш профиль' })
    expect(s.approvals).toBe(0)
    res = await patch('archive')
    expect(res.status).toBe(409) // уже решена
    s.tables.admin_requests = [inviteRow()]
    res = await patch('archive')
    expect(res.status).toBe(200)
    expect(s.tables.admin_requests[0].status).toBe('archived')
  })
})

describe('бейдж «Заявки» считает запросы приглашения', () => {
  it('nav-badges отдаёт inviteRequests; бейдж — сумма с заявками на оплату', async () => {
    s.tables.admin_requests.push(inviteRow({ id: 'r-closed', status: 'approved' }))
    s.tables.admin_requests.push({ id: 'p1', type: 'access', source: 'paywall', status: 'new', createdAt: new Date().toISOString().replace('Z', ''), payload: { userId: 'u' } })
    const body = await (await badges(req('/api/giga-admin/nav-badges'))).json()
    expect(body.inviteRequests).toEqual({ open: 1 })
    expect(body.accessRequests).toMatchObject({ open: 1 })
    const view = workBadgeView('accessRequests', body)
    expect(view).toMatchObject({ count: 2, urgent: false })
    expect(view?.title).toContain('Запросы приглашения: 1')
    expect(workBadgeView('accessRequests', { inviteRequests: { open: 3 } })).toMatchObject({ count: 3 })
    expect(workBadgeView('accessRequests', { inviteRequests: { open: 0 } })).toBeNull()
  })
})

describe('карточка «Запрос приглашения»', () => {
  const base = {
    id: REQ, category: 'registration' as const, source: 'invite_request', status: 'pending' as const, userName: 'Айгуль Серикова',
    userEmail: 'aigul@corp.kz', subject: 'Запрос приглашения: Айгуль Серикова', description: '…', createdAt: new Date().toISOString(),
    company: 'ТОО «Ромашка»', contact: '+7 701 111 22 33', repeats: 2, userId: null,
  }
  const noop = () => {}

  it('метка, контакт, «Отправить приглашение» вместо «Принять»', async () => {
    const { RequestCard } = await import('@/components/giga-panel/RequestsModule')
    const out = renderToStaticMarkup(React.createElement(RequestCard, { request: base, onApprove: noop, onReject: noop, onArchive: noop, onSendInvite: noop, canInvite: true }))
    expect(out).toContain('Запрос приглашения')
    expect(out).toContain('+7 701 111 22 33')
    expect(out).toContain('Запросов с этой почты: 2')
    expect(out).toContain('data-action="send-invite"')
    expect(out).toContain('Отправить приглашение')
    expect(out).not.toContain('Принять')
    expect(out).not.toContain('data-invite-blocked')
  })

  it('без права — кнопка неактивна, причина написана', async () => {
    const { RequestCard } = await import('@/components/giga-panel/RequestsModule')
    const out = renderToStaticMarkup(React.createElement(RequestCard, { request: base, onApprove: noop, onReject: noop, onArchive: noop, onSendInvite: noop, canInvite: false }))
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*data-action="send-invite"|<button[^>]*data-action="send-invite"[^>]*disabled=""/)
    expect(out).toContain('data-invite-blocked')
  })

  it('обычная регистрация — как раньше («Принять», без метки)', async () => {
    const { RequestCard } = await import('@/components/giga-panel/RequestsModule')
    const out = renderToStaticMarkup(React.createElement(RequestCard, { request: { ...base, source: 'client_portal', contact: null }, onApprove: noop, onReject: noop, onArchive: noop }))
    expect(out).toContain('Принять')
    expect(out).not.toContain('data-action="send-invite"')
    expect(out).not.toContain('data-invite-request')
  })

  it('диалог честно говорит, что будет: ссылка час, новый аккаунт ждёт одобрения', async () => {
    const m = await import('@/components/giga-panel/invite-request-model')
    expect(m.sendInviteDialogText({ accountExists: false }).join(' ')).toContain('действует один час')
    expect(m.sendInviteDialogText({ accountExists: false }).join(' ')).toContain('ждёт одобрения')
    expect(m.sendInviteDialogText({ accountExists: true })[0]).toContain('ссылкой для входа')
  })
})
