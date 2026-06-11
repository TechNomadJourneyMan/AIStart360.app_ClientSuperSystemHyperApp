// ─────────────────────────────────────────────────────────────────────────────
// Edge-safe verifier for the signed giga super-admin cookie (audit A2b).
//
// This module is the ONLY giga-cookie module that `middleware.ts` (Edge runtime)
// may import. It uses Web Crypto (`crypto.subtle`) exclusively and contains NO
// reference to `node:crypto` — a `node:crypto` reference anywhere in a module
// imported by middleware breaks the Edge webpack build ("Reading from node:crypto
// is not handled"). The Node sync signing/verification lives in `lib/giga-cookie.ts`
// and is imported only by Node-runtime API route handlers.
//
// Token format (shared with the Node module): `<role>.<base64url-hmac-sha256>`.
// ─────────────────────────────────────────────────────────────────────────────

export const GIGA_COOKIE_NAME = 'aistart360_giga'

function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacSha256Edge(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return new Uint8Array(sig)
}

function constantTimeEqualBytesEdge(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * Verify a signed giga token on the Edge runtime (middleware). Async because
 * Web Crypto's `subtle.sign` is promise-based. Returns the role or null.
 * Fails closed when the signing secret is absent.
 */
export async function verifyGigaRoleEdge(
  cookieValue: string | undefined | null,
): Promise<string | null> {
  if (!cookieValue) return null
  const dot = cookieValue.lastIndexOf('.')
  if (dot <= 0) return null
  const role = cookieValue.slice(0, dot)
  const providedSig = cookieValue.slice(dot + 1)

  const secret =
    process.env.GIGA_COOKIE_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET
  if (!secret) return null

  const expected = await hmacSha256Edge(secret, role)
  let provided: Uint8Array
  try {
    provided = base64UrlToBytes(providedSig)
  } catch {
    return null
  }
  return constantTimeEqualBytesEdge(expected, provided) ? role : null
}
