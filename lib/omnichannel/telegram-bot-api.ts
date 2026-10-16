/**
 * Minimal Telegram Bot API client for the omnichannel inbox.
 *
 * Unlike lib/telegram/bots/registry.ts (env-configured platform bots), this
 * client takes the token as an argument: the inbox's business bot token lives
 * encrypted in the database. The token is never logged or returned — error
 * descriptions are redacted and the request URL is never surfaced.
 *
 * Send results reuse the omnichannel MetaSendResult shape so the processing
 * pipeline treats Telegram exactly like the other transports:
 *   timeout / network_error with status null = delivery unknown (no auto-retry).
 */
import { randomUUID } from 'crypto'
import type { MetaSendResult } from './meta-client'

export const TELEGRAM_API_BASE = 'https://api.telegram.org'
export const TELEGRAM_TEXT_LIMIT = 4096
const DEFAULT_TIMEOUT_MS = 8_000

/** BotFather token shape: `<numeric bot id>:<35+ url-safe chars>`. */
const TOKEN_PATTERN = /^(\d{3,20}):[A-Za-z0-9_-]{30,100}$/

export function isTelegramBotTokenShape(value: string): boolean {
  return TOKEN_PATTERN.test(value.trim())
}

/** The numeric bot id is the token prefix (public information). */
export function telegramBotIdFromToken(token: string | null | undefined): string | null {
  const match = TOKEN_PATTERN.exec(token?.trim() ?? '')
  return match ? match[1] : null
}

export type TelegramApiResult<T> =
  | { ok: true; result: T }
  | {
      ok: false
      /** HTTP status, or null when no response was received. */
      status: number | null
      /** Telegram `error_code`, or a local code (timeout, network_error, invalid_input). */
      code: string
      description: string
      retryAfterSeconds?: number
      /** false only when the request provably never left this process. */
      requestSent?: boolean
    }

export interface TelegramBotApiOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function redact(text: string, token: string): string {
  let safe = token ? text.split(token).join('[REDACTED]') : text
  safe = safe.replace(/bot\d{3,20}:[A-Za-z0-9_-]{20,}/g, 'bot[REDACTED]')
  return safe.slice(0, 300)
}

export async function callTelegramBotApi<T>(
  token: string,
  method: string,
  params: Record<string, unknown>,
  options: TelegramBotApiOptions = {},
): Promise<TelegramApiResult<T>> {
  const cleanToken = token.trim()
  if (!isTelegramBotTokenShape(cleanToken)) {
    return { ok: false, status: null, code: 'invalid_token', description: 'Bot token has an invalid format', requestSent: false }
  }
  if (!/^[A-Za-z]{3,40}$/.test(method)) {
    return { ok: false, status: null, code: 'invalid_input', description: 'Invalid Bot API method', requestSent: false }
  }
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${cleanToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: 'no-store',
    })
    const json = (await response.json().catch(() => null)) as {
      ok?: unknown
      result?: T
      description?: unknown
      error_code?: unknown
      parameters?: { retry_after?: unknown }
    } | null
    if (!response.ok || json?.ok !== true) {
      const retryAfter = Number(json?.parameters?.retry_after)
      return {
        ok: false,
        status: response.status,
        code: typeof json?.error_code === 'number' ? `telegram_${json.error_code}` : `http_${response.status}`,
        description: redact(
          typeof json?.description === 'string' ? json.description : `HTTP ${response.status}`,
          cleanToken,
        ),
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
      }
    }
    return { ok: true, result: json.result as T }
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return {
      ok: false,
      status: null,
      code: timeout ? 'timeout' : 'network_error',
      description: timeout ? 'Telegram API timeout' : 'Telegram API network error',
    }
  }
}

export interface TelegramBotIdentity {
  id: number
  is_bot: boolean
  username?: string
  first_name?: string
}

export function telegramGetMe(token: string, options?: TelegramBotApiOptions) {
  return callTelegramBotApi<TelegramBotIdentity>(token, 'getMe', {}, options)
}

export const TELEGRAM_INBOX_ALLOWED_UPDATES = ['message', 'edited_message'] as const

export function telegramSetWebhook(
  token: string,
  input: { url: string; secretToken: string },
  options?: TelegramBotApiOptions,
) {
  return callTelegramBotApi<boolean>(token, 'setWebhook', {
    url: input.url,
    secret_token: input.secretToken,
    allowed_updates: [...TELEGRAM_INBOX_ALLOWED_UPDATES],
    drop_pending_updates: false,
    max_connections: 10,
  }, options)
}

export function telegramDeleteWebhook(token: string, options?: TelegramBotApiOptions) {
  return callTelegramBotApi<boolean>(token, 'deleteWebhook', { drop_pending_updates: false }, options)
}

export interface TelegramWebhookInfo {
  url?: string
  pending_update_count?: number
  last_error_date?: number
  last_error_message?: string
}

export function telegramGetWebhookInfo(token: string, options?: TelegramBotApiOptions) {
  return callTelegramBotApi<TelegramWebhookInfo>(token, 'getWebhookInfo', {}, options)
}

export async function telegramSendChatAction(
  token: string,
  chatId: string,
  options?: TelegramBotApiOptions,
): Promise<{ ok: true; rawStatus: number } | { ok: false; status: number | null; code: string; message: string; retryable: boolean }> {
  const result = await callTelegramBotApi<boolean>(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }, options)
  if (result.ok) return { ok: true, rawStatus: 200 }
  return { ok: false, status: result.status, code: result.code, message: result.description, retryable: false }
}

/**
 * Plain-text send (no parse_mode): AI and operator text is never interpreted
 * as markup. Long text is cut to the Bot API limit rather than rejected.
 */
export async function telegramSendText(
  token: string,
  input: { chatId: string; text: string },
  options?: TelegramBotApiOptions,
): Promise<MetaSendResult> {
  const text = Array.from(input.text).slice(0, TELEGRAM_TEXT_LIMIT).join('')
  if (!text.trim() || !/^-?\d{1,20}$/.test(input.chatId)) {
    return { ok: false, status: null, code: 'invalid_input', message: 'Telegram chat or text is invalid', retryable: false, requestSent: false }
  }
  const result = await callTelegramBotApi<{ message_id?: number }>(token, 'sendMessage', {
    chat_id: input.chatId,
    text,
  }, options)
  if (result.ok) {
    const messageId = result.result?.message_id
    if (typeof messageId !== 'number') {
      // Accepted by Telegram, but the id is missing: never report a failure
      // that could make a caller retry and send twice.
      return { ok: true, externalMessageId: `unknown.${randomUUID()}`, rawStatus: 200 }
    }
    return { ok: true, externalMessageId: String(messageId), rawStatus: 200 }
  }
  return {
    ok: false,
    status: result.status,
    code: result.code,
    message: result.description,
    retryable: result.status === 429 || (result.status !== null && result.status >= 500),
    ...(result.requestSent === false ? { requestSent: false } : {}),
  }
}
