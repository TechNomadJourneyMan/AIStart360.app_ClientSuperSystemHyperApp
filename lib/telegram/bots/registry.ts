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

// ─── Chat actions ────────────────────────────────────────────────────────────

export type ChatAction = 'typing' | 'upload_document' | 'record_voice'

/** «печатает…» for ~5 seconds (https://core.telegram.org/bots/api#sendchataction). Never throws. */
export function sendChatAction(bot: BotId, chatId: string, action: ChatAction = 'typing', fetchImpl?: typeof fetch): Promise<BotResult<unknown>> {
  return callApi(bot, 'sendChatAction', { chat_id: chatId, action }, fetchImpl)
}

/**
 * Keep «печатает…» visible while a long answer is being prepared: one action
 * now and one every `everyMs` (Telegram shows it for ~5 s). Returns `stop`.
 */
export function startTyping(bot: BotId, chatId: string, fetchImpl?: typeof fetch, everyMs = 4000): () => void {
  let stopped = false
  void sendChatAction(bot, chatId, 'typing', fetchImpl)
  const timer = setInterval(() => {
    if (!stopped) void sendChatAction(bot, chatId, 'typing', fetchImpl)
  }, everyMs)
  // Never keep a process alive only for the indicator.
  ;(timer as { unref?: () => void }).unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

// ─── Downloads (getFile) ─────────────────────────────────────────────────────

/** Bot API: «For the moment, bots can download files of up to 20MB in size» (getFile). */
export const TG_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024

export type DownloadResult =
  | { ok: true; bytes: Buffer; filePath: string }
  | { ok: false; reason: 'not_configured' | 'too_large' | 'not_found' | 'unavailable' }

const FILE_ID_RE = /^[A-Za-z0-9_-]{1,256}$/
const FILE_PATH_RE = /^[A-Za-z0-9_\-./]{1,256}$/

/**
 * Download a file a person sent to the bot: getFile → GET
 * https://api.telegram.org/file/bot<token>/<file_path>. The URL carries the
 * token, so it is built here and never returned, logged or put into an error.
 * The body is read with a byte cap (`maxBytes`, ≤ 20 MB — the Bot API limit);
 * a bigger file is refused before or while downloading. Never throws.
 */
export async function downloadTelegramFile(
  bot: BotId,
  fileId: string,
  opts: { maxBytes?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<DownloadResult> {
  const token = botToken(bot)
  if (!token) return { ok: false, reason: 'not_configured' }
  const maxBytes = Math.min(opts.maxBytes ?? TG_DOWNLOAD_MAX_BYTES, TG_DOWNLOAD_MAX_BYTES)
  if (typeof fileId !== 'string' || !FILE_ID_RE.test(fileId)) return { ok: false, reason: 'not_found' }
  const info = await callApi<{ file_id: string; file_size?: number; file_path?: string }>(bot, 'getFile', { file_id: fileId }, opts.fetchImpl)
  if (!info.ok) return { ok: false, reason: /too big/i.test(info.description) ? 'too_large' : info.status === 400 ? 'not_found' : 'unavailable' }
  const filePath = info.result?.file_path
  if (typeof info.result?.file_size === 'number' && info.result.file_size > maxBytes) return { ok: false, reason: 'too_large' }
  if (!filePath || !FILE_PATH_RE.test(filePath) || filePath.includes('..')) return { ok: false, reason: 'not_found' }
  try {
    const res = await (opts.fetchImpl ?? fetch)(`https://api.telegram.org/file/bot${token}/${filePath}`, {
      method: 'GET',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    })
    if (res.status === 404) return { ok: false, reason: 'not_found' }
    if (!res.ok) return { ok: false, reason: 'unavailable' }
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => {})
      return { ok: false, reason: 'too_large' }
    }
    const bytes = await readCappedBody(res, maxBytes)
    return bytes ? { ok: true, bytes, filePath } : { ok: false, reason: 'too_large' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** Read a response body; null as soon as it exceeds `maxBytes` (the stream is cancelled). */
async function readCappedBody(res: Response, maxBytes: number): Promise<Buffer | null> {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > maxBytes ? null : buf
  }
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

