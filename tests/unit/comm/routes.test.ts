/**
 * GIGA «Сообщения» routes (/api/giga-admin/comm/*) and the cabinet API
 * (/api/v1/comm/*): permissions (inbox.view reads, inbox.manage writes),
 * client scope («только назначенные»), profanity refusal, block, the masked
 * feed + audited original, and the client API working on the session user only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { commDb, type Row } from './_db'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const STAFF = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  actor: null as null | { id: string; kind: string; role?: StaffRole; clientScope?: 'all' | 'assigned' },
  sessionUser: null as null | { id: string },
  impersonating: false,
  db: null as unknown as ReturnType<typeof import('./_db').commDb>,
  audit: vi.fn(async (..._a: unknown[]) => true),
  sendToUser: vi.fn(async (..._a: unknown[]) => ({ ok: true, threadId: 't-1', groupId: 'g-1', messages: [{ id: 'm', channel: 'app', status: 'delivered', error: null }] })),
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => h.actor),
    staffRoleOfUser: vi.fn(async (id: string) => ({ staffRole: id === STAFF ? 'crm_manager' : null, profileRole: 'client', status: 'approved', email: null })),
  }
})
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => h.db.sb }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: h.sessionUser } }) } }) }))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: vi.fn(async () => (h.impersonating ? { sid: 's' } : null)) }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: h.audit }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: vi.fn(async () => false) }))
vi.mock('@/lib/settings/store', () => ({ getSetting: vi.fn(async (k: string) => (k === 'comm_escalation_minutes' ? 30 : false)) }))
vi.mock('@/lib/notifications/staff', () => ({ notifyStaff: vi.fn(async () => ({ eventId: null, duplicate: false, deliveries: [] })) }))
vi.mock('@/lib/comm/send', async (orig) => ({ ...(await orig<typeof import('@/lib/comm/send')>()), sendToUser: h.sendToUser }))

import { GET as threadsGET } from '@/app/api/giga-admin/comm/threads/route'
import { GET as userGET, PATCH as userPATCH } from '@/app/api/giga-admin/comm/users/[userId]/route'
import { POST as messagesPOST } from '@/app/api/giga-admin/comm/users/[userId]/messages/route'
import { GET as originalGET } from '@/app/api/giga-admin/comm/messages/[messageId]/original/route'
import { GET as clientThreadGET } from '@/app/api/v1/comm/thread/route'
import { POST as clientMessagesPOST } from '@/app/api/v1/comm/messages/route'

function req(url: string, method = 'GET', body?: unknown): NextRequest {
  const r = new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as unknown as NextRequest & { nextUrl: URL }
  Object.defineProperty(r, 'nextUrl', { value: new URL(`http://localhost${url}`) })
  return r
}
const P = { params: { userId: USER } }

function seed(): void {
  h.db = commDb({
    profiles: [
      { id: USER, full_name: 'Иван', email: 'ivan@example.com', phone: '+77011234567', telegram_chat_id: null, preferences: null },
      { id: OTHER, full_name: 'Пётр', email: 'petr@example.com', phone: null, telegram_chat_id: null, preferences: null },
    ],
    comm_threads: [
      { id: 't-1', user_id: USER, company_id: null, assignee_id: null, status: 'waiting_staff', mode: 'manual', unread_staff: 1, unread_user: 2, profanity_count: 1, blocked_at: null, whatsapp_opt_out_at: null, last_message_at: '2026-10-16T09:00:00.000Z', last_inbound_at: '2026-10-16T09:00:00.000Z', last_outbound_at: null, staff_reply_due_at: '2026-10-16T09:30:00.000Z' },
      { id: 't-2', user_id: OTHER, company_id: null, assignee_id: null, status: 'open', mode: 'manual', unread_staff: 0, unread_user: 0, profanity_count: 0, blocked_at: null, whatsapp_opt_out_at: null },
    ] as Row[],
    comm_messages: [
      { id: 'msg-1', thread_id: 't-1', group_id: 'g1', direction: 'in', channel: 'telegram', author_kind: 'user', author_id: USER, body: 'где отчёт блядь', body_masked: 'где отчёт б****', flags: { profanity: true, words: 1 }, status: 'delivered', created_at: '2026-10-16T09:00:00.000Z', metadata: { chatId: '555' }, error: null },
      { id: 'msg-2', thread_id: 't-2', group_id: 'g2', direction: 'out', channel: 'app', author_kind: 'staff', author_id: STAFF, author_name: 'Анна', body: 'Чужое сообщение', body_masked: null, flags: {}, status: 'delivered', created_at: '2026-10-16T09:00:00.000Z', metadata: {}, error: null },
    ],
    user_assignments: [{ user_id: USER, assignee_id: STAFF }],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  seed()
  h.actor = { id: STAFF, kind: 'session', role: 'admin', clientScope: 'all' }
  h.sessionUser = null
  h.impersonating = false
})

describe('GIGA permissions', () => {
  it('a role without inbox.view (analyst) gets 403 everywhere', async () => {
    h.actor = { id: STAFF, kind: 'session', role: 'analyst' }
    expect((await threadsGET(req('/api/giga-admin/comm/threads'))).status).toBe(403)
    expect((await userGET(req(`/api/giga-admin/comm/users/${USER}`), P)).status).toBe(403)
    expect((await originalGET(req('/api/giga-admin/comm/messages/x/original'), { params: { messageId: '44444444-4444-4444-8444-444444444444' } })).status).toBe(403)
  })

  it('inbox.view without inbox.manage (support): reads and marks read, but cannot send, assign, close or block', async () => {
    h.actor = { id: STAFF, kind: 'session', role: 'support' }
    expect((await threadsGET(req('/api/giga-admin/comm/threads'))).status).toBe(200)
    const view = await userGET(req(`/api/giga-admin/comm/users/${USER}`), P)
    expect(view.status).toBe(200)
    expect((await view.json()).data.can.manage).toBe(false)
    expect((await userPATCH(req(`/api/giga-admin/comm/users/${USER}`, 'PATCH', { action: 'read' }), P)).status).toBe(200)
    expect(h.db.db.comm_threads[0].unread_staff).toBe(0)
    for (const body of [{ action: 'assign', assigneeId: STAFF }, { action: 'close' }, { action: 'block' }, { action: 'mode', mode: 'auto' }]) {
      expect((await userPATCH(req(`/api/giga-admin/comm/users/${USER}`, 'PATCH', body), P)).status, body.action).toBe(403)
    }
    expect((await messagesPOST(req(`/api/giga-admin/comm/users/${USER}/messages`, 'POST', { body: 'Привет', channels: ['app'] }), P)).status).toBe(403)
    expect(h.sendToUser).not.toHaveBeenCalled()
  })

  it('client scope: an expert limited to assigned clients cannot open or write to someone else\'s conversation', async () => {
    h.actor = { id: STAFF, kind: 'session', role: 'super_expert', clientScope: 'assigned' }
    expect((await userGET(req(`/api/giga-admin/comm/users/${OTHER}`), { params: { userId: OTHER } })).status).toBe(403)
    expect((await userGET(req(`/api/giga-admin/comm/users/${USER}`), P)).status).toBe(200)
    h.actor = { id: '55555555-5555-4555-8555-555555555555', kind: 'session', role: 'super_expert', clientScope: 'assigned' }
    const res = await messagesPOST(req(`/api/giga-admin/comm/users/${USER}/messages`, 'POST', { body: 'Привет', channels: ['app'] }), P)
    expect(res.status).toBe(403)
    expect((await threadsGET(req('/api/giga-admin/comm/threads'))).status).toBe(200)
  })

  it('a bad user id is 400', async () => {
    expect((await userGET(req('/api/giga-admin/comm/users/nope'), { params: { userId: 'nope' } })).status).toBe(400)
  })
})

describe('GIGA writes', () => {
  it('send: identity from the session actor, audited; profanity refused with the field named', async () => {
    const ok = await messagesPOST(req(`/api/giga-admin/comm/users/${USER}/messages`, 'POST', { body: 'Добрый день', channels: ['app', 'email'] }), P)
    expect(ok.status).toBe(200)
    expect(h.sendToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, authorKind: 'staff', authorId: STAFF, channels: ['app', 'email'] }), expect.anything())
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ id: STAFF }), expect.objectContaining({ action: 'comm.message.sent', targetUserId: USER }), expect.anything())

    h.sendToUser.mockClear()
    const dirty = await messagesPOST(req(`/api/giga-admin/comm/users/${USER}/messages`, 'POST', { body: 'ну блядь', channels: ['app'] }), P)
    expect(dirty.status).toBe(400)
    expect(await dirty.json()).toMatchObject({ ok: false, field: 'body', error: expect.stringMatching(/нецензурн/) })
    const dirtySubject = await messagesPOST(req(`/api/giga-admin/comm/users/${USER}/messages`, 'POST', { body: 'ок', subject: 'хуй', channels: ['email'] }), P)
    expect((await dirtySubject.json()).field).toBe('subject')
    expect(h.sendToUser).not.toHaveBeenCalled()
  })

  it('block / unblock is stored on the thread and audited', async () => {
    const res = await userPATCH(req(`/api/giga-admin/comm/users/${USER}`, 'PATCH', { action: 'block', reason: 'оскорбления' }), P)
    expect(res.status).toBe(200)
    expect(h.db.db.comm_threads[0]).toMatchObject({ blocked_by: STAFF, block_reason: 'оскорбления' })
    expect(h.db.db.comm_threads[0].blocked_at).toBeTruthy()
    expect(h.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'comm.thread.block', entityId: 't-1' }), expect.anything())
    await userPATCH(req(`/api/giga-admin/comm/users/${USER}`, 'PATCH', { action: 'unblock' }), P)
    expect(h.db.db.comm_threads[0].blocked_at).toBeNull()
  })

  it('assign accepts only staff who see the inbox', async () => {
    expect((await userPATCH(req(`/api/giga-admin/comm/users/${USER}`, 'PATCH', { action: 'assign', assigneeId: OTHER }), P)).status).toBe(400)
    expect((await userPATCH(req(`/api/giga-admin/comm/users/${USER}`, 'PATCH', { action: 'assign', assigneeId: STAFF }), P)).status).toBe(200)
    expect(h.db.db.comm_threads[0].assignee_id).toBe(STAFF)
  })

  it('the feed is masked for staff; the original is a separate audited read', async () => {
    const view = await (await userGET(req(`/api/giga-admin/comm/users/${USER}`), P)).json()
    expect(view.data.messages[0]).toMatchObject({ body: 'где отчёт б****', masked: true, profanity: true })
    expect(view.data.thread).toMatchObject({ profanityCount: 1 })
    h.actor = { id: STAFF, kind: 'session', role: 'support' }
    const orig = await originalGET(req('/api/giga-admin/comm/messages/msg-1/original'), { params: { messageId: '44444444-4444-4444-8444-444444444444' } })
    expect(orig.status).toBe(404)
    h.db.db.comm_messages[0].id = '44444444-4444-4444-8444-444444444444'
    const ok = await originalGET(req('/api/giga-admin/comm/messages/x/original'), { params: { messageId: '44444444-4444-4444-8444-444444444444' } })
    expect((await ok.json()).data.body).toBe('где отчёт блядь')
    expect(h.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'comm.message.original_viewed' }), expect.anything())
  })
})

describe('cabinet API (/api/v1/comm/*) — session user only', () => {
  it('401 without a session', async () => {
    expect((await clientThreadGET()).status).toBe(401)
    expect((await clientMessagesPOST(req('/api/v1/comm/messages', 'POST', { body: 'x' }))).status).toBe(401)
  })

  it('GET returns only the session user\'s thread, his own text as written, and clears his unread counter', async () => {
    h.sessionUser = { id: USER }
    const body = await (await clientThreadGET()).json()
    expect(body.data.messages).toHaveLength(1)
    expect(body.data.messages[0]).toMatchObject({ direction: 'in', body: 'где отчёт блядь' })
    expect(JSON.stringify(body)).not.toContain('Чужое сообщение')
    expect(JSON.stringify(body)).not.toContain('chatId')
    expect(h.db.db.comm_threads[0].unread_user).toBe(0)
  })

  it('POST writes into the session user\'s thread whatever id the body carries', async () => {
    h.sessionUser = { id: OTHER }
    const res = await clientMessagesPOST(req('/api/v1/comm/messages', 'POST', { body: 'Вопрос по GRI', userId: USER, threadId: 't-1' }))
    expect(res.status).toBe(200)
    const created = h.db.db.comm_messages.find((m) => m.body === 'Вопрос по GRI')!
    expect(created).toMatchObject({ thread_id: 't-2', direction: 'in', channel: 'app', author_id: OTHER })
    expect(h.db.db.comm_threads[1].status).toBe('waiting_staff')
  })

  it('an admin driving the cabinet «от имени» cannot write as the user; empty text is 400', async () => {
    h.sessionUser = { id: USER }
    expect((await clientMessagesPOST(req('/api/v1/comm/messages', 'POST', { body: '   ' }))).status).toBe(400)
    h.impersonating = true
    expect((await clientMessagesPOST(req('/api/v1/comm/messages', 'POST', { body: 'x' }))).status).toBe(403)
  })
})
