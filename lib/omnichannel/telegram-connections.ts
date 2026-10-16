/**
 * The inbox's Telegram business bot connection (migration 124,
 * public.omnichannel_telegram_bots — service role only, RLS on).
 *
 *   token          AES-256-GCM via lib/crypto/secrets.ts (SECRETS_ENCRYPTION_KEY);
 *                  decrypted only on the server, right before a Bot API call,
 *                  and never returned to the client — the panel sees @username.
 *   webhook secret random 32 bytes handed to Telegram as `secret_token`; only
 *                  its SHA-256 is stored, compared in constant time.
 *
 * One live connection at a time (the inbox is a single business). Account
 * ids in the inbox: `tgbot:<bot id>` for this bot, `tgclient:<bot id>` for the
 * platform's client bot (lib/omnichannel/telegram-webhook.ts).
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import { createServiceClient } from '@/lib/supabase-service'

export const TELEGRAM_BOT_TABLE = 'omnichannel_telegram_bots'

export type TelegramBotConnectionStatus = 'pending' | 'active' | 'error'

export interface TelegramBotConnection {
  id: string
  botId: string
  botUsername: string
  botName: string | null
  status: TelegramBotConnectionStatus
  webhookOk: boolean
  webhookSetAt: string | null
  lastUpdateAt: string | null
  lastError: string | null
  connectedAt: string
}

/** What the panel may see. No token, no secret, no hash. */
export interface PublicTelegramBotConnection {
  id: string
  bot_id: string
  bot_username: string
  bot_name: string | null
  status: TelegramBotConnectionStatus
  webhook_ok: boolean
  webhook_set_at: string | null
  last_update_at: string | null
  last_error: string | null
  connected_at: string
}

const publicColumns =
  'id, bot_id, bot_username, bot_name, status, webhook_ok, webhook_set_at, last_update_at, last_error, created_at'

function client(sb?: SupabaseClient): SupabaseClient {
  return sb ?? createServiceClient()
}

function mapConnection(row: Record<string, unknown>): TelegramBotConnection {
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    botUsername: String(row.bot_username ?? ''),
    botName: typeof row.bot_name === 'string' ? row.bot_name : null,
    status: (['pending', 'active', 'error'].includes(String(row.status)) ? row.status : 'error') as TelegramBotConnectionStatus,
    webhookOk: row.webhook_ok === true,
    webhookSetAt: typeof row.webhook_set_at === 'string' ? row.webhook_set_at : null,
    lastUpdateAt: typeof row.last_update_at === 'string' ? row.last_update_at : null,
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    connectedAt: String(row.created_at ?? ''),
  }
}

export function toPublicTelegramBotConnection(
  connection: TelegramBotConnection | null,
): PublicTelegramBotConnection | null {
  if (!connection) return null
  return {
    id: connection.id,
    bot_id: connection.botId,
    bot_username: connection.botUsername,
    bot_name: connection.botName,
    status: connection.status,
    webhook_ok: connection.webhookOk,
    webhook_set_at: connection.webhookSetAt,
    last_update_at: connection.lastUpdateAt,
    last_error: connection.lastError,
    connected_at: connection.connectedAt,
  }
}

export function telegramBotAccountExternalId(botId: string): string {
  return `tgbot:${botId}`
}

export function botIdFromBusinessAccount(accountExternalId: string): string | null {
  return /^tgbot:(\d{3,20})$/.exec(accountExternalId)?.[1] ?? null
}

/** Random secret_token for setWebhook (Telegram allows [A-Za-z0-9_-], 1–256). */
export function newTelegramWebhookSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function hashTelegramWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/** Constant-time check of the X-Telegram-Bot-Api-Secret-Token header. */
export function telegramWebhookSecretMatches(
  storedHash: string | null | undefined,
  suppliedSecret: string | null | undefined,
): boolean {
  if (!storedHash || !/^[a-f0-9]{64}$/.test(storedHash)) return false
  if (!suppliedSecret || suppliedSecret.length > 256) return false
  const expected = Buffer.from(storedHash, 'hex')
  const actual = createHash('sha256').update(suppliedSecret, 'utf8').digest()
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** The current connection (any state), or null. */
export async function getTelegramBotConnection(sb?: SupabaseClient): Promise<TelegramBotConnection | null> {
  const { data, error } = await client(sb)
    .from(TELEGRAM_BOT_TABLE)
    .select(publicColumns)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`load telegram bot connection: ${error.message?.slice(0, 200)}`)
  return data ? mapConnection(data as Record<string, unknown>) : null
}

/** Webhook lookup: the connection plus its secret hash (never leaves the server). */
export async function getTelegramBotWebhookTarget(
  connectionId: string,
  sb?: SupabaseClient,
): Promise<(TelegramBotConnection & { webhookSecretHash: string }) | null> {
  const { data, error } = await client(sb)
    .from(TELEGRAM_BOT_TABLE)
    .select(`${publicColumns}, webhook_secret_hash`)
    .eq('id', connectionId)
    .maybeSingle()
  if (error) throw new Error(`load telegram webhook target: ${error.message?.slice(0, 200)}`)
  if (!data) return null
  const row = data as Record<string, unknown>
  return { ...mapConnection(row), webhookSecretHash: String(row.webhook_secret_hash ?? '') }
}

/**
 * Decrypted token of the ACTIVE connection for a bot id, or null. Called only
 * at send time; a disconnected or failed bot therefore fails closed.
 */
