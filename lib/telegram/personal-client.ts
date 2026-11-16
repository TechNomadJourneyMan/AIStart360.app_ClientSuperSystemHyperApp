import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { envMs } from '@/lib/runtime/deadline'

export interface TelegramPersonalConfig {
  apiId: number
  apiHash: string
  session: string
}

export function getTelegramPersonalConfig(): TelegramPersonalConfig {
  const apiId = Number(process.env.TELEGRAM_API_ID)
  const apiHash = process.env.TELEGRAM_API_HASH?.trim()
  const session = process.env.TELEGRAM_USER_SESSION?.trim()

  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash || !session) {
    throw new Error('[telegram/personal] missing TELEGRAM_API_ID, TELEGRAM_API_HASH or TELEGRAM_USER_SESSION')
  }

  return { apiId, apiHash, session }
}

/**
 * R4-A2 (R4-AUDIT-A §2.1): how long the MTProto connection may take. gramjs has a `timeout` option,
 * but its own typings say it «does nothing for now», and `connect()` retried without a bound: the
 * daily sync (/api/telegram/personal/sync) hung on it while the cron runner gave up after 300 s and
 * the connection stayed open. TELEGRAM_CONNECT_TIMEOUT_MS overrides it.
 */
export const TELEGRAM_CONNECT_TIMEOUT_MS = 15_000

/**
 * RA-5 (review of R4-A2): how long closing a client may take (destroy after a failed connect,
 * disconnect after the sync). A WSS close that never completes must not hold the sync past its limits.
 */
export const TELEGRAM_CLOSE_TIMEOUT_MS = 5_000

/** `close()` or TELEGRAM_CLOSE_TIMEOUT_MS, whichever comes first; false when it did not finish (or failed). */
async function closeWithin(close: () => Promise<void>, what: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const gaveUp = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), envMs('TELEGRAM_CLOSE_TIMEOUT_MS', TELEGRAM_CLOSE_TIMEOUT_MS))
  })
  try {
    const closed = await Promise.race([
      close().then(() => true as const, (err: unknown) => {
        console.error(`[telegram/personal] ${what} failed:`, err instanceof Error ? err.name : 'error')
        return false as const
      }),
      gaveUp,
    ])
    if (!closed) console.error(`[telegram/personal] ${what} did not finish in time`)
    return closed
  } finally {
    clearTimeout(timer)
  }
}

export class TelegramConnectTimeoutError extends Error {
  readonly code = 'TELEGRAM_CONNECT_TIMEOUT'
  constructor(readonly ms: number) {
    super(`[telegram/personal] connect gave no answer in ${ms} ms`)
    this.name = 'TelegramConnectTimeoutError'
  }
}

export async function createTelegramPersonalClient(): Promise<TelegramClient> {
  const config = getTelegramPersonalConfig()
  const client = new TelegramClient(
    new StringSession(config.session),
    config.apiId,
    config.apiHash,
    {
      connectionRetries: 2,
      useWSS: true,
    },
  )

  const ms = envMs('TELEGRAM_CONNECT_TIMEOUT_MS', TELEGRAM_CONNECT_TIMEOUT_MS)
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TelegramConnectTimeoutError(ms)), ms)
  })
  try {
    await Promise.race([client.connect(), expired])
  } catch (error) {
    // A connection that did not come up must not keep its socket and its reconnect loop.
    await closeWithin(() => client.destroy(), 'destroy after a failed connect')
    throw error
  } finally {
    clearTimeout(timer)
  }
  return client
}

export async function disconnectTelegramPersonalClient(client: TelegramClient): Promise<void> {
  await closeWithin(() => client.disconnect(), 'disconnect')
}
