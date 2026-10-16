/**
 * Connect / disconnect of the inbox's Telegram business bot. No network: the
 * Bot API is a mocked fetch; the store is an in-memory fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectTelegramInboxBot,
  disconnectTelegramInboxBot,
  type TelegramBotServiceDeps,
} from '@/lib/omnichannel/telegram-bot-service'
import type { TelegramBotConnection } from '@/lib/omnichannel/telegram-connections'
import {
  hashTelegramWebhookSecret,
  telegramWebhookSecretMatches,
} from '@/lib/omnichannel/telegram-connections'

const TOKEN = '7000000001:AAHk3Q0123456789abcdefghijABCDEFGHIJ_-x'
const ORIGIN = 'https://portal.example.com'
const SECRET = 'fixed-webhook-secret-value-0123456789abcd'

type Call = { method: string; body: Record<string, unknown> }

function telegramFetch(responses: Record<string, { status?: number; json: unknown }>) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url)
    const method = href.split('/').pop() ?? ''
    calls.push({ method, body: JSON.parse(String(init?.body ?? '{}')) })
    const response = responses[method] ?? { status: 404, json: { ok: false, error_code: 404, description: 'Not Found' } }
    return new Response(JSON.stringify(response.json), { status: response.status ?? 200 })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

type Row = TelegramBotConnection & { token: string; secretHash: string }

/** What the real store returns: the connection without secrets. */
function view(row: Row | undefined): TelegramBotConnection | null {
  if (!row) return null
  const { token: _token, secretHash: _hash, ...connection } = row
  return { ...connection }
}

function memoryStore() {
  const rows: Row[] = []
  const store: NonNullable<TelegramBotServiceDeps['store']> = {
    getTelegramBotConnection: vi.fn(async () => view(rows[0])),
    insertPendingTelegramBotConnection: vi.fn(async (input) => {
      const row = {
        id: '11111111-1111-4111-8111-111111111111',
        botId: input.botId,
        botUsername: input.botUsername,
        botName: input.botName,
        status: 'pending' as const,
        webhookOk: false,
        webhookSetAt: null,
        lastUpdateAt: null,
        lastError: null,
        connectedAt: new Date().toISOString(),
        token: input.token,
        secretHash: hashTelegramWebhookSecret(input.webhookSecret),
      }
      rows.push(row)
      return view(row)!
    }),
    markTelegramBotConnection: vi.fn(async (id, patch) => {
      const row = rows.find((r) => r.id === id)
      if (!row) return null
      Object.assign(row, { status: patch.status, webhookOk: patch.webhookOk, lastError: patch.lastError ?? null })
      return view(row)
    }),
    deleteTelegramBotConnection: vi.fn(async (id) => {
      const index = rows.findIndex((r) => r.id === id)
      if (index >= 0) rows.splice(index, 1)
    }),
    getTelegramBotTokenByConnection: vi.fn(async (id) => rows.find((r) => r.id === id)?.token ?? null),
  }
  return { store, rows }
}

const getMeOk = { json: { ok: true, result: { id: 7000000001, is_bot: true, username: 'honor_shop_bot', first_name: 'Honor' } } }

