/**
 * lib/crm/digest-channels.ts — дополнительные каналы дайджеста за env-флагами
 * (Фаза 4C). WhatsApp — реальная отправка через Graph API, но ТОЛЬКО при полном
 * наборе ключей + флаге + E.164 телефоне владельца (иначе выключен). SMS —
 * честная заглушка без провайдера (решение ПО: ключей нет). Подключаются в
 * cron-дайджест ПОСЛЕ email/telegram; isEnabled коротко замыкается на флагах,
 * так что выключенные каналы не добавляют латентности.
 *
 * NB: вне 24-часового окна WhatsApp требует approved-шаблон Meta — здесь текст
 * отправляется как обычное сообщение; для прод-рассылки нужен template.
 */

export interface DigestRecipient {
  userId: string
  /** E.164 телефон владельца (если известен) — цель WhatsApp/SMS. */
  phone: string | null
}

export interface DigestMessage {
  title: string
  body: string
}

export interface DigestChannel {
  key: 'whatsapp' | 'sms'
  isEnabled(r: DigestRecipient): boolean
  send(r: DigestRecipient, m: DigestMessage): Promise<boolean>
}

function isE164(p: string | null | undefined): p is string {
  return typeof p === 'string' && /^\+\d{8,15}$/.test(p)
}

export const whatsappChannel: DigestChannel = {
  key: 'whatsapp',
  isEnabled(r) {
    return (
      process.env.CRM_DIGEST_WHATSAPP === '1' &&
      Boolean(process.env.WHATSAPP_TOKEN) &&
      Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID) &&
      isE164(r.phone)
    )
  },
  async send(r, m) {
    if (!this.isEnabled(r) || !isE164(r.phone)) return false
    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: r.phone,
            type: 'text',
            text: { body: `${m.title}\n\n${m.body}` },
          }),
          signal: AbortSignal.timeout(5000),
        },
      )
      return res.ok
    } catch {
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
