/**
 * lib/telegram.ts — тонкий клиент Telegram Bot API + утилиты привязки чата.
 *
 * Общая точка для дайджеста (fan-out по каналам) и webhook-а привязки. Доставка
 * best-effort: sendTelegramMessage никогда не бросает и не блокирует вызывающего.
 * Настройка через env: TELEGRAM_BOT_TOKEN (обязателен), TELEGRAM_BOT_USERNAME
 * (для deep-link), TELEGRAM_WEBHOOK_SECRET (защита webhook).
 */

import { randomBytes } from 'crypto'

const api = (method: string) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`

/** Бот настроен (есть токен) — можно слать сообщения. */
export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN)
}

/** @username бота без ведущей @ (для deep-link), либо null. */
export function botUsername(): string | null {
  const u = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '')
  return u || null
}

/** t.me deep-link, который свяжет пользователя по одноразовому коду, либо null. */
export function botDeepLink(code: string): string | null {
  const u = botUsername()
  return u ? `https://t.me/${u}?start=${code}` : null
}

/** Криптослучайный одноразовый код привязки (12 hex-символов). */
export function newLinkCode(): string {
  return randomBytes(6).toString('hex')
}

/**
 * Отправить HTML-сообщение в чат. Возвращает true при HTTP-ok; никогда не бросает
 * (сетевые ошибки/таймаут → false), чтобы не ронять дайджест и webhook.
 */
export async function sendTelegramMessage(chatId: string, html: string): Promise<boolean> {
  if (!telegramConfigured() || !chatId) return false
  try {
    const res = await fetch(api('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}
