/**
 * tests/unit/api/telegram-webhook.test.ts — the client bot (/api/telegram/webhook):
 *   R-139  fail closed like the staff bots: without TELEGRAM_WEBHOOK_SECRET nothing is processed
 *          (503), a wrong / missing X-Telegram-Bot-Api-Secret-Token is 401;
 *          /start <code> binds only a code that has not expired (15 minutes,
 *          profiles.telegram_link_code_expires_at) and only once;
 *          POST /api/v1/settings/telegram issues a 128-bit code that expires in 15 minutes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = { id: string; telegram_link_code: string | null; telegram_link_code_expires_at: string | null; telegram_chat_id: string | null }

const tg = vi.hoisted(() => ({ send: vi.fn() as (chatId: string, html: string) => Promise<boolean> }))
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  updateCalls: [] as Array<{ patch: Record<string, unknown>; filters: Array<[string, string, unknown]> }>,
  selects: 0,
  sessionUser: { id: 'user-1' } as { id: string } | null,
}))

vi.mock('@/lib/telegram', async (orig) => ({
  ...(await orig<typeof import('@/lib/telegram')>()),
  sendTelegramMessage: (chatId: string, html: string) => tg.send(chatId, html),
}))
vi.mock('@/lib/telegram/staff-updates', () => ({
  firstSeenUpdate: vi.fn(async () => true), forgetUpdate: vi.fn(async () => {}),
  handleApprovalCallback: vi.fn(), handleStaffStart: vi.fn(async () => false),
}))
vi.mock('@/lib/comm/inbound', () => ({ handleTelegramInbound: vi.fn(async () => true) }))
vi.mock('@/lib/omnichannel/telegram-client-bot', () => ({ forwardUnlinkedClientBotUpdate: vi.fn(async () => 'forwarded') }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: vi.fn(async () => false) }))
vi.mock('@/lib/impersonation/guard', () => ({ refuseDuringImpersonation: vi.fn(async () => null) }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: db.sessionUser } }) } }),
}))

/** A tiny PostgREST stand-in for profiles: eq / gt filters, select, update. */
function matches(row: Row, filters: Array<[string, string, unknown]>): boolean {
  return filters.every(([op, col, val]) => {
    const v = (row as Record<string, unknown>)[col]
    if (op === 'eq') return v === val
    if (op === 'gt') return typeof v === 'string' && typeof val === 'string' && new Date(v).getTime() > new Date(val).getTime()
    return false
  })
}
function query(filters: Array<[string, string, unknown]>, run: (f: typeof filters) => Promise<unknown>) {
  const q = {
    eq: (col: string, val: unknown) => query([...filters, ['eq', col, val]], run),
    gt: (col: string, val: unknown) => query([...filters, ['gt', col, val]], run),
    limit: () => run(filters),
    select: () => run(filters),
    maybeSingle: () => run(filters),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run(filters).then(res, rej),
  }
  return q
}
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => query([], async (f) => { db.selects++; return { data: db.rows.filter((r) => matches(r, f)).map((r) => ({ id: r.id })), error: null } }),
      update: (patch: Record<string, unknown>) => query([], async (f) => {
        db.updateCalls.push({ patch, filters: f })
        const hit = db.rows.filter((r) => matches(r, f))
        for (const r of hit) Object.assign(r, patch)
        return { data: hit.map((r) => ({ id: r.id })), error: null }
      }),
    }),
  }),
}))

import { POST } from '@/app/api/telegram/webhook/route'
import * as settings from '@/app/api/v1/settings/telegram/route'
import type { NextRequest } from 'next/server'

