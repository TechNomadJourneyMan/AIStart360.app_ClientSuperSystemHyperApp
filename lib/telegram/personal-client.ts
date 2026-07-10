import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'

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

  await client.connect()
  return client
}

export async function disconnectTelegramPersonalClient(client: TelegramClient): Promise<void> {
  try {
    await client.disconnect()
  } catch (error) {
    console.error('[telegram/personal] disconnect failed:', error)
  }
}
