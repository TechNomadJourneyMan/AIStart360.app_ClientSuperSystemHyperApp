import crypto from 'node:crypto'

/**
 * Signed "step-up" cookie proving the user passed the MFA challenge for the
 * CURRENT session. HMAC-SHA256 over `${userId}.${expiryMs}` with AUTH_SECRET.
 * Node runtime (API routes). Middleware uses the Web-Crypto verifier in
 * `step-up-edge.ts`. Same token format.
 */

export const MFA_COOKIE_NAME = 'aistart360_mfa'
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000 // 12h

export const MFA_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: DEFAULT_TTL_MS / 1000,
}

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.GIGA_COOKIE_SECRET
  if (!s) throw new Error('AUTH_SECRET (or NEXTAUTH_SECRET/GIGA_COOKIE_SECRET) is not set — cannot sign MFA cookie')
  return s
}

/** token = base64url(`${userId}.${expMs}`) "." hex(HMAC). */
export function signStepUp(userId: string, ttlMs = DEFAULT_TTL_MS): string {
  const payload = `${userId}.${Date.now() + ttlMs}`
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex')
  return `${Buffer.from(payload).toString('base64url')}.${sig}`
}

/** Valid signature, not expired, AND bound to this user. */
export function verifyStepUp(token: string | null | undefined, userId: string): boolean {
  try {
    if (!token) return false
    const [pB64, sig] = token.split('.')
    if (!pB64 || !sig) return false
    const payload = Buffer.from(pB64, 'base64url').toString('utf8')
    const expected = crypto.createHmac('sha256', secret()).update(payload).digest('hex')
    const a = Buffer.from(sig, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
    const [uid, expStr] = payload.split('.')
    return uid === userId && Number(expStr) > Date.now()
  } catch {
    return false
  }
}