const SECRET = 'a'.repeat(40)
function req(body: unknown, headers: Record<string, string> = { 'x-telegram-bot-api-secret-token': SECRET }): NextRequest {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const start = (code: string, chat = 42) => ({ update_id: Math.floor(Math.random() * 1e9), message: { chat: { id: chat }, text: `/start ${code}` } })

describe('/api/telegram/webhook (client bot)', () => {
  beforeEach(() => {
    vi.mocked(tg.send).mockReset()
    vi.mocked(tg.send).mockResolvedValue(true)
    db.rows = [{ id: 'user-1', telegram_link_code: 'c0de', telegram_link_code_expires_at: inMinutes(10), telegram_chat_id: null }]
    db.updateCalls = []
    db.selects = 0
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET
  })

  it('fails closed (503) without a configured secret: nothing is read, written or sent', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    const res = await POST(req(start('c0de'), {}))
    expect(res.status).toBe(503)
    expect(db.selects).toBe(0)
    expect(db.updateCalls).toHaveLength(0)
    expect(tg.send).not.toHaveBeenCalled()
  })

  it('rejects with 401 a wrong, a shorter or a missing secret header', async () => {
    for (const headers of [{ 'x-telegram-bot-api-secret-token': 'nope' }, { 'x-telegram-bot-api-secret-token': SECRET.slice(1) }, {}] as Array<Record<string, string>>) {
      const res = await POST(req(start('c0de'), headers))
      expect(res.status).toBe(401)
    }
    expect(db.updateCalls).toHaveLength(0)
  })

  it('binds telegram_chat_id for a live code and clears the code and its expiry', async () => {
    const res = await POST(req(start('c0de')))
    expect(res.status).toBe(200)
    expect(db.updateCalls[0]?.patch).toEqual({ telegram_chat_id: '42', telegram_link_code: null, telegram_link_code_expires_at: null })
    expect(db.rows[0]).toMatchObject({ telegram_chat_id: '42', telegram_link_code: null })
    expect(tg.send).toHaveBeenCalledWith('42', expect.stringContaining('Готово'))
  })

  it('an expired code — or one issued before the expiry existed — binds nothing', async () => {
    db.rows[0].telegram_link_code_expires_at = inMinutes(-1)
    await POST(req(start('c0de')))
    db.rows[0].telegram_link_code_expires_at = null
    await POST(req(start('c0de')))
    expect(db.rows[0].telegram_chat_id).toBeNull()
    expect(db.updateCalls).toHaveLength(0)
    expect(tg.send).toHaveBeenLastCalledWith('42', expect.stringContaining('не найден'))
  })

  it('a code is used once: the bind is conditional on the code still being there', async () => {
    await POST(req(start('c0de', 1)))
    await POST(req(start('c0de', 2)))
    expect(db.rows[0].telegram_chat_id).toBe('1')
    expect(db.updateCalls[0].filters).toEqual(expect.arrayContaining([['eq', 'id', 'user-1'], ['eq', 'telegram_link_code', 'c0de']]))
  })

  it('does not bind on an unknown code but replies politely', async () => {
    const res = await POST(req(start('zzz')))
    expect(res.status).toBe(200)
    expect(db.updateCalls).toHaveLength(0)
    expect(tg.send).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/v1/settings/telegram — the link code', () => {
  beforeEach(() => {
    db.rows = [{ id: 'user-1', telegram_link_code: null, telegram_link_code_expires_at: null, telegram_chat_id: null }]
    db.updateCalls = []
    db.sessionUser = { id: 'user-1' }
    process.env.TELEGRAM_BOT_TOKEN = '123456:x'
    process.env.TELEGRAM_BOT_USERNAME = 'client_bot'
  })

  it('issues a 128-bit code that expires in 15 minutes, for the session user only', async () => {
    const before = Date.now()
    const res = await settings.POST()
    const body = await res.json()
    expect(res.status).toBe(200)
    const patch = db.updateCalls[0].patch as { telegram_link_code: string; telegram_link_code_expires_at: string }
    expect(patch.telegram_link_code).toMatch(/^[0-9a-f]{32}$/)
    const ttl = new Date(patch.telegram_link_code_expires_at).getTime() - before
    expect(ttl).toBeGreaterThan(14 * 60_000)
    expect(ttl).toBeLessThanOrEqual(15 * 60_000 + 5_000)
    expect(db.updateCalls[0].filters).toEqual([['eq', 'id', 'user-1']])
    expect(body.url).toBe(`https://t.me/client_bot?start=${patch.telegram_link_code}`)
    expect(body.expiresAt).toBe(patch.telegram_link_code_expires_at)
  })

  it('unlink clears the code and its expiry too', async () => {
    await settings.DELETE()
    expect(db.updateCalls[0].patch).toEqual({ telegram_chat_id: null, telegram_link_code: null, telegram_link_code_expires_at: null })
  })
})
