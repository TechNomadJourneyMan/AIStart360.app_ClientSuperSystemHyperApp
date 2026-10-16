/**
 * Connect / disconnect the inbox's Telegram business bot.
 *
 * connect:    token shape → getMe (must be a bot, id = token prefix, has a
 *             username) → store encrypted (pending) → setWebhook with a fresh
 *             secret_token and allowed_updates message/edited_message →
 *             mark active. Any failure after the insert removes the row, so a
 *             half-connected bot never lingers with a stored token.
 * disconnect: deleteWebhook (best effort — a revoked token cannot do it) →
 *             delete the row (token and secret hash are gone).
 *
 * The token is never returned; callers get the public connection only.
 */
import { isEncryptionConfigured } from '@/lib/crypto/secrets'
import {
  isTelegramBotTokenShape,
  telegramBotIdFromToken,
  telegramDeleteWebhook,
  telegramGetMe,
  telegramGetWebhookInfo,
  telegramSetWebhook,
  type TelegramBotApiOptions,
} from './telegram-bot-api'
import * as connections from './telegram-connections'
import type { TelegramBotConnection } from './telegram-connections'

export type TelegramConnectErrorCode =
  | 'encryption_not_configured'
  | 'invalid_token'
  | 'token_rejected'
  | 'telegram_unavailable'
  | 'already_connected'
  | 'webhook_origin_unavailable'
  | 'webhook_failed'
  | 'storage_failed'

export type TelegramConnectResult =
  | { ok: true; connection: TelegramBotConnection }
  | { ok: false; code: TelegramConnectErrorCode; message: string; status: number }

export interface TelegramBotServiceDeps {
  store?: Pick<
    typeof connections,
    | 'getTelegramBotConnection'
    | 'insertPendingTelegramBotConnection'
    | 'markTelegramBotConnection'
    | 'deleteTelegramBotConnection'
    | 'getTelegramBotTokenByConnection'
  >
  api?: TelegramBotApiOptions
  encryptionConfigured?: () => boolean
  newSecret?: () => string
}

function fail(code: TelegramConnectErrorCode, message: string, status: number): TelegramConnectResult {
  return { ok: false, code, message, status }
}

export async function connectTelegramInboxBot(
  input: { token: string; webhookOrigin: string | null; actorId: string | null },
  deps: TelegramBotServiceDeps = {},
): Promise<TelegramConnectResult> {
  const store = deps.store ?? connections
  const token = input.token.trim()
  if (!(deps.encryptionConfigured ?? isEncryptionConfigured)()) {
    return fail('encryption_not_configured', 'На сервере не задан SECRETS_ENCRYPTION_KEY — токен нельзя сохранить безопасно', 503)
  }
  if (!isTelegramBotTokenShape(token)) {
    return fail('invalid_token', 'Это не похоже на токен BotFather (формат 123456789:AA…)', 400)
  }
  if (!input.webhookOrigin) {
    return fail('webhook_origin_unavailable', 'Не удалось определить публичный HTTPS-адрес портала для webhook', 409)
  }

  const me = await telegramGetMe(token, deps.api)
  if (!me.ok) {
    if (me.status === 401 || me.status === 404) {
      return fail('token_rejected', 'Telegram отклонил токен — проверьте его в @BotFather', 400)
    }
    return fail('telegram_unavailable', 'Telegram API недоступен, попробуйте позже', 502)
  }
  const botId = String(me.result?.id ?? '')
  const username = me.result?.username?.replace(/^@/, '') ?? ''
  if (me.result?.is_bot !== true || botId !== telegramBotIdFromToken(token) || !username) {
    return fail('token_rejected', 'Токен не принадлежит боту с @username', 400)
  }

  let existing: TelegramBotConnection | null
  try {
    existing = await store.getTelegramBotConnection()
  } catch {
    return fail('storage_failed', 'Не удалось прочитать подключение (применена ли миграция 124?)', 500)
  }
  if (existing) {
    return fail('already_connected', `Уже подключён @${existing.botUsername}. Сначала отключите его.`, 409)
  }

  const secret = (deps.newSecret ?? connections.newTelegramWebhookSecret)()
  let pending: TelegramBotConnection
  try {
    pending = await store.insertPendingTelegramBotConnection({
      botId,
      botUsername: username,
      botName: me.result.first_name?.slice(0, 128) ?? null,
      token,
      webhookSecret: secret,
      connectedBy: input.actorId,
    })
  } catch (error) {
    if ((error as { code?: string }).code === 'already_connected') {
      return fail('already_connected', 'Бот уже подключён. Сначала отключите текущего.', 409)
    }
    return fail('storage_failed', 'Не удалось сохранить подключение (применена ли миграция 124?)', 500)
  }

  const webhook = await telegramSetWebhook(token, {
    url: connections.telegramInboxWebhookUrl(input.webhookOrigin, pending.id),
    secretToken: secret,
  }, deps.api)
  if (!webhook.ok) {
    try {
      await store.deleteTelegramBotConnection(pending.id)
    } catch {
      // Leave the pending row; the operator can disconnect it from the panel.
    }
    return fail('webhook_failed', `Telegram не принял webhook: ${webhook.description}`, 502)
  }

  try {
    const active = await store.markTelegramBotConnection(pending.id, { status: 'active', webhookOk: true })
    return { ok: true, connection: active ?? { ...pending, status: 'active', webhookOk: true } }
  } catch {
    // The webhook works and the secret is stored; only the status flag lags.
    return { ok: true, connection: { ...pending, webhookOk: true } }
  }
}

