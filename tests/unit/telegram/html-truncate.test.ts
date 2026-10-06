/**
 * #65: a long staff notification is cut by VISIBLE text, never through an
 * entity or a tag — Telegram rejects HTML with a broken `&am` or `<a href="…`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sendMessage, truncateTelegramHtml, TG_TEXT_LIMIT } from '@/lib/telegram/bots/registry'
import { formatTelegram } from '@/lib/notifications/staff'

const visibleText = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

function balanced(html: string): boolean {
  const stack: string[] = []
  for (const m of html.matchAll(/<\s*(\/)?\s*([a-zA-Z]+)[^>]*>/g)) {
    if (m[1]) { if (stack.pop() !== m[2].toLowerCase()) return false } else stack.push(m[2].toLowerCase())
  }
  return stack.length === 0
}

let sent: Array<Record<string, unknown>> = []
const fakeFetch = (async (_url: string, init?: RequestInit) => {
  sent.push(JSON.parse(String(init?.body)))
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })
}) as unknown as typeof fetch

beforeEach(() => { sent = []; process.env.TELEGRAM_BOT_TOKEN = 't' })
afterEach(() => { delete process.env.TELEGRAM_BOT_TOKEN })

describe('Telegram HTML truncation', () => {
  it('a notification at the agent tool maximum, full of "&", goes out as valid HTML within the limit', async () => {
    const html = formatTelegram({
      level: 'CRITICAL', type: 'agent.alert', title: 'R&D '.repeat(50),
      lines: Array.from({ length: 12 }, () => 'P&L < план & > факт '.repeat(15).slice(0, 300)),
      link: '/admin-giga-panel/agents',
    })
    expect(html.length).toBeGreaterThan(TG_TEXT_LIMIT)
    await sendMessage('client', '1', html, undefined, fakeFetch)
    const text = String(sent[0].text)
    expect(visibleText(text).length).toBeLessThanOrEqual(TG_TEXT_LIMIT)
    expect(text).not.toMatch(/&[a-z]*$/)
    expect(text).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/)
    expect(text).not.toMatch(/<[^>]*$/)
    expect(balanced(text)).toBe(true)
    // Under 4000 visible characters nothing needs cutting: the panel link survives.
    expect(text.endsWith('Открыть в панели</a>')).toBe(true)
  })

  it('short messages pass unchanged; a cut inside a tag closes it', () => {
    expect(truncateTelegramHtml('<b>ok</b> &amp; done')).toBe('<b>ok</b> &amp; done')
    expect(truncateTelegramHtml('<b>abcdef</b><a href="https://x">link</a>', 4)).toBe('<b>abc…</b>')
    expect(truncateTelegramHtml('a&amp;b&amp;c&amp;d', 4)).toBe('a&amp;b…')
    const long = `<b>${'x&amp;'.repeat(3000)}</b>\n<a href="https://p/x">Открыть</a>`
    const cut = truncateTelegramHtml(long)
    expect(visibleText(cut).length).toBeLessThanOrEqual(TG_TEXT_LIMIT)
    expect(balanced(cut)).toBe(true)
    expect(cut.endsWith('…</b>')).toBe(true)
  })
})
