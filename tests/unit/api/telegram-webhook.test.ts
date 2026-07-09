/**
 * tests/unit/api/telegram-webhook.test.ts — привязка чата по /start <code> +
 * защита секретом (Фаза 4A).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const tg = vi.hoisted(() => ({ send: vi.fn() as (chatId: string, html: string) => Promise<boolean> }))
const db = vi.hoisted(() => ({
  selectResult: { data: [] as Array<{ id: string }> },
  updateError: null as unknown,
  updateCalls: [] as Array<{ patch: Record<string, unknown>; val: unknown }>,
}))

vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: (chatId: string, html: string) => tg.send(chatId, html),
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ limit: () => Promise.resolve(db.selectResult) }) }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, val: unknown) => {
          db.updateCalls.push({ patch, val })
          return Promise.resolve({ error: db.updateError })
        },
      }),
    }),
  }),
}))

import { POST } from '@/app/api/telegram/webhook/route'
import type { NextRequest } from 'next/server'

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

describe('/api/telegram/webhook', () => {
  beforeEach(() => {
    vi.mocked(tg.send).mockReset()
    vi.mocked(tg.send).mockResolvedValue(true)
    db.selectResult = { data: [] }
    db.updateError = null
    db.updateCalls = []
    delete process.env.TELEGRAM_WEBHOOK_SECRET
  })

  it('rejects with 401 when the secret header is wrong', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 's3cr3t'
    const res = await POST(
      req({ message: { chat: { id: 1 }, text: '/start abc' } }, { 'x-telegram-bot-api-secret-token': 'nope' }),
    )
    expect(res.status).toBe(401)
    expect(db.updateCalls.length).toBe(0)
  })

  it('binds telegram_chat_id when /start <code> matches a profile', async () => {
    db.selectResult = { data: [{ id: 'user-1' }] }
    const res = await POST(req({ message: { chat: { id: 42 }, text: '/start abcdef' } }))
    expect(res.status).toBe(200)
    expect(db.updateCalls[0]?.patch).toMatchObject({ telegram_chat_id: '42', telegram_link_code: null })
    expect(db.updateCalls[0]?.val).toBe('user-1')
    expect(tg.send).toHaveBeenCalled()
  })

  it('does not bind on an unknown code but replies politely', async () => {
    db.selectResult = { data: [] }
    const res = await POST(req({ message: { chat: { id: 42 }, text: '/start zzz' } }))
    expect(res.status).toBe(200)
    expect(db.updateCalls.length).toBe(0)
    expect(tg.send).toHaveBeenCalledTimes(1)
  })

  it('ignores non-/start messages without touching the db', async () => {
    const res = await POST(req({ message: { chat: { id: 42 }, text: 'привет' } }))
    expect(res.status).toBe(200)
    expect(db.updateCalls.length).toBe(0)
    expect(tg.send).not.toHaveBeenCalled()
  })
})
