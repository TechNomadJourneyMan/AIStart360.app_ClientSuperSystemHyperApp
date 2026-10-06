/**
 * lib/telegram/bots/registry.ts — the platform's Telegram bots.
 *
 *   client  TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME / TELEGRAM_WEBHOOK_SECRET
 *           client reminders and chat linking (/api/telegram/webhook)
 *   admin   TELEGRAM_ADMIN_BOT_TOKEN / _USERNAME / TELEGRAM_ADMIN_WEBHOOK_SECRET
 *           the control panel for staff (/api/telegram/admin)
 *   expert  TELEGRAM_EXPERT_BOT_TOKEN / _USERNAME / TELEGRAM_EXPERT_WEBHOOK_SECRET
 *           clients and diagnostics for experts (/api/telegram/expert)
 *
 * Tokens come from env only and never leave this module: errors carry the
 * Telegram description, never the URL. Staff notifications and approval
 * buttons go to the admin bot once it is configured (token + secret), and to
 * the client bot otherwise — today's behaviour before the env is set.
 */

export const BOT_IDS = ['client', 'admin', 'expert'] as const
export type BotId = (typeof BOT_IDS)[number]

export function isBotId(v: unknown): v is BotId {
  return typeof v === 'string' && (BOT_IDS as readonly string[]).includes(v)
}

const ENV: Record<BotId, { token: string; username: string; secret: string }> = {
  client: { token: 'TELEGRAM_BOT_TOKEN', username: 'TELEGRAM_BOT_USERNAME', secret: 'TELEGRAM_WEBHOOK_SECRET' },
  admin: { token: 'TELEGRAM_ADMIN_BOT_TOKEN', username: 'TELEGRAM_ADMIN_BOT_USERNAME', secret: 'TELEGRAM_ADMIN_WEBHOOK_SECRET' },
  expert: { token: 'TELEGRAM_EXPERT_BOT_TOKEN', username: 'TELEGRAM_EXPERT_BOT_USERNAME', secret: 'TELEGRAM_EXPERT_WEBHOOK_SECRET' },
}

/** Names of the env variables of a bot (for docs, health and the setup script). */
export function botEnvNames(bot: BotId): { token: string; username: string; secret: string } {
  return { ...ENV[bot] }
}

const read = (name: string): string | null => process.env[name]?.trim() || null

export function botToken(bot: BotId): string | null {
  return read(ENV[bot].token)
}

/** @username without the leading @, or null. */
export function botUsernameOf(bot: BotId): string | null {
  return read(ENV[bot].username)?.replace(/^@/, '') || null
}

export function botWebhookSecret(bot: BotId): string | null {
  return read(ENV[bot].secret)
}

/** Token and webhook secret are both set: the bot can send and safely receive. */
export function isBotConfigured(bot: BotId): boolean {
  return Boolean(botToken(bot) && botWebhookSecret(bot))
}

/** Bot that carries staff notifications and approval cards. */
export function staffBot(): BotId {
  return isBotConfigured('admin') ? 'admin' : 'client'
}

/** Staff linking works: the staff bot can send and its webhook is protected. */
export function staffBotReady(): boolean {
  return isBotConfigured(staffBot())
}

export function deepLink(bot: BotId, startParam: string): string | null {
  const u = botUsernameOf(bot)
  return u ? `https://t.me/${u}?start=${encodeURIComponent(startParam)}` : null
}

// ─── Bot API ─────────────────────────────────────────────────────────────────

export type BotResult<T> = { ok: true; result: T } | { ok: false; status: number; description: string }

/**
 * Call a Bot API method. Never throws: network problems and HTTP errors come
 * back as { ok: false }. `fetchImpl` lets tests (and the container without
 * network) replace the transport.
 */
