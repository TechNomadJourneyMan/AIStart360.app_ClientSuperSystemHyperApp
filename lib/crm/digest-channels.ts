/**
 * lib/crm/digest-channels.ts — дополнительные каналы CRM-дайджеста.
 *
 * WhatsApp: одобренный шаблон Meta `digest` через надёжную очередь
 * lib/whatsapp/outbox.ts (идемпотентно: один дайджест на пользователя в сутки;
 * повторы с backoff; неоднозначный таймаут не переотправляется). Включается
 * только при:
 *   • настроенном Cloud API (WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID);
 *   • подтверждённом кодом номере клиента и явном согласии в Настройках ›
 *     Уведомления (whatsapp_links, kind 'client'; номер предлагается из
 *     profiles.phone через normalizePhone);
 *   • CRM_DIGEST_WHATSAPP ≠ '0' (аварийный выключатель оператора).
 * Клиентам мост WhatsApp Web не используется никогда.
 *
 * SMS — честная заглушка без провайдера (решение ПО: ключей нет).
 */
import type { DigestData } from './digest'
import { cloudApiConfigured } from '@/lib/whatsapp/config'
import { enqueueWhatsApp, outboxKey, sendWhatsAppNow } from '@/lib/whatsapp/outbox'
import { digestTemplate } from '@/lib/whatsapp/templates'

export interface DigestRecipient {
  userId: string
  /** E.164: для WhatsApp — подтверждённый номер из whatsapp_links. */
  phone: string | null
  /** Клиент подтвердил номер и согласился получать дайджест в WhatsApp. */
  whatsappOptIn?: boolean
}

export interface DigestMessage {
  title: string
  body: string
  /** Числа дайджеста — переменные шаблона WhatsApp. */
  data?: DigestData
  /** День дайджеста (YYYY-MM-DD, UTC) — ключ идемпотентности. */
  day?: string
}

export interface DigestChannel {
  key: 'whatsapp' | 'sms'
  isEnabled(r: DigestRecipient): boolean
  send(r: DigestRecipient, m: DigestMessage): Promise<boolean>
}

function isE164(p: string | null | undefined): p is string {
  return typeof p === 'string' && /^\+[1-9]\d{7,14}$/.test(p)
}

export const whatsappChannel: DigestChannel = {
  key: 'whatsapp',
  isEnabled(r) {
    return (
      process.env.CRM_DIGEST_WHATSAPP?.trim() !== '0' &&
      cloudApiConfigured() &&
      r.whatsappOptIn === true &&
      isE164(r.phone)
    )
  },
  /** true — Meta приняла сообщение (иначе оно осталось в очереди на повтор или не ушло). */
  async send(r, m) {
    if (!this.isEnabled(r) || !isE164(r.phone) || !m.data) return false
    try {
      const day = m.day ?? new Date().toISOString().slice(0, 10)
      const row = await enqueueWhatsApp({
        idempotencyKey: outboxKey('digest', r.userId, day),
        kind: 'client',
        userId: r.userId,
        phoneE164: r.phone,
        payload: digestTemplate(m.data),
        level: 'INFO',
      })
      if (!row.created) return false
      const res = await sendWhatsAppNow([row.id])
      return (res?.sent ?? 0) > 0
    } catch (err) {
      console.error('[digest] whatsapp enqueue failed:', err instanceof Error ? err.message.split('\n')[0] : 'error')
      return false
    }
  },
}

let smsWarned = false
export const smsChannel: DigestChannel = {
  key: 'sms',
  isEnabled() {
    // Провайдера нет — даже при флаге канал честно ничего не шлёт.
    return process.env.CRM_DIGEST_SMS === '1'
  },
  async send() {
    if (!smsWarned) {
      console.warn('[digest] SMS канал включён флагом, но провайдер не настроен — no-op')
      smsWarned = true
    }
    return false
  },
}

export const EXTRA_DIGEST_CHANNELS: DigestChannel[] = [whatsappChannel, smsChannel]