export async function getActiveTelegramBotToken(
  botId: string,
  sb?: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await client(sb)
    .from(TELEGRAM_BOT_TABLE)
    .select('token_ciphertext')
    .eq('bot_id', botId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`load telegram bot token: ${error.message?.slice(0, 200)}`)
  const ciphertext = (data as { token_ciphertext?: unknown } | null)?.token_ciphertext
  if (typeof ciphertext !== 'string' || !ciphertext) return null
  return decryptSecret(ciphertext)
}

/** Token of a connection by id regardless of state (used to disconnect). */
export async function getTelegramBotTokenByConnection(
  connectionId: string,
  sb?: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await client(sb)
    .from(TELEGRAM_BOT_TABLE)
    .select('token_ciphertext')
    .eq('id', connectionId)
    .maybeSingle()
  if (error) throw new Error(`load telegram bot token: ${error.message?.slice(0, 200)}`)
  const ciphertext = (data as { token_ciphertext?: unknown } | null)?.token_ciphertext
  if (typeof ciphertext !== 'string' || !ciphertext) return null
  try {
    return decryptSecret(ciphertext)
  } catch {
    return null
  }
}

export async function insertPendingTelegramBotConnection(
  input: {
    botId: string
    botUsername: string
    botName: string | null
    token: string
    webhookSecret: string
    connectedBy: string | null
  },
  sb?: SupabaseClient,
): Promise<TelegramBotConnection> {
  const { data, error } = await client(sb)
    .from(TELEGRAM_BOT_TABLE)
    .insert({
      bot_id: input.botId,
      bot_username: input.botUsername,
      bot_name: input.botName,
      token_ciphertext: encryptSecret(input.token),
      webhook_secret_hash: hashTelegramWebhookSecret(input.webhookSecret),
      status: 'pending',
      webhook_ok: false,
      connected_by: input.connectedBy,
    })
    .select(publicColumns)
    .single()
  if (error || !data) {
    const conflict = error?.code === '23505'
    throw Object.assign(
      new Error(conflict ? 'telegram_bot_already_connected' : `insert telegram bot connection: ${error?.message?.slice(0, 200)}`),
      { code: conflict ? 'already_connected' : 'db_error' },
    )
  }
  return mapConnection(data as Record<string, unknown>)
}

export async function markTelegramBotConnection(
  connectionId: string,
  patch: { status: TelegramBotConnectionStatus; webhookOk: boolean; lastError?: string | null },
  sb?: SupabaseClient,
): Promise<TelegramBotConnection | null> {
  const { data, error } = await client(sb)
    .from(TELEGRAM_BOT_TABLE)
    .update({
      status: patch.status,
      webhook_ok: patch.webhookOk,
      last_error: patch.lastError?.slice(0, 300) ?? null,
      ...(patch.webhookOk ? { webhook_set_at: new Date().toISOString() } : {}),
    })
    .eq('id', connectionId)
    .select(publicColumns)
    .maybeSingle()
  if (error) throw new Error(`update telegram bot connection: ${error.message?.slice(0, 200)}`)
  return data ? mapConnection(data as Record<string, unknown>) : null
}

export async function deleteTelegramBotConnection(connectionId: string, sb?: SupabaseClient): Promise<void> {
  const { error } = await client(sb).from(TELEGRAM_BOT_TABLE).delete().eq('id', connectionId)
  if (error) throw new Error(`delete telegram bot connection: ${error.message?.slice(0, 200)}`)
}

/**
 * Status heartbeat for the panel. Written at most once a minute per bot so a
 * busy chat does not turn into one UPDATE per message.
 */
export async function touchTelegramBotLastUpdate(
  connection: Pick<TelegramBotConnection, 'id' | 'lastUpdateAt'>,
  now = new Date(),
  sb?: SupabaseClient,
): Promise<void> {
  const last = connection.lastUpdateAt ? new Date(connection.lastUpdateAt).getTime() : 0
  if (Number.isFinite(last) && now.getTime() - last < 60_000) return
  const { error } = await client(sb)
    .from(TELEGRAM_BOT_TABLE)
    .update({ last_update_at: now.toISOString() })
    .eq('id', connection.id)
  if (error) throw new Error(`touch telegram bot connection: ${error.message?.slice(0, 200)}`)
}

export const TELEGRAM_INBOX_WEBHOOK_PATH = '/api/webhooks/telegram-inbox'

function httpsOrigin(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * Public HTTPS origin Telegram should call. Pinned by
 * TELEGRAM_INBOX_WEBHOOK_ORIGIN, else NEXT_PUBLIC_APP_URL (the production
 * portal), else the origin the operator used. Telegram accepts HTTPS only.
 */
export function resolveTelegramInboxWebhookOrigin(
  headers: { get(name: string): string | null },
  requestUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const pinned = httpsOrigin(env.TELEGRAM_INBOX_WEBHOOK_ORIGIN)
  if (pinned) return pinned
  const app = httpsOrigin(env.NEXT_PUBLIC_APP_URL)
  if (app) return app
  const host = headers.get('x-forwarded-host')?.split(',')[0]?.trim() || headers.get('host')?.trim()
  const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (host && proto) return httpsOrigin(`${proto}://${host}`)
  return httpsOrigin(requestUrl)
}

export function telegramInboxWebhookUrl(origin: string, connectionId: string): string {
  return `${origin}${TELEGRAM_INBOX_WEBHOOK_PATH}/${connectionId}`
}