export async function callApi<T = unknown>(
  bot: BotId,
  method: string,
  params: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<BotResult<T>> {
  const token = botToken(bot)
  if (!token) return { ok: false, status: 0, description: `${ENV[bot].token} не задан` }
  if (!/^[A-Za-z]{3,40}$/.test(method)) return { ok: false, status: 0, description: 'bad method' }
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(8000),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
    if (!res.ok || !json?.ok) {
      return { ok: false, status: res.status, description: redact(json?.description?.slice(0, 200) ?? `HTTP ${res.status}`, token) }
    }
    return { ok: true, result: json.result as T }
  } catch (err) {
    return { ok: false, status: 0, description: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network error' }
  }
}

function redact(text: string, token: string): string {
  return token ? text.split(token).join('***') : text
}

export interface InlineButton {
  text: string
  callback_data?: string
  url?: string
}

export type ReplyMarkup =
  | { inline_keyboard: InlineButton[][] }
  | { keyboard: Array<Array<{ text: string }>>; resize_keyboard?: boolean; is_persistent?: boolean; input_field_placeholder?: string }
  | { remove_keyboard: true }

export const TG_TEXT_LIMIT = 4000

const VOID_TAGS = new Set(['br'])

/**
 * Keep a Telegram HTML message within `limit` VISIBLE characters (Telegram's
 * 4096 limit counts the text after entity parsing). Never cuts through a tag
 * or an entity such as &amp;: a cut is made between tokens, marked with «…»,
 * and every tag still open is closed — slicing the raw HTML could leave a
 * broken `<a href="…` or `&am` and Telegram would reject the whole message.
 */
export function truncateTelegramHtml(html: string, limit = TG_TEXT_LIMIT): string {
  const tokens = html.match(/<[^>]*>|&[#a-zA-Z0-9]+;|[\s\S]/g) ?? []
  let visible = 0
  for (const t of tokens) if (!(t[0] === '<' && t.length > 1)) visible += 1
  if (visible <= limit) return html

  const open: string[] = []
  let out = ''
  let used = 0
  for (const t of tokens) {
    if (t[0] === '<' && t.length > 1) {
      const m = t.match(/^<\s*(\/)?\s*([a-zA-Z][\w-]*)/)
      if (m) {
        const name = m[2].toLowerCase()
        if (m[1]) {
          const i = open.lastIndexOf(name)
          if (i >= 0) open.splice(i, 1)
        } else if (!VOID_TAGS.has(name) && !t.endsWith('/>')) {
          open.push(name)
        }
      }
      out += t
      continue
    }
    if (used >= limit - 1) break
    out += t
    used += 1
  }
  return `${out}…${open.reverse().map((n) => `</${n}>`).join('')}`
}

export function sendMessage(
  bot: BotId,
  chatId: string,
  html: string,
  markup?: ReplyMarkup,
  fetchImpl?: typeof fetch,
): Promise<BotResult<{ message_id: number }>> {
  return callApi(bot, 'sendMessage', {
    chat_id: chatId,
    text: truncateTelegramHtml(html),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(markup ? { reply_markup: markup } : {}),
  }, fetchImpl)
}

export function editMessage(
  bot: BotId,
  chatId: string,
  messageId: number,
  html: string,
  keyboard: InlineButton[][] = [],
  fetchImpl?: typeof fetch,
): Promise<BotResult<unknown>> {
  return callApi(bot, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: truncateTelegramHtml(html),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: keyboard },
  }, fetchImpl)
}

export function answerCallbackQuery(bot: BotId, callbackQueryId: string, text: string, fetchImpl?: typeof fetch, alert = false): Promise<BotResult<unknown>> {
  return callApi(bot, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text: text.slice(0, 190), show_alert: alert }, fetchImpl)
}

export function deleteMessage(bot: BotId, chatId: string, messageId: number, fetchImpl?: typeof fetch): Promise<BotResult<unknown>> {
  return callApi(bot, 'deleteMessage', { chat_id: chatId, message_id: messageId }, fetchImpl)
}

// ─── Files ───────────────────────────────────────────────────────────────────

/** Bot API: «Bots can currently send files of any type of up to 50 MB in size» (sendDocument). */
export const TG_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024
/** Bot API: document caption «0-1024 characters after entities parsing». */
export const TG_CAPTION_LIMIT = 1024

export interface TelegramDocument {
  filename: string
  bytes: Uint8Array
  mime: string
}

/**
 * Upload a file with sendDocument (https://core.telegram.org/bots/api#senddocument).
 *
 * Per the Bot API («Sending files»: "Post the file using multipart/form-data
 * in the usual way that files are uploaded via the browser", 50 MB for files;
 * «Making requests»: application/json "except for uploading files"), the
 * request is multipart/form-data: `chat_id`, `document` (the file part with
 * its file name), `caption` + `parse_mode=HTML` (≤ 1024 visible characters)
 * and `reply_markup` as a JSON-serialized object. The boundary is set by
 * fetch for a FormData body. Never throws; the token never appears in errors
 * (same redaction as callApi).
 */
export async function sendDocument(
  bot: BotId,
  chatId: string,
  file: TelegramDocument,
  caption?: string | null,
  replyMarkup?: ReplyMarkup | null,
  fetchImpl: typeof fetch = fetch,
): Promise<BotResult<{ message_id: number }>> {
  const token = botToken(bot)
  if (!token) return { ok: false, status: 0, description: `${ENV[bot].token} не задан` }
  if (!file.bytes.byteLength) return { ok: false, status: 0, description: 'empty file' }
  if (file.bytes.byteLength > TG_DOCUMENT_MAX_BYTES) return { ok: false, status: 0, description: 'file too large (Bot API limit 50 MB)' }
  const filename = file.filename.replace(/[\\/"\r\n]/g, '_').slice(0, 120) || 'document.pdf'
  const form = new FormData()
  form.append('chat_id', chatId)
  form.append('document', new Blob([new Uint8Array(file.bytes)], { type: file.mime || 'application/octet-stream' }), filename)
  if (caption) {
    form.append('caption', truncateTelegramHtml(caption, TG_CAPTION_LIMIT))
    form.append('parse_mode', 'HTML')
  }
  if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup))
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id: number }; description?: string } | null
    if (!res.ok || !json?.ok) {
      return { ok: false, status: res.status, description: redact(json?.description?.slice(0, 200) ?? `HTTP ${res.status}`, token) }
    }
    return { ok: true, result: json.result as { message_id: number } }
  } catch (err) {
    return { ok: false, status: 0, description: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network error' }
  }
}

