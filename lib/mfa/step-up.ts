import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { stepUpSessionKeyFromCookies } from './session-binding'

/**
 * Signed "step-up" cookie proving the user passed the MFA challenge in the
 * CURRENT Supabase session. Node runtime (API routes). Middleware uses the
 * Web-Crypto verifier in `step-up-edge.ts`. Same token format:
 *
 *   base64url(`v2.${userId}.${sessionKey}.${expiryMs}`) "." hex(HMAC-SHA256)
 *
 * `sessionKey` is the GoTrue `session_id` of the access token
 * (lib/mfa/session-binding.ts). R-132: the proof used to name the user only, so
 * it outlived a sign-out — a later sign-in of the same account on that browser
 * skipped the second factor. Every sign-in is a new session, so now it does
 * not. Proofs in the old `${userId}.${expiryMs}` format are refused (users pass
 * the second factor once more after the release).
 */

export const MFA_COOKIE_NAME = 'aistart360_mfa'
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000 // 12h
const VERSION = 'v2'

export const MFA_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: DEFAULT_TTL_MS / 1000,
}

/** Options that delete the step-up cookie. */
export const MFA_COOKIE_CLEAR_OPTIONS = { ...MFA_COOKIE_OPTIONS, maxAge: 0 }

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.GIGA_COOKIE_SECRET
  if (!s) throw new Error('AUTH_SECRET (or NEXTAUTH_SECRET/GIGA_COOKIE_SECRET) is not set — cannot sign MFA cookie')
  return s
}

const KEY_RE = /^[A-Za-z0-9-]{1,64}$/

/**
 * The step-up binding key of the session of the request being served, read
 * from its Supabase auth cookie (next/headers). null outside a request or
 * without a session — every check then fails closed.
 */
export function currentStepUpSessionKey(): string | null {
  try {
    return stepUpSessionKeyFromCookies(cookies().getAll())
  } catch {
    return null
  }
}

/** Mint a proof for `userId` in session `sessionKey` (never without a session). */
export function signStepUp(userId: string, sessionKey: string, ttlMs = DEFAULT_TTL_MS): string {
  if (!userId || !sessionKey || !KEY_RE.test(sessionKey) || userId.includes('.')) {
    throw new Error('signStepUp: a user id and a session key are required')
  }
  const payload = `${VERSION}.${userId}.${sessionKey}.${Date.now() + ttlMs}`
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex')
  return `${Buffer.from(payload).toString('base64url')}.${sig}`
}

/**
 * Valid signature, not expired, AND bound to this user AND this session.
 * `sessionKey` omitted → the session of the current request (next/headers);
 * existing callers that pass only the user id are therefore session-bound too.
 */
export function verifyStepUp(token: string | null | undefined, userId: string, sessionKey?: string | null): boolean {
  try {
    if (!token) return false
    const key = sessionKey === undefined ? currentStepUpSessionKey() : sessionKey
    if (!key) return false
    const [pB64, sig] = token.split('.')
    if (!pB64 || !sig) return false
    const payload = Buffer.from(pB64, 'base64url').toString('utf8')
    const expected = crypto.createHmac('sha256', secret()).update(payload).digest('hex')
    const a = Buffer.from(sig, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
    const parts = payload.split('.')
    if (parts.length !== 4 || parts[0] !== VERSION) return false
    const [, uid, sk, expStr] = parts
    return uid === userId && sk === key && Number(expStr) > Date.now()
  } catch {
    return false
  }
}
