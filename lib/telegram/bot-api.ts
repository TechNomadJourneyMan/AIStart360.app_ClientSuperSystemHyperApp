/**
 * Telegram Bot API calls that return results (message ids for approval cards)
 * — unlike lib/telegram.ts sendTelegramMessage, which only reports ok/fail.
 * Never throws; network problems come back as { ok: false }.
 */

export interface InlineButton {
  text: string
  callback_data?: string
  url?: string
}

export type BotResult<T> = { ok: true; result: T } | { ok: false; status: number; description: string }

function token(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null
}

async function call<T>(method: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<BotResult<T>> {
  const t = token()
  if (!t) return { ok: false, status: 0, description: 'TELEGRAM_BOT_TOKEN не задан' }
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${t}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
    if (!res.ok || !json?.ok) {
      return { ok: false, status: res.status, description: json?.description?.slice(0, 200) ?? `HTTP ${res.status}` }
    }
    return { ok: true, result: json.result as T }
  } catch (err) {
    return { ok: false, status: 0, description: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network error' }
  }
}

export function sendBotMessage(
  chatId: string,
  html: string,
  keyboard?: InlineButton[][],
  fetchImpl?: typeof fetch,
): Promise<BotResult<{ message_id: number }>> {
  return call('sendMessage', {
    chat_id: chatId,
    text: html.slice(0, 4000),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  }, fetchImpl)
}

export function editBotMessage(
  chatId: string,
  messageId: number,
  html: string,
  fetchImpl?: typeof fetch,
): Promise<BotResult<unknown>> {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: html.slice(0, 4000),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] },
  }, fetchImpl)
}

export function answerCallback(callbackQueryId: string, text: string, fetchImpl?: typeof fetch): Promise<BotResult<unknown>> {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, text: text.slice(0, 190), show_alert: false }, fetchImpl)
}

/** Escape text for Telegram HTML parse mode. */
export function tgEscape(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
