/**
 * Signed callback data for Telegram approval buttons.
 *
 *   ap:<approval uuid>:<a|r>:<signature>      (≤ 64 bytes, Telegram's limit)
 *
 * The signature is HMAC-SHA256(secret, "<id>:<action>") truncated to 16 bytes
 * and base64url-encoded. It proves the button was produced by this server, so
 * a crafted callback cannot name an arbitrary approval or flip the action. It
 * does NOT authorise the presser — the webhook still checks that the Telegram
 * user is linked staff with `approvals.decide`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type CallbackAction = 'approve' | 'reject'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Signing keys in priority order: TELEGRAM_CALLBACK_SECRET, the admin bot's
 * webhook secret, the client bot's. New buttons are signed with the first;
 * a press is accepted with any, so configuring the admin bot does not
 * invalidate cards already sent.
 */
function secrets(): string[] {
  const all = [
    process.env.TELEGRAM_CALLBACK_SECRET?.trim(),
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET?.trim(),
    process.env.TELEGRAM_WEBHOOK_SECRET?.trim(),
  ].filter((k): k is string => Boolean(k))
  return [...new Set(all)]
}

function sign(key: string, approvalId: string, action: 'a' | 'r'): string {
  return createHmac('sha256', key).update(`${approvalId}:${action}`).digest().subarray(0, 16).toString('base64url')
}

export function approvalCallbackData(approvalId: string, action: CallbackAction): string | null {
  const key = secrets()[0]
  if (!key || !UUID.test(approvalId)) return null
  const a = action === 'approve' ? 'a' : 'r'
  return `ap:${approvalId.toLowerCase()}:${a}:${sign(key, approvalId.toLowerCase(), a)}`
}

export function parseApprovalCallback(data: string): { approvalId: string; action: CallbackAction } | null {
  const keys = secrets()
  if (!keys.length) return null
  const m = data.match(/^ap:([0-9a-f-]{36}):([ar]):([A-Za-z0-9_-]{22})$/)
  if (!m || !UUID.test(m[1])) return null
  const got = Buffer.from(m[3])
  const valid = keys.some((key) => {
    const expected = Buffer.from(sign(key, m[1], m[2] as 'a' | 'r'))
    return expected.length === got.length && timingSafeEqual(expected, got)
  })
  if (!valid) return null
  return { approvalId: m[1], action: m[2] === 'a' ? 'approve' : 'reject' }
}
