/**
 * lib/comm/format.ts — the text of a message per channel (pure).
 *
 * Telegram uses HTML parse mode: the author's text is escaped (tgEscape), so
 * «<b>» typed by an expert stays visible text. WhatsApp is plain text.
 */
import { tgEscape } from '@/lib/telegram/bot-api'
import type { CommAuthorKind } from './types'

/** Telegram hard limit is 4096 characters per message. */
const TELEGRAM_MAX = 4000
/** The bridge accepts up to 4096 characters. */
const WHATSAPP_MAX = 4000

export const TELEGRAM_RECEIPT_TEXT = 'Сообщение получено — эксперт ответит здесь же.'

export function signature(authorKind: CommAuthorKind, authorName: string | null | undefined): string {
  if (authorKind === 'bot') return 'Бот AIStart360'
  if (authorKind === 'system') return 'AIStart360'
  const name = authorName?.trim()
  return name ? `${name}, AIStart360` : 'Команда AIStart360'
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function telegramText(input: { body: string; authorKind: CommAuthorKind; authorName?: string | null }): string {
  const head = `<b>💬 ${tgEscape(signature(input.authorKind, input.authorName))}</b>`
  const foot = '<i>Ответьте в этот чат — сообщение увидит эксперт.</i>'
  const room = TELEGRAM_MAX - head.length - foot.length - 4
  return `${head}\n\n${clip(tgEscape(input.body.trim()), Math.max(200, room))}\n\n${foot}`
}

export function whatsappText(input: { body: string; authorKind: CommAuthorKind; authorName?: string | null }): string {
  const sig = `— ${signature(input.authorKind, input.authorName)}`
  const room = WHATSAPP_MAX - sig.length - 2
  return `${clip(input.body.trim(), Math.max(200, room))}\n\n${sig}`
}

/** Feed text for a non-text WhatsApp / Telegram message (photo, voice…). */
export function attachmentLabel(kind: string): string {
  const map: Record<string, string> = {
    image: 'фото', photo: 'фото', video: 'видео', audio: 'аудио', voice: 'голосовое сообщение',
    document: 'документ', sticker: 'стикер', location: 'геопозиция', contacts: 'контакт',
  }
  return `[${map[kind] ?? 'вложение'}]`
}
