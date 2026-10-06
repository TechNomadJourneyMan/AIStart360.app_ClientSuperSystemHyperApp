/**
 * Signed, compact callback_data for inline buttons (Telegram limit: 64 bytes).
 *
 *   <action>|<arg>|<arg>…|<sig>
 *
 * action  short route key, e.g. 'ag.c' (agent card), [a-z0-9._]{1,12}
 * args    short strings; a UUID is packed into 22 base64url chars behind '~'
 * sig     HMAC-SHA256(key, "<bot>\n<action>|<args…>") truncated to 9 bytes
 *         (12 base64url chars)
 *
 * The signature proves the button was produced by this server for THIS bot:
 * a crafted callback cannot name an arbitrary entity, change the action, or
 * replay an admin-bot button on the expert bot. It does NOT authorise the
 * presser — every handler re-checks the person's permission. Keys: the
 * dedicated TELEGRAM_CALLBACK_SECRET, else the bot's webhook secret; parsing
 * accepts any configured key so a key change does not break open cards.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { botWebhookSecret, type BotId } from './registry'

export const CALLBACK_MAX_BYTES = 64
const SIG_BYTES = 9
const SIG_CHARS = 12
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTION = /^[a-z0-9._]{1,12}$/
const ARG = /^[A-Za-z0-9_.:@+=-]{0,40}$/

function keys(bot: BotId): string[] {
  const out = [process.env.TELEGRAM_CALLBACK_SECRET?.trim(), botWebhookSecret(bot)].filter((k): k is string => Boolean(k))
  return [...new Set(out)]
}

function sign(key: string, bot: BotId, body: string): string {
  return createHmac('sha256', key).update(`${bot}\n${body}`).digest().subarray(0, SIG_BYTES).toString('base64url')
}

export function packArg(v: string): string {
  if (UUID.test(v)) return `~${Buffer.from(v.replace(/-/g, ''), 'hex').toString('base64url')}`
  return v
}

export function unpackArg(v: string): string {
  if (v.startsWith('~') && v.length === 23) {
    const hex = Buffer.from(v.slice(1), 'base64url').toString('hex')
    if (hex.length === 32) return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return v
}

/**
 * Build callback_data, or null when it cannot be signed (no key) or would not
 * fit — callers render no button rather than an unsigned one.
 */
export function signCallback(bot: BotId, action: string, ...args: Array<string | number>): string | null {
  const key = keys(bot)[0]
  if (!key || !ACTION.test(action)) return null
  const packed = args.map((a) => packArg(String(a)))
  if (packed.some((a) => !ARG.test(a) && !/^~[A-Za-z0-9_-]{22}$/.test(a))) return null
  const body = [action, ...packed].join('|')
  const data = `${body}|${sign(key, bot, body)}`
  return Buffer.byteLength(data) <= CALLBACK_MAX_BYTES ? data : null
}

export interface ParsedCallback {
  action: string
  args: string[]
}

/** Verify and decode callback_data; null when malformed or the signature does not match. */
export function verifyCallback(bot: BotId, data: string | undefined | null): ParsedCallback | null {
  if (!data || Buffer.byteLength(data) > CALLBACK_MAX_BYTES) return null
  const cut = data.lastIndexOf('|')
  if (cut <= 0) return null
  const body = data.slice(0, cut)
  const sig = data.slice(cut + 1)
  if (sig.length !== SIG_CHARS || !/^[A-Za-z0-9_-]+$/.test(sig)) return null
  const [action, ...args] = body.split('|')
  if (!ACTION.test(action)) return null
  const got = Buffer.from(sig)
  const ok = keys(bot).some((key) => {
    const expected = Buffer.from(sign(key, bot, body))
    return expected.length === got.length && timingSafeEqual(expected, got)
  })
  if (!ok) return null
  return { action, args: args.map(unpackArg) }
}
