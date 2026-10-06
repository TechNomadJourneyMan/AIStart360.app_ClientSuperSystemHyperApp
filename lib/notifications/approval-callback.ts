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

function secret(): string | null {
  return process.env.TELEGRAM_CALLBACK_SECRET?.trim() || process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null
}

function sign(key: string, approvalId: string, action: 'a' | 'r'): string {
  return createHmac('sha256', key).update(`${approvalId}:${action}`).digest().subarray(0, 16).toString('base64url')
}

export function approvalCallbackData(approvalId: string, action: CallbackAction): string | null {
  const key = secret()
  if (!key || !UUID.test(approvalId)) return null
  const a = action === 'approve' ? 'a' : 'r'
  return `ap:${approvalId.toLowerCase()}:${a}:${sign(key, approvalId.toLowerCase(), a)}`
}

export function parseApprovalCallback(data: string): { approvalId: string; action: CallbackAction } | null {
  const key = secret()
  if (!key) return null
  const m = data.match(/^ap:([0-9a-f-]{36}):([ar]):([A-Za-z0-9_-]{22})$/)
  if (!m || !UUID.test(m[1])) return null
  const expected = Buffer.from(sign(key, m[1], m[2] as 'a' | 'r'))
  const got = Buffer.from(m[3])
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null
  return { approvalId: m[1], action: m[2] === 'a' ? 'approve' : 'reject' }
}
