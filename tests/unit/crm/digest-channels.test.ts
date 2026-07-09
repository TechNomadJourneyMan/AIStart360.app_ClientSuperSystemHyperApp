/**
 * tests/unit/crm/digest-channels.test.ts — гейтинг доп-каналов дайджеста (4C).
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

  it('whatsapp stays off until flag + keys + E.164 phone are all present', () => {
    const r = { userId: 'u', phone: '+77770000000' }
    expect(whatsappChannel.isEnabled(r)).toBe(false)
    process.env.CRM_DIGEST_WHATSAPP = '1'
    expect(whatsappChannel.isEnabled(r)).toBe(false) // нет ключей
    process.env.WHATSAPP_TOKEN = 't'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'p'
    expect(whatsappChannel.isEnabled({ userId: 'u', phone: null })).toBe(false) // нет телефона
    expect(whatsappChannel.isEnabled({ userId: 'u', phone: 'not-e164' })).toBe(false)
    expect(whatsappChannel.isEnabled(r)).toBe(true) // всё на месте
  })

  it('sms is off by default and never actually sends (no provider)', async () => {
    const r = { userId: 'u', phone: '+77770000000' }
    expect(smsChannel.isEnabled(r)).toBe(false)
    process.env.CRM_DIGEST_SMS = '1'
    expect(smsChannel.isEnabled(r)).toBe(true)
    expect(await smsChannel.send(r, { title: 't', body: 'b' })).toBe(false)
  })
})
