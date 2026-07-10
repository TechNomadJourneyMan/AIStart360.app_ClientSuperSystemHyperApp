import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { Locale } from '@/lib/i18n/locale'

export const TELEGRAM_SAFE_MESSAGE_LIMIT = 3900

export interface TelegramUser {
  id: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

export interface TelegramChat {
  id: number
  type: string
}

export interface TelegramMessage {
  message_id: number
  chat: TelegramChat
  from?: TelegramUser
  text?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

export interface ParsedTelegramCommand {
  command: string
  argsText: string
}

export function isPrivateTextMessage(message: TelegramMessage | undefined): message is TelegramMessage & {
  from: TelegramUser
  text: string
} {
  return Boolean(
    message &&
      message.chat?.type === 'private' &&
      message.from &&
      !message.from.is_bot &&
      typeof message.text === 'string' &&
      message.text.trim().length > 0,
  )
}

export function parseTelegramCommand(text: string): ParsedTelegramCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  const firstSpace = trimmed.search(/\s/)
  const rawCommand = firstSpace === -1 ? trimmed.slice(1) : trimmed.slice(1, firstSpace)
  const command = rawCommand.split('@')[0]?.toLowerCase().trim()
  if (!command) return null

  return {
    command,
    argsText: firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim(),
  }
}

export function createTelegramLinkToken(): string {
  return randomBytes(24).toString('base64url')
}

export function createTelegramPersonalLinkCode(): string {
  return `AISTART-${randomBytes(5).toString('hex').toUpperCase()}`
}

export function hashTelegramLinkToken(token: string): string {
  return createHash('sha256').update(normalizeTelegramLinkToken(token), 'utf8').digest('hex')
}

export function normalizeTelegramLinkToken(token: string): string {
  return token.trim().toUpperCase()
}

export function safeCompareTelegramSecret(expected: string, actual: string | null): boolean {
  if (!actual) return false
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  if (expectedBuffer.length !== actualBuffer.length) return false
  return timingSafeEqual(expectedBuffer, actualBuffer)
}

export function localeFromTelegramUser(user: TelegramUser | undefined): Locale {
  return user?.language_code?.toLowerCase().startsWith('en') ? 'en' : 'ru'
}

export function splitTelegramText(text: string, limit = TELEGRAM_SAFE_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > limit) {
    const slice = remaining.slice(0, limit)
    const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf(' '))
    const cutAt = lastBreak > limit * 0.5 ? lastBreak + 1 : limit
    chunks.push(remaining.slice(0, cutAt).trim())
    remaining = remaining.slice(cutAt).trim()
  }

  if (remaining) chunks.push(remaining)
  return chunks
}

export function buildTelegramDeepLink(botUsername: string | undefined, token: string): string | null {
  const normalized = botUsername?.replace(/^@/, '').trim()
  if (!normalized) return null
  return `https://t.me/${normalized}?start=${encodeURIComponent(token)}`
}

export function buildTelegramPersonalLink(username: string | undefined): string | null {
  const normalized = username?.replace(/^@/, '').trim()
  if (!normalized) return null
  return `https://t.me/${normalized}`
}

export function extractTelegramLinkToken(text: string): string | null {
  const command = parseTelegramCommand(text)
  const candidate = command?.command === 'link' ? command.argsText : text.trim()
  const token = candidate.trim().split(/\s+/)[0]
  if (!/^AISTART-[A-F0-9]{10}$/i.test(token)) return null
  return normalizeTelegramLinkToken(token)
}

export function buildHelpText(locale: Locale = 'ru'): string {
  if (locale === 'en') {
    return [
      'AIStart360 assistant is connected.',
      '',
      'Send a business question in this chat, and I will answer from your platform data only.',
      '',
      '/help - commands',
      '/unlink - disconnect this Telegram chat',
    ].join('\n')
  }

  return [
    'Ассистент AIStart360 подключён.',
    '',
    'Напишите вопрос по вашему бизнесу в этот чат, и я отвечу только по данным из платформы.',
    '',
    '/help - команды',
    '/unlink - отвязать этот Telegram-чат',
  ].join('\n')
}

export function buildUnlinkedText(locale: Locale = 'ru'): string {
  if (locale === 'en') {
    return 'This Telegram chat is not linked to an AIStart360 account yet. Open Settings in the portal, generate a Telegram code, and send it here.'
  }

  return 'Этот Telegram-чат пока не привязан к аккаунту AIStart360. Откройте настройки в портале, создайте Telegram-код и отправьте его сюда.'
}

export function buildEscalatedText(answer: string | null | undefined, locale: Locale = 'ru'): string {
  const clean = answer?.trim()
  if (locale === 'en') {
    return clean
      ? `${clean}\n\nI also passed the question to an expert.`
      : 'I cannot answer this confidently from the available data, so I passed the question to an expert.'
  }

  return clean
    ? `${clean}\n\nЯ также передал вопрос эксперту.`
    : 'Я не могу уверенно ответить по доступным данным, поэтому передал вопрос эксперту.'
}
