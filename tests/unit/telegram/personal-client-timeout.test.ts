/**
 * R4-A2 (R4-AUDIT-A §2.1, «опасно»): the daily personal Telegram sync connected over MTProto with
 * gramjs, whose `timeout` option «does nothing for now». A connection that never came up held the
 * sync without end — the cron runner gave up after 300 s, the socket and its reconnect loop stayed.
 * Now the connect has its own limit, and a client that did not come up is destroyed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  destroy: vi.fn<() => Promise<void>>(async () => undefined),
  disconnect: vi.fn<() => Promise<void>>(async () => undefined),
  created: 0,
}))

vi.mock('telegram', () => ({
  TelegramClient: class {
    constructor() { h.created += 1 }
    connect() { return h.connect() }
    destroy() { return h.destroy() }
    disconnect() { return h.disconnect() }
  },
}))
vi.mock('telegram/sessions', () => ({ StringSession: class {} }))

const { createTelegramPersonalClient, disconnectTelegramPersonalClient, TelegramConnectTimeoutError, TELEGRAM_CONNECT_TIMEOUT_MS, TELEGRAM_CLOSE_TIMEOUT_MS } = await import('@/lib/telegram/personal-client')

beforeEach(() => {
  h.connect.mockReset()
  h.destroy.mockReset().mockResolvedValue(undefined)
  h.disconnect.mockReset().mockResolvedValue(undefined)
  h.created = 0
  vi.stubEnv('TELEGRAM_API_ID', '123456')
  vi.stubEnv('TELEGRAM_API_HASH', 'api-hash')
  vi.stubEnv('TELEGRAM_USER_SESSION', 'string-session')
  vi.stubEnv('TELEGRAM_CONNECT_TIMEOUT_MS', '')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('createTelegramPersonalClient: the MTProto connect is bounded', () => {
  it('a connect that never comes up fails after 15 s (not before) and the client is destroyed', async () => {
    expect(TELEGRAM_CONNECT_TIMEOUT_MS).toBe(15_000)
    h.connect.mockImplementation(() => new Promise(() => {}))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    let outcome: unknown = 'pending'
    const pending = createTelegramPersonalClient().then(() => 'connected', (err: unknown) => err)
    void pending.then((v) => { outcome = v })

    await vi.advanceTimersByTimeAsync(14_999)
    expect(outcome).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBeInstanceOf(TelegramConnectTimeoutError)
    expect(h.destroy).toHaveBeenCalledTimes(1)
  })

  it('TELEGRAM_CONNECT_TIMEOUT_MS overrides the limit', async () => {
    vi.stubEnv('TELEGRAM_CONNECT_TIMEOUT_MS', '50')
    h.connect.mockImplementation(() => new Promise(() => {}))
    const started = Date.now()
    await expect(createTelegramPersonalClient()).rejects.toBeInstanceOf(TelegramConnectTimeoutError)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('a connect that comes up in time gives the client, nothing destroyed', async () => {
    h.connect.mockResolvedValue(undefined)
    await expect(createTelegramPersonalClient()).resolves.toBeDefined()
    expect(h.destroy).not.toHaveBeenCalled()
  })

  it('a connect that fails is destroyed too, and its own error is kept', async () => {
    h.connect.mockRejectedValue(new Error('AUTH_KEY_UNREGISTERED'))
    await expect(createTelegramPersonalClient()).rejects.toThrow('AUTH_KEY_UNREGISTERED')
    expect(h.destroy).toHaveBeenCalledTimes(1)
  })
})

describe('RA-5: closing the client is bounded too', () => {
  it('a destroy that never finishes after a connect timeout: the error still comes 5 s later, not never', async () => {
    expect(TELEGRAM_CLOSE_TIMEOUT_MS).toBe(5_000)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.connect.mockImplementation(() => new Promise(() => {}))
    h.destroy.mockImplementation(() => new Promise(() => {})) // the WSS close hangs
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    let outcome: unknown = 'pending'
    const pending = createTelegramPersonalClient().then(() => 'connected', (err: unknown) => err)
    void pending.then((v) => { outcome = v })

    await vi.advanceTimersByTimeAsync(15_000 + 4_999)
    expect(outcome).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBeInstanceOf(TelegramConnectTimeoutError)
    expect(h.destroy).toHaveBeenCalledTimes(1)
  })

  it('a disconnect after the sync that never finishes is given up after 5 s', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.connect.mockResolvedValue(undefined)
    h.disconnect.mockImplementation(() => new Promise(() => {}))
    const client = await createTelegramPersonalClient()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    let done = false
    const closing = disconnectTelegramPersonalClient(client).then(() => { done = true })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await closing
    expect(done).toBe(true)
    expect(error.mock.calls.some(([line]) => String(line).includes('disconnect did not finish in time'))).toBe(true)
  })
})
