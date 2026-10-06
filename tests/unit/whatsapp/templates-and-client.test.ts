/**
 * WhatsApp notification templates and the Cloud API request they become.
 *
 *  • every template sends exactly as many body variables as its approved body
 *    has placeholders (a mismatch is a Meta 132000-family rejection);
 *  • variables never contain new lines / tabs / long space runs (Meta rule);
 *  • the request matches the Cloud API template message shape
 *    (POST /{version}/{phone-number-id}/messages, type "template", body +
 *    button components) — built through an injected fetch, nothing leaves the box;
 *  • failure classification: a timeout after the send is "delivery unknown",
 *    never a blind retry.
 */
import { describe, expect, it } from 'vitest'
import { createMetaClient, DEFAULT_META_GRAPH_API_VERSION } from '@/lib/omnichannel/meta-client'
import {
  WHATSAPP_TEMPLATES, digestTemplate, expertNotificationTemplate, phoneVerificationTemplate,
  reportReviewTemplate, sanitizeParam, staffAlertTemplate, urlSuffix, type TemplatePayload,
} from '@/lib/whatsapp/templates'
import { classifyFailure, outboxKey } from '@/lib/whatsapp/outbox'
import { maskPhone } from '@/lib/whatsapp/config'

function placeholders(body: string): number {
  return new Set(body.match(/\{\{\d+\}\}/g) ?? []).size
}

const payloads: TemplatePayload[] = [
  digestTemplate({ overdue: 3, sleeping: 5, weakBlock: { label: 'Операции', score: 2.345 } }),
  expertNotificationTemplate({ title: 'Диагностика завершена', lines: ['Клиент: Ромашка', 'Точка А: 64/100'], path: '/expert/clients/u1' }),
  reportReviewTemplate({ title: 'Диагностика', version: 3, date: '06.10.2026', client: 'Ромашка' }),
  staffAlertTemplate({ levelLabel: 'Внимание', title: 'Агент упал', lines: ['a\nb', 'c\t\td'], path: '/admin-giga-panel/agents/tasks/1' }),
  phoneVerificationTemplate('123456'),
]

describe('whatsapp templates', () => {
  it('sends one body variable per placeholder of the approved body, never at the body edges', () => {
    for (const p of payloads) {
      const def = WHATSAPP_TEMPLATES[p.template]
      expect(p.body).toHaveLength(placeholders(def.body))
      expect(def.examples).toHaveLength(def.variables.length)
      if (def.category === 'UTILITY') {
        expect(def.body.trimStart().startsWith('{{')).toBe(false)
        expect(def.body.trimEnd().endsWith('}}')).toBe(false)
      }
    }
  })

  it('every URL-button template carries one button suffix; authentication carries the code twice', () => {
    for (const p of payloads) {
      const def = WHATSAPP_TEMPLATES[p.template]
      expect(p.buttons).toHaveLength(1)
      if (def.button.type === 'copy_code') expect(p.buttons[0].text).toBe(p.body[0])
      else expect(p.buttons[0].text.startsWith('/')).toBe(false)
    }
  })

  it('variables obey the Meta parameter rules', () => {
    for (const p of payloads) {
      for (const v of [...p.body, ...p.buttons.map((b) => b.text)]) {
        expect(v).not.toMatch(/[\n\r\t]/)
        expect(v).not.toMatch(/ {5,}/)
        expect(v.length).toBeGreaterThan(0)
        expect(v).toBe(v.trim())
      }
    }
    expect(sanitizeParam('  a\n\nb\t c     d  ')).toBe('a · b · c d')
    expect(sanitizeParam('')).toBe('—')
    expect(sanitizeParam('x'.repeat(500), 10)).toHaveLength(10)
  })

  it('url suffixes are relative paths; absolute or broken links fall back', () => {
    expect(urlSuffix('/admin-giga-panel/reports?focus=1', 'x')).toBe('admin-giga-panel/reports?focus=1')
    expect(urlSuffix('https://evil.example/x', 'expert')).toBe('expert')
    expect(urlSuffix('', 'expert')).toBe('expert')
    expect(urlSuffix('a b', 'expert')).toBe('expert')
  })

  it('outbox keys stay inside the column alphabet and stay unique', () => {
    expect(outboxKey('staff', 'e1e1e1e1', 'u')).toBe('staff:e1e1e1e1:u')
    const a = outboxKey('expert', 'report published:Отчёт №1', 'u1')
    const b = outboxKey('expert', 'report published:Отчёт №2', 'u1')
    expect(a).toMatch(/^[A-Za-z0-9._:-]{8,200}$/)
    expect(a).not.toBe(b)
    expect(outboxKey('x'.repeat(400))).toMatch(/^[A-Za-z0-9._:-]{8,200}$/)
  })

  it('masks phone numbers for logs', () => {
    expect(maskPhone('+77001234567')).toBe('+7700•••4567')
    expect(maskPhone(null)).toBe('—')
  })
})

