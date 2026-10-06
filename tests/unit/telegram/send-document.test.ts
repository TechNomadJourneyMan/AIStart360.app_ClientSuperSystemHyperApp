/**
 * sendDocument (lib/telegram/bots/registry.ts) — per the Bot API
 * (https://core.telegram.org/bots/api#senddocument, «Sending files»): a
 * multipart/form-data POST to /bot<token>/sendDocument with chat_id, the file
 * part `document` (file name + type), caption + parse_mode (≤ 1024 visible
 * characters) and reply_markup as a JSON-serialized object; 50 MB limit; the
 * token never appears in errors. There was no file upload before 103.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sendDocument, TG_CAPTION_LIMIT, TG_DOCUMENT_MAX_BYTES } from '@/lib/telegram/bots/registry'

const TOKEN = '123456:EXPERT-secret-token'
const saved = process.env.TELEGRAM_EXPERT_BOT_TOKEN
beforeAll(() => { process.env.TELEGRAM_EXPERT_BOT_TOKEN = TOKEN })
afterAll(() => { if (saved === undefined) delete process.env.TELEGRAM_EXPERT_BOT_TOKEN; else process.env.TELEGRAM_EXPERT_BOT_TOKEN = saved })

function capture(response: unknown = { ok: true, result: { message_id: 77 } }, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(response), { status })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const PDF = Buffer.from('%PDF-1.7 test document body')
const markup = { inline_keyboard: [[{ text: '✅ Подтвердить и опубликовать', callback_data: 'rr.ok|x|sig' }]] }

describe('sendDocument', () => {
  it('posts multipart/form-data with the file part, caption, parse_mode and JSON reply_markup', async () => {
    const t = capture()
    const res = await sendDocument('expert', '42', { filename: 'aistart360-point_a-v3-2026-10-06-review.pdf', bytes: PDF, mime: 'application/pdf' }, '<b>Отчёт</b> на проверке', markup, t.fetchImpl)
    expect(res).toEqual({ ok: true, result: { message_id: 77 } })
    expect(t.calls).toHaveLength(1)
    const { url, init } = t.calls[0]
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendDocument`)
    expect(init.method).toBe('POST')
    // fetch sets "multipart/form-data; boundary=…" itself for a FormData body: no JSON content type.
    expect(init.headers).toBeUndefined()
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('chat_id')).toBe('42')
    const file = form.get('document') as File
    expect(file).toBeInstanceOf(Blob)
    expect(file.name).toBe('aistart360-point_a-v3-2026-10-06-review.pdf')
    expect(file.type).toBe('application/pdf')
    expect(Buffer.from(await file.arrayBuffer()).equals(PDF)).toBe(true)
    expect(form.get('caption')).toBe('<b>Отчёт</b> на проверке')
    expect(form.get('parse_mode')).toBe('HTML')
    expect(JSON.parse(String(form.get('reply_markup')))).toEqual(markup)

    // A real multipart encoding is produced from it.
    const encoded = new Response(form)
    expect(encoded.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
    const raw = await encoded.text()
    expect(raw).toContain('name="document"; filename="aistart360-point_a-v3-2026-10-06-review.pdf"')
    expect(raw).toContain('Content-Type: application/pdf')
  })

  it('keeps the caption within 1024 visible characters and sanitises the file name', async () => {
    const t = capture()
    await sendDocument('expert', '42', { filename: 'a/b"c\r\n.pdf', bytes: PDF, mime: 'application/pdf' }, `<b>${'я'.repeat(3000)}</b>`, null, t.fetchImpl)
    const form = t.calls[0].init.body as FormData
    const caption = String(form.get('caption'))
    expect(caption.replace(/<[^>]+>/g, '').length).toBeLessThanOrEqual(TG_CAPTION_LIMIT)
    expect(caption.endsWith('</b>')).toBe(true)
    expect((form.get('document') as File).name).toBe('a_b_c__.pdf')
    expect(form.get('reply_markup')).toBeNull()
  })

  it('never puts the token into an error and never throws', async () => {
    const t = capture({ ok: false, description: `Bad Request: wrong bot ${TOKEN}` }, 400)
    const res = await sendDocument('expert', '42', { filename: 'r.pdf', bytes: PDF, mime: 'application/pdf' }, null, null, t.fetchImpl)
    expect(res).toEqual({ ok: false, status: 400, description: 'Bad Request: wrong bot ***' })

    const broken = (async () => { throw new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}`) }) as unknown as typeof fetch
    const net = await sendDocument('expert', '42', { filename: 'r.pdf', bytes: PDF, mime: 'application/pdf' }, null, null, broken)
    expect(net).toEqual({ ok: false, status: 0, description: 'network error' })
  })

  it('refuses before the network: no token, empty or oversized file', async () => {
    const t = capture()
    delete process.env.TELEGRAM_EXPERT_BOT_TOKEN
    expect((await sendDocument('expert', '42', { filename: 'r.pdf', bytes: PDF, mime: 'application/pdf' }, null, null, t.fetchImpl)).ok).toBe(false)
    process.env.TELEGRAM_EXPERT_BOT_TOKEN = TOKEN
    expect((await sendDocument('expert', '42', { filename: 'r.pdf', bytes: new Uint8Array(0), mime: 'application/pdf' }, null, null, t.fetchImpl)).ok).toBe(false)
    const big = { byteLength: TG_DOCUMENT_MAX_BYTES + 1 } as unknown as Uint8Array
    expect(await sendDocument('expert', '42', { filename: 'r.pdf', bytes: big, mime: 'application/pdf' }, null, null, t.fetchImpl)).toMatchObject({ ok: false, description: expect.stringContaining('50 MB') })
    expect(t.calls).toHaveLength(0)
  })
})
