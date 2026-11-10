/**
 * GET /api/telegram/personal/sync — the daily cron job that reads the personal Telegram inbox.
 * A deployment without a personal Telegram account (no TELEGRAM_API_ID / TELEGRAM_API_HASH /
 * TELEGRAM_USER_SESSION) used to answer 500 and log an error every day; not being configured is a
 * normal state, so the job is skipped there. A sync that is configured and fails is still an error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const sync = vi.hoisted(() => ({ syncTelegramPersonalInbox: vi.fn() }))

// The real module, for telegramPersonalSyncConfigured — without what it would pull in to run a sync.
vi.mock('@/lib/telegram/personal-client', () => ({
  createTelegramPersonalClient: vi.fn(),
  disconnectTelegramPersonalClient: vi.fn(),
}))
vi.mock('@/lib/assistant/answer', () => ({ answerUserQuestion: vi.fn() }))
vi.mock('@/lib/assistant/context', () => ({ buildAssistantContext: vi.fn() }))
vi.mock('@/lib/assistant/escalation/adapter', () => ({ createExpertCase: vi.fn() }))
vi.mock('@/lib/telegram/personal-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram/personal-sync')>()
  return { ...actual, syncTelegramPersonalInbox: sync.syncTelegramPersonalInbox }
})

import { GET } from '@/app/api/telegram/personal/sync/route'
import { telegramPersonalSyncConfigured } from '@/lib/telegram/personal-sync'

const CRON_SECRET = 'cron-secret-of-this-test'
const SYNC_SECRET = 'personal-sync-secret-of-this-test'
const CONFIGURED = { TELEGRAM_API_ID: '123456', TELEGRAM_API_HASH: 'api-hash', TELEGRAM_USER_SESSION: 'string-session' }
const RESULT = { ok: true, scannedDialogs: 3, processedMessages: 2, linkedProfiles: 1, repliedMessages: 1, ignoredMessages: 0 }

function request(bearer?: string): NextRequest {
  return new NextRequest('http://localhost/api/telegram/personal/sync', {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : undefined,
  })
}

function configure(values: Partial<typeof CONFIGURED>): void {
  for (const name of Object.keys(CONFIGURED) as Array<keyof typeof CONFIGURED>) {
    vi.stubEnv(name, values[name] ?? '')
  }
}

beforeEach(() => {
  sync.syncTelegramPersonalInbox.mockReset()
  sync.syncTelegramPersonalInbox.mockResolvedValue(RESULT)
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
  vi.stubEnv('TELEGRAM_PERSONAL_SYNC_SECRET', '')
  configure({})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET /api/telegram/personal/sync', () => {
  it('authorised and not configured: 200 «skipped», the sync is not called, nothing at error level', async () => {
    const partial: Array<Partial<typeof CONFIGURED>> = [
      {},
      { TELEGRAM_API_ID: CONFIGURED.TELEGRAM_API_ID },
      { TELEGRAM_API_ID: CONFIGURED.TELEGRAM_API_ID, TELEGRAM_API_HASH: CONFIGURED.TELEGRAM_API_HASH },
      { TELEGRAM_API_HASH: CONFIGURED.TELEGRAM_API_HASH, TELEGRAM_USER_SESSION: CONFIGURED.TELEGRAM_USER_SESSION },
      { ...CONFIGURED, TELEGRAM_USER_SESSION: '   ' },
    ]
    for (const values of partial) {
      configure(values)

      const response = await GET(request(CRON_SECRET))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true, skipped: 'not_configured' })
    }
    expect(sync.syncTelegramPersonalInbox).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('authorised and configured: runs the sync and answers with its result', async () => {
    configure(CONFIGURED)

    const response = await GET(request(CRON_SECRET))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(RESULT)
    expect(sync.syncTelegramPersonalInbox).toHaveBeenCalledTimes(1)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('a configured sync that fails is still a 500 with an error line', async () => {
    configure(CONFIGURED)
    sync.syncTelegramPersonalInbox.mockRejectedValue(new Error('AUTH_KEY_UNREGISTERED'))

    const response = await GET(request(CRON_SECRET))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, error: 'AUTH_KEY_UNREGISTERED' })
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('answers 401 without the bearer secret — before saying whether the sync is configured', async () => {
    const states: Array<Partial<typeof CONFIGURED>> = [{}, CONFIGURED]
    for (const values of states) {
      configure(values)
      for (const bearer of [undefined, 'another-secret']) {
        const response = await GET(request(bearer))

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({ ok: false, error: 'Unauthorized' })
      }
    }
    expect(sync.syncTelegramPersonalInbox).not.toHaveBeenCalled()
  })

  it('accepts the dedicated TELEGRAM_PERSONAL_SYNC_SECRET as before', async () => {
    vi.stubEnv('TELEGRAM_PERSONAL_SYNC_SECRET', SYNC_SECRET)

    const skipped = await GET(request(SYNC_SECRET))
    expect(await skipped.json()).toEqual({ ok: true, skipped: 'not_configured' })

    configure(CONFIGURED)
    const ran = await GET(request(SYNC_SECRET))
    expect(await ran.json()).toEqual(RESULT)
    expect(sync.syncTelegramPersonalInbox).toHaveBeenCalledTimes(1)
  })
})

describe('telegramPersonalSyncConfigured', () => {
  it('is true only when all three variables are non-empty', () => {
    const withOne = (name: keyof typeof CONFIGURED, value: string | undefined) => {
      const env: Record<string, string | undefined> = { ...CONFIGURED }
      env[name] = value
      return env
    }

    expect(telegramPersonalSyncConfigured(CONFIGURED)).toBe(true)
    expect(telegramPersonalSyncConfigured({})).toBe(false)
    for (const name of Object.keys(CONFIGURED) as Array<keyof typeof CONFIGURED>) {
      expect(telegramPersonalSyncConfigured(withOne(name, undefined))).toBe(false)
      expect(telegramPersonalSyncConfigured(withOne(name, ''))).toBe(false)
      expect(telegramPersonalSyncConfigured(withOne(name, '  '))).toBe(false)
    }
  })

  it('does not judge the values: a malformed id is a configuration to run and report, not to skip', () => {
    expect(telegramPersonalSyncConfigured({ ...CONFIGURED, TELEGRAM_API_ID: 'not-a-number' })).toBe(true)
  })

  it('reads process.env when no environment is given', () => {
    expect(telegramPersonalSyncConfigured()).toBe(false)
    configure(CONFIGURED)
    expect(telegramPersonalSyncConfigured()).toBe(true)
  })
})