export type TelegramDisconnectResult =
  | { ok: true; botUsername: string | null; webhookDeleted: boolean }
  | { ok: false; message: string; status: number }

export async function disconnectTelegramInboxBot(
  deps: TelegramBotServiceDeps = {},
): Promise<TelegramDisconnectResult> {
  const store = deps.store ?? connections
  let existing: TelegramBotConnection | null
  try {
    existing = await store.getTelegramBotConnection()
  } catch {
    return { ok: false, message: 'Не удалось прочитать подключение', status: 500 }
  }
  if (!existing) return { ok: true, botUsername: null, webhookDeleted: false }

  let webhookDeleted = false
  const token = await store.getTelegramBotTokenByConnection(existing.id).catch(() => null)
  if (token) {
    const deleted = await telegramDeleteWebhook(token, deps.api)
    webhookDeleted = deleted.ok
  }
  try {
    await store.deleteTelegramBotConnection(existing.id)
  } catch {
    return { ok: false, message: 'Не удалось удалить подключение', status: 500 }
  }
  return { ok: true, botUsername: existing.botUsername, webhookDeleted }
}

/**
 * On-demand check: does Telegram still point at our URL without errors?
 * Updates webhook_ok / last_error; never returns the token.
 */
export async function verifyTelegramInboxBotWebhook(
  webhookOrigin: string | null,
  deps: TelegramBotServiceDeps = {},
): Promise<TelegramBotConnection | null> {
  const store = deps.store ?? connections
  const existing = await store.getTelegramBotConnection()
  if (!existing) return null
  const token = await store.getTelegramBotTokenByConnection(existing.id)
  if (!token) {
    return store.markTelegramBotConnection(existing.id, {
      status: 'error', webhookOk: false, lastError: 'token_unreadable',
    })
  }
  const info = await telegramGetWebhookInfo(token, deps.api)
  if (!info.ok) {
    if (info.status === 401 || info.status === 404) {
      return store.markTelegramBotConnection(existing.id, {
        status: 'error', webhookOk: false, lastError: 'token_revoked',
      })
    }
    return existing
  }
  const expectedUrl = webhookOrigin ? connections.telegramInboxWebhookUrl(webhookOrigin, existing.id) : null
  const urlMatches = expectedUrl ? info.result.url === expectedUrl : Boolean(info.result.url?.endsWith(`/${existing.id}`))
  const recentError = typeof info.result.last_error_date === 'number'
    && Date.now() / 1000 - info.result.last_error_date < 15 * 60
  const webhookOk = urlMatches && !recentError
  return store.markTelegramBotConnection(existing.id, {
    status: urlMatches ? 'active' : 'error',
    webhookOk,
    lastError: !urlMatches
      ? 'webhook_url_changed'
      : recentError
        ? (info.result.last_error_message ?? 'webhook_delivery_error').slice(0, 200)
        : null,
  })
}
