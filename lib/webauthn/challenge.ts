import crypto from 'node:crypto'

/**
 * WebAuthn ceremonies need the server-issued random challenge to be recalled at
 * verify time. We stash it in a short-lived, HMAC-signed httpOnly cookie bound
 * to the user id + ceremony purpose — stateless, no extra table. (Node runtime;
 * these routes never run on the Edge.)
 *
 * Token: base64url(`${userId}|${purpose}|${challenge}|${expMs}`) "." hex(HMAC).
 */

export const WEBAUTHN_CHALLENGE_COOKIE = 'aistart360_wachal'
export type ChallengePurpose = 'reg' | 'auth'

export const WEBAUTHN_CHALLENGE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 5 * 60, // 5 minutes
}

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.GIGA_COOKIE_SECRET
  if (!s) throw new Error('AUTH_SECRET is not set — cannot sign WebAuthn challenge cookie')
  return s
}

export function signChallenge(userId: string, purpose: ChallengePurpose, challenge: string, ttlMs = 5 * 60_000): string {
  const payload = `${userId}|${purpose}|${challenge}|${Date.now() + ttlMs}`
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex')
  return `${Buffer.from(payload).toString('base64url')}.${sig}`
}

/** Return the stored challenge if the cookie is valid, bound to this user + purpose, and unexpired. */
export function readChallenge(token: string | null | undefined, userId: string, purpose: ChallengePurpose): string | null {
  try {
    if (!token) return null
    const [pB64, sig] = token.split('.')
    if (!pB64 || !sig) return null
    const payload = Buffer.from(pB64, 'base64url').toString('utf8')
    const expected = crypto.createHmac('sha256', secret()).update(payload).digest('hex')
    const a = Buffer.from(sig, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    const [uid, purp, challenge, expStr] = payload.split('|')
    if (uid !== userId || purp !== purpose) return null
    if (!(Number(expStr) > Date.now())) return null
    return challenge || null
  } catch {
    return null
  }
}
