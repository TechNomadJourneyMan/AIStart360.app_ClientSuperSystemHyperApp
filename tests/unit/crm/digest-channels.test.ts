/**
 * tests/unit/crm/digest-channels.test.ts — гейтинг доп-каналов дайджеста (4C, W6).
 * WhatsApp требует Cloud API + подтверждённый номер + явное согласие клиента;
 * CRM_DIGEST_WHATSAPP=0 — аварийный выключатель. Отправка через очередь
 * проверяется на реальной БД (tests/integration/db/whatsapp-channel.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { whatsappChannel, smsChannel } from '@/lib/crm/digest-channels'

describe('digest extra channels — gating', () => {
  const OLD = { ...process.env }
  beforeEach(() => {
    delete process.env.CRM_DIGEST_WHATSAPP
    delete process.env.WHATSAPP_TOKEN
    delete process.env.WHATSAPP_PHONE_NUMBER_ID
    delete process.env.CRM_DIGEST_SMS
  })
  afterEach(() => {
    process.env = { ...OLD }
  })

  it('whatsapp needs Cloud API keys, a verified E.164 number and the client opt-in', () => {
    const r = { userId: 'u', phone: '+77770000000', whatsappOptIn: true }
    expect(whatsappChannel.isEnabled(r)).toBe(false) // нет ключей
    process.env.WHATSAPP_TOKEN = 't'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'p'
    expect(whatsappChannel.isEnabled({ userId: 'u', phone: '+77770000000' })).toBe(false) // нет согласия
    expect(whatsappChannel.isEnabled({ userId: 'u', phone: '+77770000000', whatsappOptIn: false })).toBe(false)
    expect(whatsappChannel.isEnabled({ userId: 'u', phone: null, whatsappOptIn: true })).toBe(false) // нет номера
    expect(whatsappChannel.isEnabled({ userId: 'u', phone: 'not-e164', whatsappOptIn: true })).toBe(false)
    expect(whatsappChannel.isEnabled(r)).toBe(true) // всё на месте
    process.env.CRM_DIGEST_WHATSAPP = '0'
    expect(whatsappChannel.isEnabled(r)).toBe(false) // аварийный выключатель
  })

  it('whatsapp without digest numbers sends nothing (no free-form text fallback)', async () => {
    process.env.WHATSAPP_TOKEN = 't'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'p'
    expect(await whatsappChannel.send({ userId: 'u', phone: '+77770000000', whatsappOptIn: true }, { title: 't', body: 'b' })).toBe(false)
  })

  it('sms is off by default and never actually sends (no provider)', async () => {
    const r = { userId: 'u', phone: '+77770000000' }
    expect(smsChannel.isEnabled(r)).toBe(false)
    process.env.CRM_DIGEST_SMS = '1'
    expect(smsChannel.isEnabled(r)).toBe(true)
    expect(await smsChannel.send(r, { title: 't', body: 'b' })).toBe(false)
  })
})