describe('connectTelegramInboxBot', () => {
  let mem: ReturnType<typeof memoryStore>
  beforeEach(() => { mem = memoryStore() })

  function deps(fetchImpl: typeof fetch): TelegramBotServiceDeps {
    return { store: mem.store, api: { fetchImpl }, encryptionConfigured: () => true, newSecret: () => SECRET }
  }

  it('rejects a malformed token without calling Telegram', async () => {
    const tg = telegramFetch({})
    const result = await connectTelegramInboxBot({ token: 'not-a-token', webhookOrigin: ORIGIN, actorId: 'u1' }, deps(tg.fetchImpl))
    expect(result).toMatchObject({ ok: false, code: 'invalid_token', status: 400 })
    expect(tg.calls).toHaveLength(0)
  })

  it('refuses to store a token when SECRETS_ENCRYPTION_KEY is missing', async () => {
    const tg = telegramFetch({ getMe: getMeOk })
    const result = await connectTelegramInboxBot(
      { token: TOKEN, webhookOrigin: ORIGIN, actorId: 'u1' },
      { ...deps(tg.fetchImpl), encryptionConfigured: () => false },
    )
    expect(result).toMatchObject({ ok: false, code: 'encryption_not_configured' })
    expect(mem.store.insertPendingTelegramBotConnection).not.toHaveBeenCalled()
  })

  it('a token Telegram rejects (getMe 401) is not stored', async () => {
    const tg = telegramFetch({ getMe: { status: 401, json: { ok: false, error_code: 401, description: 'Unauthorized' } } })
    const result = await connectTelegramInboxBot({ token: TOKEN, webhookOrigin: ORIGIN, actorId: 'u1' }, deps(tg.fetchImpl))
    expect(result).toMatchObject({ ok: false, code: 'token_rejected' })
    expect(mem.rows).toHaveLength(0)
  })

  it('getMe of another bot id than the token prefix is rejected', async () => {
    const tg = telegramFetch({ getMe: { json: { ok: true, result: { id: 999, is_bot: true, username: 'other' } } } })
    const result = await connectTelegramInboxBot({ token: TOKEN, webhookOrigin: ORIGIN, actorId: 'u1' }, deps(tg.fetchImpl))
    expect(result).toMatchObject({ ok: false, code: 'token_rejected' })
  })

  it('connects: stores, sets the webhook with secret_token + allowed_updates, returns no token', async () => {
    const tg = telegramFetch({ getMe: getMeOk, setWebhook: { json: { ok: true, result: true } } })
    const result = await connectTelegramInboxBot({ token: TOKEN, webhookOrigin: ORIGIN, actorId: 'u1' }, deps(tg.fetchImpl))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.connection).toMatchObject({ botId: '7000000001', botUsername: 'honor_shop_bot', status: 'active', webhookOk: true })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    const setWebhook = tg.calls.find((c) => c.method === 'setWebhook')!
    expect(setWebhook.body).toMatchObject({
      url: `${ORIGIN}/api/webhooks/telegram-inbox/11111111-1111-4111-8111-111111111111`,
      secret_token: SECRET,
      allowed_updates: ['message', 'edited_message'],
    })
    // Only the hash of the secret is kept, and it verifies the header.
    expect(telegramWebhookSecretMatches(mem.rows[0].secretHash, SECRET)).toBe(true)
    expect(telegramWebhookSecretMatches(mem.rows[0].secretHash, 'wrong')).toBe(false)
  })

  it('a second bot cannot be connected while one is active', async () => {
    const tg = telegramFetch({ getMe: getMeOk, setWebhook: { json: { ok: true, result: true } } })
    await connectTelegramInboxBot({ token: TOKEN, webhookOrigin: ORIGIN, actorId: 'u1' }, deps(tg.fetchImpl))
    const again = await connectTelegramInboxBot({ token: TOKEN, webhookOrigin: ORIGIN, actorId: 'u1' }, deps(tg.fetchImpl))
    expect(again).toMatchObject({ ok: false, code: 'already_connected', status: 409 })
  })

  it('a refused setWebhook removes the stored token again', async () => {
    const tg = telegramFetch({
      getMe: getMeOk,
      setWebhook: { status: 400, json: { ok: false, error_code: 400, description: 'Bad Request: bad webhook: HTTPS url must be provided' } },
    })
    const result = await connectTelegramInboxBot({ token: TOKEN, webhookOrigin: ORIGIN, actorId: 'u1' }, deps(tg.fetchImpl))
    expect(result).toMatchObject({ ok: false, code: 'webhook_failed' })
    expect(mem.rows).toHaveLength(0)
  })

  it('needs a public HTTPS origin for the webhook', async () => {
    const tg = telegramFetch({ getMe: getMeOk })
    const result = await connectTelegramInboxBot({ token: TOKEN, webhookOrigin: null, actorId: 'u1' }, deps(tg.fetchImpl))
    expect(result).toMatchObject({ ok: false, code: 'webhook_origin_unavailable' })
    expect(tg.calls).toHaveLength(0)
  })
})

describe('disconnectTelegramInboxBot', () => {
  it('deletes the webhook and removes the stored connection', async () => {
    const mem = memoryStore()
    const tg = telegramFetch({
      getMe: getMeOk,
      setWebhook: { json: { ok: true, result: true } },
      deleteWebhook: { json: { ok: true, result: true } },
    })
    const deps: TelegramBotServiceDeps = { store: mem.store, api: { fetchImpl: tg.fetchImpl }, encryptionConfigured: () => true, newSecret: () => SECRET }
    await connectTelegramInboxBot({ token: TOKEN, webhookOrigin: ORIGIN, actorId: 'u1' }, deps)
    const result = await disconnectTelegramInboxBot(deps)
    expect(result).toEqual({ ok: true, botUsername: 'honor_shop_bot', webhookDeleted: true })
    expect(tg.calls.map((c) => c.method)).toContain('deleteWebhook')
    expect(mem.rows).toHaveLength(0)
  })

  it('still removes the connection when Telegram cannot delete the webhook (revoked token)', async () => {
    const mem = memoryStore()
    const ok = telegramFetch({ getMe: getMeOk, setWebhook: { json: { ok: true, result: true } } })
    await connectTelegramInboxBot({ token: TOKEN, webhookOrigin: ORIGIN, actorId: 'u1' }, {
      store: mem.store, api: { fetchImpl: ok.fetchImpl }, encryptionConfigured: () => true, newSecret: () => SECRET,
    })
    const revoked = telegramFetch({ deleteWebhook: { status: 401, json: { ok: false, error_code: 401, description: 'Unauthorized' } } })
    const result = await disconnectTelegramInboxBot({ store: mem.store, api: { fetchImpl: revoked.fetchImpl } })
    expect(result).toEqual({ ok: true, botUsername: 'honor_shop_bot', webhookDeleted: false })
    expect(mem.rows).toHaveLength(0)
  })
})
