import crypto from 'node:crypto'

/**
 * Short-lived HMAC token for authenticating TRUSTED server-to-server calls
 * between our own API routes (e.g. `diagnostics/recalculate` → `ai-analyze`).
 *
 * Background: several internal endpoints run heavy, paid AI work and must never
 * be callable by an anonymous external client. But the fan-out `fetch()` from
 * one route to another does NOT forward the user's Supabase cookies, so we can't
 * rely on the session there. We therefore mint a signed, expiring token from
 * AUTH_SECRET (already present in every environment) and verify it in constant
 * time. This mirrors the HMAC pattern already used by `lib/giga-cookie.ts`.
 *
 * Token format:  base64url(expiryMs) "." hex(HMAC_SHA256(expiryMs))
 */

export const INTERNAL_TOKEN_HEADER = 'x-internal-token'

function secret(): string {
  const s =
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.GIGA_COOKIE_SECRET
  if (!s) {
    // Fail closed: without a secret we cannot produce/verify a trustworthy
    // signature, so no internal token will ever validate.
    throw new Error('AUTH_SECRET (or NEXTAUTH_SECRET/GIGA_COOKIE_SECRET) is not set — cannot sign internal tokens')
  }
  return s
}

/** Mint a token valid for `ttlMs` (default 5 minutes). */
export function signInternalToken(ttlMs = 5 * 60_000): string {
  const exp = String(Date.now() + ttlMs)
  const sig = crypto.createHmac('sha256', secret()).update(exp).digest('hex')
  return `${Buffer.from(exp).toString('base64url')}.${sig}`
}

/** Verify a token: correct signature AND not expired. Never throws. */
export function verifyInternalToken(token: string | null | undefined): boolean {
  try {
    if (!token) return false
    const [expB64, sig] = token.split('.')
    if (!expB64 || !sig) return false
    const exp = Buffer.from(expB64, 'base64url').toString('utf8')
    const expected = crypto.createHmac('sha256', secret()).update(exp).digest('hex')
    const a = Buffer.from(sig, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
    const expMs = Number(exp)
    return Number.isFinite(expMs) && Date.now() < expMs
  } catch {
    return false
  }
}

/** True when the incoming request carries a valid internal token. */
export function hasValidInternalToken(req: Request): boolean {
  return verifyInternalToken(req.headers.get(INTERNAL_TOKEN_HEADER))
}

/** Headers for an outgoing internal fetch (JSON body + fresh token). */
export function internalFetchHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: signInternalToken(), ...extra }
}
