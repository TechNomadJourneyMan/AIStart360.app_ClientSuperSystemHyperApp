/**
 * Test harness for the Telegram bots: a recording Bot API (no network), deps
 * with an in-memory state store and an audit spy, and update builders.
 */
import { vi } from 'vitest'
import type { BotDeps, TgUpdate } from '@/lib/telegram/bots/dispatcher'
import { memoryStateStore } from '@/lib/telegram/bots/store'

export interface TgCall { url: string; method: string; body: Record<string, any> }

/**
 * A multipart body (sendDocument) as a plain object: text fields as strings,
 * `reply_markup` parsed back from its JSON, files as { name, type, size }.
 */
export function formFields(form: FormData): Record<string, any> {
  const out: Record<string, any> = {}
  form.forEach((value, key) => {
    if (typeof value === 'string') out[key] = key === 'reply_markup' ? JSON.parse(value) : value
    else out[key] = { name: (value as File).name, type: value.type, size: value.size }
  })
  return out
}

export function recordingFetch(opts: { failMethods?: string[] } = {}) {
  const calls: TgCall[] = []
  let messageId = 1000
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const method = u.split('/').pop()!
    const body = init?.body instanceof FormData ? formFields(init.body) : JSON.parse(String(init?.body ?? '{}'))
    calls.push({ url: u, method, body })
    if (opts.failMethods?.includes(method)) {
      return new Response(JSON.stringify({ ok: false, description: 'Bad Request: message can\'t be deleted' }), { status: 400 })
    }
    const result = method === 'sendMessage' || method === 'sendDocument' ? { message_id: ++messageId } : true
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 })
  }) as unknown as typeof fetch
  return {
    fetchImpl,
    calls,
    sent: () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText'),
    texts: () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => String(c.body.text)),
    lastText: () => {
      const s = calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText')
      return String(s[s.length - 1]?.body.text ?? '')
    },
    /** callback_data of every inline button in the last message carrying a keyboard. */
    lastButtons: () => {
      const s = calls.filter((c) => c.body.reply_markup?.inline_keyboard)
      const kb = (s[s.length - 1]?.body.reply_markup?.inline_keyboard ?? []) as Array<Array<{ text: string; callback_data?: string; url?: string }>>
      return kb.flat()
    },
    reset: () => { calls.length = 0 },
  }
}

export function testDeps(fetchImpl: typeof fetch, overrides: Partial<BotDeps> = {}) {
  const state = memoryStateStore()
  const audit = vi.fn(async () => true)
  const rateLimit = vi.fn(async () => false)
  const deps: BotDeps = { fetchImpl, state, audit, rateLimit, now: () => new Date('2026-10-06T07:00:00Z'), ...overrides }
  return { deps, state, audit, rateLimit }
}

let updateId = 1
export const TG_USER = { id: 555_000_111, username: 'staffer', first_name: 'Ива' }

export function msg(text: string, from = TG_USER, extra: Record<string, unknown> = {}): TgUpdate {
  return { update_id: updateId++, message: { message_id: 7000 + updateId, chat: { id: from.id, type: 'private' }, from, text, ...extra } }
}

export function press(data: string | null | undefined, from = TG_USER, messageId = 4242): TgUpdate {
  return { update_id: updateId++, callback_query: { id: `cb${updateId}`, from, data: data ?? undefined, message: { message_id: messageId, chat: { id: from.id } } } }
}

/** Find the callback_data of a button whose text includes `label`. */
export function buttonData(buttons: Array<{ text: string; callback_data?: string }>, label: string): string {
  const b = buttons.find((x) => x.text.includes(label))
  if (!b?.callback_data) throw new Error(`button "${label}" not found in [${buttons.map((x) => x.text).join(', ')}]`)
  return b.callback_data
}