describe('Cloud API template request (fetch injection)', () => {
  it('matches the documented template message shape', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = createMetaClient({
      env: { WHATSAPP_TOKEN: 'tok-secret', WHATSAPP_PHONE_NUMBER_ID: '1234567890' },
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} })
        return new Response(JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ input: '77001234567', wa_id: '77001234567' }], messages: [{ id: 'wamid.ABC' }] }), { status: 200 })
      },
    })
    const p = staffAlertTemplate({ levelLabel: 'Критично', title: 'Сбой', lines: ['Агент: x'], path: '/admin-giga-panel/agents' })
    const res = await client.sendWhatsAppTemplate({
      recipientId: '77001234567', templateName: p.template, languageCode: 'ru', bodyParameters: p.body, buttonParameters: p.buttons,
    })
    expect(res).toEqual({ ok: true, externalMessageId: 'wamid.ABC', rawStatus: 200 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`https://graph.facebook.com/${DEFAULT_META_GRAPH_API_VERSION}/1234567890/messages`)
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-secret')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '77001234567',
      type: 'template',
      template: {
        name: 'staff_alert',
        language: { policy: 'deterministic', code: 'ru' },
        components: [
          { type: 'body', parameters: p.body.map((text) => ({ type: 'text', text })) },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'admin-giga-panel/agents' }] },
        ],
      },
    })
  })

  it('rejects malformed button parameters locally (request never sent)', async () => {
    let called = false
    const client = createMetaClient({
      env: { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' },
      fetch: async () => { called = true; return new Response('{}') },
    })
    const res = await client.sendWhatsAppTemplate({
      recipientId: '77001234567', templateName: 'digest', languageCode: 'ru', bodyParameters: ['1'], buttonParameters: [{ index: 0, text: ' x' }],
    })
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.requestSent).toBe(false)
    expect(called).toBe(false)
  })

  it('a timeout is reported as possibly sent; a refused connection as not sent', async () => {
    const timeoutClient = createMetaClient({
      env: { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' },
      timeoutMs: 5,
      fetch: (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    })
    const t = await timeoutClient.sendWhatsAppTemplate({ recipientId: '77001234567', templateName: 'digest', languageCode: 'ru', bodyParameters: ['1'] })
    expect(t.ok).toBe(false)
    if (t.ok) return
    expect(t.code).toBe('timeout')
    expect(t.requestSent).toBeUndefined()
    expect(classifyFailure(t, false).outcome).toBe('delivery_unknown')
    // The bridge deduplicates by idempotency key, so an ambiguous bridge send may be retried.
    expect(classifyFailure(t, true).outcome).toBe('retry')

    const refused = createMetaClient({
      env: { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' },
      fetch: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }) },
    })
    const r = await refused.sendWhatsAppTemplate({ recipientId: '77001234567', templateName: 'digest', languageCode: 'ru', bodyParameters: ['1'] })
    expect(r.ok === false && r.requestSent).toBe(false)
    if (!r.ok) expect(classifyFailure(r, false).outcome).toBe('retry')
  })

  it('classifies provider answers: 5xx/429 retry, 4xx permanent; stored errors are phone-free', () => {
    expect(classifyFailure({ ok: false, status: 500, code: '1', message: 'x', retryable: true }, false).outcome).toBe('retry')
    expect(classifyFailure({ ok: false, status: 429, code: '130429', message: 'x', retryable: true }, false).outcome).toBe('retry')
    const perm = classifyFailure({ ok: false, status: 400, code: '132001', message: 'Template not found for +77001234567', retryable: false }, false)
    expect(perm.outcome).toBe('failed')
    if (perm.outcome !== 'sent') expect(perm.error).not.toContain('77001234567')
  })
})
