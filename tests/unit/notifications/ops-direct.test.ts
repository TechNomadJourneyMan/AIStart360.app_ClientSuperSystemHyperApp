/**
 * lib/notifications/ops-direct.ts — the alarm that does not need the database (R4-A1, N4A-2): one Bot
 * API call per chat of TELEGRAM_ADMIN_CHAT_IDS, the admin bot first, a timeout on every request,
 * never a throw. Without chats (the production state on 2026-11-16) nothing is sent and the log says
 * so once per process. Nothing here imports the database: the test has no Prisma mock on purpose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatOpsAlert, opsAlertBot, opsAlertChatIds, opsDirectConfigured, sendOpsDirect } from '@/lib/notifications/ops-direct'

const WARNED = Symbol.for('aistart360.ops.direct.warned')
const ADMIN_TOKEN = '123456:admin-token-never-logged'
const CLIENT_TOKEN = '654321:client-token'

type Call = { url: string; body: Record<string, unknown>; signal: AbortSignal | null | undefined }

function fakeFetch(answer: (chat: string) => Response | Promise<Response> = () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ url: String(url), body, signal: init?.signal })
    return answer(String(body.chat_id))
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

const alert = { level: 'CRITICAL' as const, title: 'Задачи по расписанию не запускаются', lines: ['Ошибка: <boom> & co'] }

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[WARNED]
  vi.stubEnv('TELEGRAM_ADMIN_BOT_TOKEN', ADMIN_TOKEN)
  vi.stubEnv('TELEGRAM_BOT_TOKEN', CLIENT_TOKEN)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('opsAlertChatIds', () => {
  it('reads chat ids separated by commas or spaces; group ids may be negative; junk is dropped', () => {
    expect(opsAlertChatIds({ TELEGRAM_ADMIN_CHAT_IDS: ' 111, -1002233 444\n,abc, 12.5 ,' })).toEqual(['111', '-1002233', '444'])
    expect(opsAlertChatIds({})).toEqual([])
  })
})

describe('sendOpsDirect', () => {
  it('sends the alert to every chat through the admin bot, with a timeout on each request', async () => {
    const f = fakeFetch()
    const res = await sendOpsDirect(alert, { fetchImpl: f.impl, env: { TELEGRAM_ADMIN_CHAT_IDS: '111,-222' } })

    expect(res).toEqual({ sent: 2, failed: 0 })
    expect(f.calls.map((c) => c.body.chat_id)).toEqual(['111', '-222'])
    for (const c of f.calls) {
      expect(c.url).toBe(`https://api.telegram.org/bot${ADMIN_TOKEN}/sendMessage`)
      expect(c.body.parse_mode).toBe('HTML')
      expect(c.signal).toBeInstanceOf(AbortSignal)
    }
    const text = String(f.calls[0].body.text)
    expect(text).toContain('Задачи по расписанию не запускаются')
    expect(text).toContain('&lt;boom&gt; &amp; co') // escaped for Telegram HTML
    expect(text).toContain('без записи в базу')
  })

  it('falls back to the client bot when the admin bot has no token', async () => {
    vi.stubEnv('TELEGRAM_ADMIN_BOT_TOKEN', '')
    const f = fakeFetch()
    await sendOpsDirect(alert, { fetchImpl: f.impl, env: { TELEGRAM_ADMIN_CHAT_IDS: '111' } })
    expect(f.calls[0].url).toBe(`https://api.telegram.org/bot${CLIENT_TOKEN}/sendMessage`)
    expect(opsAlertBot()).toBe('client')
  })

  it('without chats: nothing is sent, and one error line per process says the alarms go nowhere', async () => {
    const f = fakeFetch()
    const errors: string[] = []
    const first = await sendOpsDirect(alert, { fetchImpl: f.impl, env: {}, logError: (l) => errors.push(l) })
    const second = await sendOpsDirect(alert, { fetchImpl: f.impl, env: { TELEGRAM_ADMIN_CHAT_IDS: '' }, logError: (l) => errors.push(l) })

    expect(first).toEqual({ sent: 0, failed: 0, skipped: 'no_chats' })
    expect(second).toEqual({ sent: 0, failed: 0, skipped: 'no_chats' })
    expect(f.calls).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('TELEGRAM_ADMIN_CHAT_IDS')
  })

  it('without any bot token: nothing is sent, said once', async () => {
    vi.stubEnv('TELEGRAM_ADMIN_BOT_TOKEN', '')
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
    const f = fakeFetch()
    const errors: string[] = []
    const res = await sendOpsDirect(alert, { fetchImpl: f.impl, env: { TELEGRAM_ADMIN_CHAT_IDS: '111' }, logError: (l) => errors.push(l) })
    await sendOpsDirect(alert, { fetchImpl: f.impl, env: { TELEGRAM_ADMIN_CHAT_IDS: '111' }, logError: (l) => errors.push(l) })
    expect(res).toEqual({ sent: 0, failed: 0, skipped: 'no_token' })
    expect(f.calls).toEqual([])
    expect(errors).toHaveLength(1)
  })

  it('a chat that refuses or a network that fails does not stop the others; nothing throws; the token is never logged', async () => {
    const f = fakeFetch((chat) => {
      if (chat === '111') return new Response(JSON.stringify({ ok: false, description: `Forbidden: bot ${ADMIN_TOKEN} was blocked` }), { status: 403 })
      if (chat === '222') throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }))
    })
    const errors: string[] = []
    const res = await sendOpsDirect(alert, { fetchImpl: f.impl, env: { TELEGRAM_ADMIN_CHAT_IDS: '111 222 333' }, logError: (l) => errors.push(l) })

    expect(res).toEqual({ sent: 1, failed: 2 })
    expect(f.calls).toHaveLength(3)
    expect(errors).toHaveLength(2)
    expect(errors.join('\n')).not.toContain(ADMIN_TOKEN)
  })

  // AbortSignal.timeout runs on the real clock (fake timers do not reach it): this test takes 8 s.
  it('a Bot API that hangs is cut by the request timeout (8 s), not waited for', async () => {
    const hanging = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })))
    }))
    const errors: string[] = []
    const t0 = Date.now()
    const res = await sendOpsDirect(alert, { fetchImpl: hanging as unknown as typeof fetch, env: { TELEGRAM_ADMIN_CHAT_IDS: '111' }, logError: (l) => errors.push(l) })
    expect(res).toEqual({ sent: 0, failed: 1 })
    expect(Date.now() - t0).toBeLessThan(12_000)
    expect(errors[0]).toContain('timeout')
  }, 15_000)
})

describe('opsDirectConfigured / formatOpsAlert', () => {
  it('configured only with chats and a bot token', () => {
    expect(opsDirectConfigured({ TELEGRAM_ADMIN_CHAT_IDS: '111' })).toBe(true)
    expect(opsDirectConfigured({})).toBe(false)
    vi.stubEnv('TELEGRAM_ADMIN_BOT_TOKEN', '')
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
    expect(opsDirectConfigured({ TELEGRAM_ADMIN_CHAT_IDS: '111' })).toBe(false)
  })

  it('a recovery is a SUCCESS message', () => {
    expect(formatOpsAlert({ level: 'SUCCESS', title: 'Снова работает' })).toMatch(/^✅/)
  })
})
