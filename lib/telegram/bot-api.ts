/**
 * Telegram Bot API calls that return results (message ids for approval cards)
 * — unlike lib/telegram.ts sendTelegramMessage, which only reports ok/fail.
 * Never throws; network problems come back as { ok: false }.
 *
 * Every call targets one of the platform bots (lib/telegram/bots/registry.ts);
 * the default is the client bot (TELEGRAM_BOT_TOKEN), as before. Staff
 * notifications pass `staffBot()` — the admin bot once it is configured.
 */
import {
  answerCallbackQuery, callApi, editMessage, sendMessage,
  type BotId, type BotResult as RegistryBotResult, type InlineButton as RegistryInlineButton,
} from './bots/registry'

export type InlineButton = RegistryInlineButton
export type BotResult<T> = RegistryBotResult<T>

export function sendBotMessage(
  chatId: string,
  html: string,
  keyboard?: InlineButton[][],
  fetchImpl?: typeof fetch,
  bot: BotId = 'client',
): Promise<BotResult<{ message_id: number }>> {
  return sendMessage(bot, chatId, html, keyboard ? { inline_keyboard: keyboard } : undefined, fetchImpl)
}

export function editBotMessage(
  chatId: string,
  messageId: number,
  html: string,
  fetchImpl?: typeof fetch,
  bot: BotId = 'client',
): Promise<BotResult<unknown>> {
  return editMessage(bot, chatId, messageId, html, [], fetchImpl)
}

export function answerCallback(callbackQueryId: string, text: string, fetchImpl?: typeof fetch, bot: BotId = 'client'): Promise<BotResult<unknown>> {
  return answerCallbackQuery(bot, callbackQueryId, text, fetchImpl)
}

export { callApi }

/** Escape text for Telegram HTML parse mode. */
export function tgEscape(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
