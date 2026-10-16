/**
 * Telegram update → NormalizedOmnichannelMessage for the unified inbox.
 *
 * Two sources share channel 'telegram' and are told apart by the account id
 * (and metadata.telegramSource):
 *   business_bot  `tgbot:<bot id>`     the inbox's own bot (connected by token)
 *   client_bot    `tgclient:<bot id>`  the platform's client bot, chats that
 *                                      are NOT linked to a platform profile
 *
 * Only private chats with a human sender are accepted. Text and captions
 * become message text; media without a caption is kept as a typed message
 * (the processor escalates it to a person, as for WhatsApp).
 */
import { createHash } from 'crypto'
import type { JsonObject, NormalizedOmnichannelMessage, OmnichannelMessageType } from './types'

export type TelegramInboxSourceKind = 'business_bot' | 'client_bot'

export interface TelegramInboxSource {
  kind: TelegramInboxSourceKind
  /** Numeric bot id (the token prefix). */
  botId: string
  botUsername: string | null
}

export const TELEGRAM_CLIENT_BOT_SOURCE_LABEL = 'Бот AIStart360'

export function telegramAccountExternalId(source: Pick<TelegramInboxSource, 'kind' | 'botId'>): string {
  return `${source.kind === 'business_bot' ? 'tgbot' : 'tgclient'}:${source.botId}`
}

export interface ParsedTelegramInboxUpdate {
  updateId: number
  chatId: string
  edited: boolean
  message: NormalizedOmnichannelMessage
}

const MAX_TEXT = 8_000
const FUTURE_SKEW_MS = 5 * 60_000

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function safeInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  return trimmed ? Array.from(trimmed).slice(0, max).join('') : null
}

function messageType(message: Record<string, unknown>): OmnichannelMessageType {
  if (typeof message.text === 'string') return 'text'
  if (message.photo) return 'image'
  if (message.video || message.video_note || message.animation) return 'video'
  if (message.voice || message.audio) return 'audio'
  if (message.document) return 'document'
  if (message.sticker) return 'sticker'
  if (message.location || message.venue) return 'location'
  if (message.contact) return 'contacts'
  return 'unknown'
}

/** Stable per-update identity for omnichannel_webhook_events (replay guard). */
export function telegramUpdateEventHash(accountExternalId: string, updateId: number): string {
  return createHash('sha256').update(`telegram\0${accountExternalId}\0${updateId}`).digest('hex')
}

export function parseTelegramInboxUpdate(
  update: unknown,
  source: TelegramInboxSource,
  nowMs = Date.now(),
): ParsedTelegramInboxUpdate | null {
  const root = record(update)
  if (!root) return null
  const updateId = safeInt(root.update_id)
  if (updateId === null || updateId < 0) return null
  if (!/^\d{3,20}$/.test(source.botId)) return null

  const edited = !root.message && Boolean(root.edited_message)
  const message = record(root.message) ?? record(root.edited_message)
  if (!message) return null
  const chat = record(message.chat)
  const from = record(message.from)
  if (!chat || chat.type !== 'private') return null
  if (!from || from.is_bot === true) return null
  const chatIdNumber = safeInt(chat.id)
  const fromId = safeInt(from.id)
  const messageId = safeInt(message.message_id)
  if (chatIdNumber === null || fromId === null || messageId === null) return null

  const dateSeconds = safeInt(edited ? message.edit_date ?? message.date : message.date)
  const occurredMs = dateSeconds !== null && dateSeconds > 0 ? dateSeconds * 1000 : null
  // A future provider timestamp would open an artificial policy window.
  if (occurredMs !== null && occurredMs > nowMs + FUTURE_SKEW_MS) return null

  const type = messageType(message)
  const text = cleanString(message.text, MAX_TEXT) ?? cleanString(message.caption, MAX_TEXT)
  if (!text && type === 'unknown') return null // service messages etc.
  if (type === 'text' && !text) return null

  const chatId = String(chatIdNumber)
  const accountExternalId = telegramAccountExternalId(source)
  const firstName = cleanString(from.first_name, 64)
  const lastName = cleanString(from.last_name, 64)
  const username = cleanString(from.username, 64)?.replace(/^@/, '') ?? null
  const contactName = [firstName, lastName].filter(Boolean).join(' ') || (username ? `@${username}` : null)

  const metadata: JsonObject = {
    transport: source.kind === 'business_bot' ? 'telegram_bot' : 'telegram_client_bot',
    telegramSource: source.kind,
    telegramBotId: source.botId,
    ...(source.botUsername ? { telegramBotUsername: source.botUsername } : {}),
    telegramChatId: chatId,
    telegramMessageId: messageId,
    telegramUpdateId: updateId,
    ...(edited ? { edited: true } : {}),
    ...(username ? { telegramUsername: username } : {}),
  }

  return {
    updateId,
    chatId,
    edited,
    message: {
      eventType: 'message',
      channel: 'telegram',
      accountExternalId,
      conversationExternalId: chatId,
      contactExternalId: `${accountExternalId}:${fromId}`,
      contactName,
      contactPhone: null,
      contactUsername: username,
      externalMessageId: `${accountExternalId}:${chatId}:${messageId}${edited ? `:edit:${dateSeconds ?? updateId}` : ''}`,
      direction: 'in',
      messageType: type === 'text' ? 'text' : type,
      text,
      status: 'received',
      replyToExternalId: null,
      occurredAt: occurredMs !== null ? new Date(occurredMs).toISOString() : null,
      metadata,
    },
  }
}
