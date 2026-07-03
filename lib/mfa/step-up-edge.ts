// ─────────────────────────────────────────────────────────────────────────────
// Edge-safe verifier for the MFA step-up cookie. This is the ONLY MFA step-up
// module `middleware.ts` (Edge runtime) may import: it uses Web Crypto
// (`crypto.subtle`) exclusively, with NO reference to `node:crypto` (which would
// break the Edge build). The Node signer/verifier lives in `step-up.ts`.
//
// Token format (shared): base64url(`${userId}.${expMs}`) "." hex(HMAC-SHA256).
// ─────────────────────────────────────────────────────────────────────────────

export const MFA_COOKIE_NAME = 'aistart360_mfa'

function base64UrlToString(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return atob(padded)
}

async function hmacSha256HexEdge(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  const bytes = new Uint8Array(sig)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Verify the step-up cookie on the Edge runtime. Fails closed when unset. */
export async function verifyStepUpEdge(token: string | undefined | null, userId: string): Promise<boolean> {
  try {
    if (!token) return false
    const dot = token.lastIndexOf('.')
    if (dot <= 0) return false
    const payload = base64UrlToString(token.slice(0, dot))
    const providedSig = token.slice(dot + 1)

    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.GIGA_COOKIE_SECRET
    if (!secret) return false

    const expected = await hmacSha256HexEdge(secret, payload)
    if (!constantTimeEqual(expected, providedSig)) return false

    const [uid, expStr] = payload.split('.')
    return uid === userId && Number(expStr) > Date.now()
  } catch {
    return false
  }
}
