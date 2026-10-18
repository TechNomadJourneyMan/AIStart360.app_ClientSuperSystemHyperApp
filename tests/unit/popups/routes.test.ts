/**
 * GET /api/v1/popups and PATCH /api/v1/popups/:id — the cabinet pop-up layer's
 * data: staff messages of the SESSION user's conversation only, never bot /
 * system / broadcast, nothing while impersonating, state kept in
 * comm_messages.metadata.popup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { commDb, type Row } from '../comm/_db'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  sessionUser: null as null | { id: string },
  impersonating: false,
  settings: {} as Record<string, unknown>,
  db: null as unknown as ReturnType<typeof import('../comm/_db').commDb>,
}))

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => h.db.sb }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: h.sessionUser } }) } }) }))
vi.mock('@/lib/impersonation/server', () => ({ activeImpersonation: vi.fn(async () => (h.impersonating ? { sid: 's' } : null)) }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: vi.fn(async () => false) }))
vi.mock('@/lib/settings/store', () => ({
  getSetting: vi.fn(async (k: string) => (k in h.settings ? h.settings[k] : k === 'pb_popups_enabled' ? true : k === 'pb_popup_cards_per_day' ? 3 : false)),
}))

import { GET } from '@/app/api/v1/popups/route'
import { PATCH } from '@/app/api/v1/popups/[id]/route'

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString()

function req(url: string, method = 'GET', body?: unknown): NextRequest {
  const r = new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as unknown as NextRequest & { nextUrl: URL }
  Object.defineProperty(r, 'nextUrl', { value: new URL(`http://localhost${url}`) })
  return r
}

function msg(id: string, over: Row = {}): Row {
  return {
    id, thread_id: 't-1', group_id: `g-${id}`, direction: 'out', channel: 'app', author_kind: 'staff', author_id: 'staff-1', author_name: 'Анна',
    body: 'Добрый день! Посмотрите цели.', body_masked: null, flags: {}, subject: null, status: 'delivered', created_at: iso(10), metadata: {}, error: null, sent_at: iso(10), ...over,
  }
}

function seed(over: { threads?: Row[]; messages?: Row[] } = {}): void {
  h.db = commDb({
    comm_threads: over.threads ?? [
      { id: 't-1', user_id: USER, status: 'waiting_user', unread_user: 1, blocked_at: null, mode: 'manual' },
      { id: 't-2', user_id: OTHER, status: 'waiting_user', unread_user: 1, blocked_at: null, mode: 'manual' },
    ],
    comm_messages: over.messages ?? [msg('m-staff')],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sessionUser = { id: USER }
  h.impersonating = false
  h.settings = {}
  seed()
})

const popups = async (url = '/api/v1/popups?route=/client/home') => {
  const res = await GET(req(url))
  return { res, body: (await res.json()) as { ok: boolean; data?: { threadId: string | null; popups: Array<Record<string, unknown>> } } }
}

describe('GET /api/v1/popups', () => {
  it('401 without a session', async () => {
    h.sessionUser = null
    const { res } = await popups()
    expect(res.status).toBe(401)
  })

  it('returns [] for a user without a thread', async () => {
    seed({ threads: [], messages: [] })
    const { res, body } = await popups()
    expect(res.status).toBe(200)
    expect(body.data).toEqual({ threadId: null, popups: [] })
    expect(h.db.writes).toEqual([])
  })

  it('returns [] while impersonating, without touching the data', async () => {
    h.impersonating = true
    const { body } = await popups()
    expect(body.data?.popups).toEqual([])
    expect(h.db.writes).toEqual([])
  })

  it('returns [] when the setting pb_popups_enabled is off', async () => {
    h.settings = { pb_popups_enabled: false }
    expect((await popups()).body.data?.popups).toEqual([])
  })

  it('returns a staff message of the user’s thread and never a bot or system message', async () => {
    seed({
      messages: [
        msg('m-staff', { created_at: iso(5) }),
        msg('m-bot', { author_kind: 'bot', author_name: null, created_at: iso(4) }),
        msg('m-sys', { author_kind: 'system', author_name: null, created_at: iso(3) }),
        msg('m-bcast', { author_kind: 'system', campaign_id: 'c-1', created_at: iso(2) }),
        msg('m-mail', { channel: 'email', created_at: iso(1) }),
        msg('m-in', { direction: 'in', author_kind: 'user', created_at: iso(1) }),
      ],
    })
    const { body } = await popups()
    const list = body.data!.popups
    expect(list.map((p) => p.id)).toEqual(['m-staff'])
    expect(list[0]).toMatchObject({ kind: 'expert_message', display: 'card', authorName: 'Анна', important: false, canReply: true, href: '/client/messages' })
    expect(body.data!.threadId).toBe('t-1')
  })

  it('never returns another user’s messages', async () => {
    seed({ messages: [msg('m-other', { thread_id: 't-2' })] })
    expect((await popups()).body.data?.popups).toEqual([])
  })

  it('returns [] when unread_user is 0', async () => {
    seed({ threads: [{ id: 't-1', user_id: USER, status: 'open', unread_user: 0, blocked_at: null, mode: 'manual' }] })
    expect((await popups()).body.data?.popups).toEqual([])
  })

  it('returns [] on a suppressed route', async () => {
    expect((await popups('/api/v1/popups?route=/client/messages')).body.data?.popups).toEqual([])
  })

  it('does not return messages older than the 3 day window or undelivered rows', async () => {
    seed({ messages: [msg('m-old', { created_at: iso(60 * 24 * 4) }), msg('m-failed', { status: 'failed' }), msg('m-ok', { created_at: iso(30) })] })
    expect((await popups()).body.data?.popups.map((p) => p.id)).toEqual(['m-ok'])
  })

  it('important flag makes display modal', async () => {
    seed({ messages: [msg('m-imp', { flags: { important: true }, subject: 'Нужен ответ' })] })
    const [p] = (await popups()).body.data!.popups
    expect(p).toMatchObject({ id: 'm-imp', display: 'modal', important: true, title: 'Нужен ответ', priority: 0 })
  })

  it('a message with flags.important from a bot author is not important', async () => {
    seed({ messages: [msg('m-bot', { author_kind: 'bot', flags: { important: true } }), msg('m-staff', { flags: { important: 'yes' }, created_at: iso(20) })] })
    const list = (await popups()).body.data!.popups
    // the bot message is not a pop-up at all; a non-boolean flag is not «important»
    expect(list.map((p) => [p.id, p.important, p.display])).toEqual([['m-staff', false, 'card']])
  })

  it('a message already seen as a card is not repeated; a spent modal budget downgrades the next important one to a card', async () => {
    seed({
      messages: [
        msg('m-seen', { metadata: { popup: { seenAt: iso(2) } } }),
        msg('m-imp-seen', { flags: { important: true }, metadata: { popup: { seenAt: iso(5) } }, created_at: iso(30) }),
      ],
    })
    const list = (await popups()).body.data!.popups
    expect(list.map((p) => [p.id, p.display])).toEqual([['m-imp-seen', 'card']])
  })

  it('stays silent (500, no throw) when the database fails', async () => {
    h.db.sb.from = (() => { throw new Error('db down') }) as never
    const { res } = await popups()
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/v1/popups/:id', () => {
  const patch = (id: string, body: unknown) => PATCH(req(`/api/v1/popups/${id}`, 'PATCH', body), { params: { id } })
  const stored = (id: string) => (h.db.db.comm_messages.find((r) => r.id === id)!.metadata as { popup?: Record<string, string> }).popup

  it('401 without a session', async () => {
    h.sessionUser = null
    expect((await patch('m-staff', { action: 'dismiss' })).status).toBe(401)
  })

  it('dismiss writes metadata.popup.dismissedAt and the message is no longer returned', async () => {
    const res = await patch('m-staff', { action: 'dismiss' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(stored('m-staff')?.dismissedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect((await popups()).body.data?.popups).toEqual([])
    expect(h.db.writes.filter((w) => w.op === 'update')).toHaveLength(1)
  })

  it('seen writes seenAt once and keeps the other metadata', async () => {
    seed({ messages: [msg('m-staff', { metadata: { keep: 1 } })] })
    await patch('m-staff', { action: 'seen' })
    const first = stored('m-staff')!.seenAt
    expect(first).toBeTruthy()
    expect((h.db.db.comm_messages[0].metadata as Record<string, unknown>).keep).toBe(1)
    await patch('m-staff', { action: 'seen' })
    expect(stored('m-staff')!.seenAt).toBe(first)
  })

  it('acted marks the message dismissed', async () => {
    await patch('m-staff', { action: 'acted' })
    expect(stored('m-staff')?.dismissedAt).toBeTruthy()
  })

  it('on a message of another thread → 404 and no write', async () => {
    seed({ messages: [msg('m-other', { thread_id: 't-2' })] })
    const res = await patch('m-other', { action: 'dismiss' })
    expect(res.status).toBe(404)
    expect(h.db.writes.filter((w) => w.op === 'update')).toEqual([])
  })

  it('on a bot or incoming message → 404 and no write', async () => {
    seed({ messages: [msg('m-bot', { author_kind: 'bot' }), msg('m-in', { direction: 'in', author_kind: 'user' })] })
    expect((await patch('m-bot', { action: 'dismiss' })).status).toBe(404)
    expect((await patch('m-in', { action: 'dismiss' })).status).toBe(404)
    expect(h.db.writes.filter((w) => w.op === 'update')).toEqual([])
  })

  it('snooze with days 7 sets snoozedUntil', async () => {
    const before = Date.now()
    const res = await patch('m-staff', { action: 'snooze', days: 7 })
    expect(res.status).toBe(200)
    const until = new Date(stored('m-staff')!.snoozedUntil).getTime()
    expect(until - before).toBeGreaterThanOrEqual(7 * 86_400_000 - 5000)
    expect(until - before).toBeLessThanOrEqual(7 * 86_400_000 + 5000)
    expect((await popups()).body.data?.popups).toEqual([])
  })

  it('rejects days outside 3|7|30 with 400', async () => {
    expect((await patch('m-staff', { action: 'snooze', days: 5 })).status).toBe(400)
    expect((await patch('m-staff', { action: 'snooze' })).status).toBe(400)
    expect((await patch('m-staff', { action: 'explode' })).status).toBe(400)
    expect(h.db.writes.filter((w) => w.op === 'update')).toEqual([])
  })

  it('is refused while impersonating (403)', async () => {
    h.impersonating = true
    expect((await patch('m-staff', { action: 'dismiss' })).status).toBe(403)
    expect(h.db.writes.filter((w) => w.op === 'update')).toEqual([])
  })
})
