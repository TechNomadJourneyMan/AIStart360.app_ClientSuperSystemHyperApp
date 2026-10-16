/**
 * The platform's client bot (TELEGRAM_BOT_TOKEN, /api/telegram/webhook) →
 * unified inbox, for chats that are NOT linked to a platform profile.
 *
 * Linked chats keep going to lib/comm (GIGA «Сообщения») exactly as before;
 * this module is called only after lib/comm declined the message, and only
 * for updates whose TELEGRAM_WEBHOOK_SECRET was verified.
 *
 * Fail-soft by design: the client bot's webhook also carries /start linking
 * and staff approvals, so an inbox problem (e.g. migration 124 not applied
 * yet) is logged and swallowed — it must never turn into a 500 that stalls
 * Telegram's update queue for everyone else.
 *
 * Conversations are tagged `tgclient:<bot id>` / telegramSource=client_bot
 * («Бот AIStart360» in the panel) and are draft-only: AI prepares an answer,
 * an operator sends it through the same client bot.
 *
 * Kill switch: OMNICHANNEL_TELEGRAM_CLIENT_BOT_INBOX=0 (default: on).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createServiceClient } from '@/lib/supabase-service'
import { botToken, botUsernameOf } from '@/lib/telegram/bots/registry'
import { telegramBotIdFromToken } from './telegram-bot-api'
import { ingestTelegramInboxUpdate, type TelegramIngestPersistence, type TelegramIngestQueue } from './telegram-ingest'
import { parseTelegramInboxUpdate } from './telegram-webhook'

export type ClientBotForwardOutcome =
  | 'forwarded'
  | 'duplicate'
  | 'disabled'
  | 'skipped'
  | 'linked'
  | 'rate_limited'
  | 'failed'

export function isClientBotInboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.OMNICHANNEL_TELEGRAM_CLIENT_BOT_INBOX?.trim().toLowerCase()
  return !(value && ['0', 'false', 'off', 'no'].includes(value))
}

/** Commands that still reach the inbox from an unlinked chat (opt-out). */
const FORWARDED_COMMAND = /^\/stop(?:@\w+)?$/i

export interface ClientBotForwardDeps {
  sb?: SupabaseClient
  persistence?: TelegramIngestPersistence
  queue?: TelegramIngestQueue
  rateLimited?: (key: string) => Promise<boolean>
  now?: number
}

async function isLinkedChat(chatId: string, sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.from('profiles').select('id').eq('telegram_chat_id', chatId).limit(1)
  if (error) throw new Error('profile link lookup failed')
  return Array.isArray(data) && data.length > 0
}

/**
 * @param linkChecked true when lib/comm already looked the chat up and found
 *        no profile (plain text); false for commands, which lib/comm skips
 *        without a lookup.
 */
export async function forwardUnlinkedClientBotUpdate(
  update: unknown,
  options: { linkChecked: boolean },
  deps: ClientBotForwardDeps = {},
): Promise<ClientBotForwardOutcome> {
  if (!isClientBotInboxEnabled()) return 'disabled'
  try {
    const botId = telegramBotIdFromToken(botToken('client'))
    if (!botId) return 'skipped'
    const parsed = parseTelegramInboxUpdate(
      update,
      { kind: 'client_bot', botId, botUsername: botUsernameOf('client') },
      deps.now,
    )
    if (!parsed) return 'skipped'
    const text = parsed.message.text?.trim() ?? ''
    const command = text.startsWith('/')
    if (command && !FORWARDED_COMMAND.test(text)) return 'skipped'
    if (!options.linkChecked || command) {
      if (await isLinkedChat(parsed.chatId, deps.sb ?? createServiceClient())) return 'linked'
    }
    const limited = deps.rateLimited
      ? await deps.rateLimited(`${botId}:${parsed.chatId}`)
      : await isRateLimitedKey(`${botId}:${parsed.chatId}`, 'telegram-inbox', {
          max: 30,
          windowMs: 60_000,
          failClosed: false,
        })
    if (limited) return 'rate_limited'
    const result = await ingestTelegramInboxUpdate(parsed, {
      persistence: deps.persistence,
      queue: deps.queue,
    })
    return result.outcome === 'processed' ? 'forwarded' : 'duplicate'
  } catch (error) {
    // Never log message content or chat identifiers.
    console.error('[telegram/webhook] inbox forward failed:', error instanceof Error ? error.message.slice(0, 160) : 'error')
    return 'failed'
  }
}
