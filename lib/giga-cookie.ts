// ─────────────────────────────────────────────────────────────────────────────
// Signed giga super-admin role cookie (audit A2b).
//
// Background: giga-panel access was previously granted whenever a request
// carried `cookie aistart360_role === 'super_admin'`. That cookie is an
// unsigned, static string — any user could set it manually to obtain full
// super-admin access. This module replaces that with an HMAC-signed token.
//
// COOKIE-NAMING DECISION:
//   We use a SEPARATE cookie name `aistart360_giga` for the signed giga token
//   rather than reusing `aistart360_role`. The `aistart360_role` cookie is
//   overloaded across the app: app/actions/auth.ts sets it to a *normal* user's
//   role (admin/client/expert) and many non-giga readers depend on that
//   (e.g. /api/v1/me, /api/pulse, dashboard pages). Signing/overwriting that
//   shared cookie would break normal-user flows. A dedicated cookie keeps the
//   giga gate self-contained and leaves the legacy role cookie untouched.
//
// EDGE-COMPAT DECISION:
//   Next.js middleware runs on the Edge runtime, where Node's `node:crypto`
//   (createHmac / timingSafeEqual) is unavailable. We therefore expose:
//     - signGigaRole / verifyGigaRole  → synchronous, Node `crypto`, for use
//       in API route handlers (Node runtime).
//     - verifyGigaRoleEdge             → async, Web Crypto (`crypto.subtle`),
//       for use in middleware (Edge runtime).
//   Both verify the SAME token format and use constant-time comparison.
// ─────────────────────────────────────────────────────────────────────────────

// GIGA_COOKIE_NAME and the Edge (Web Crypto) verifier live in `giga-cookie-edge.ts`
// — the single edge-safe module that middleware imports. We re-export them here so
// Node-runtime API routes can keep importing everything from one place. This module
// (with its node:crypto usage) must NEVER be imported by middleware.
export { GIGA_COOKIE_NAME, verifyGigaRoleEdge } from './giga-cookie-edge'

// IMPORTANT (edge-compat): do NOT add a top-level `import ... from 'node:crypto'`.
// This module is imported by middleware (Edge runtime), and a static node:crypto
// import would be pulled into the edge bundle and fail. The Node implementation
// loads node:crypto lazily via require() inside the sync functions only; the
// async *Edge functions use Web Crypto (globalThis.crypto.subtle) exclusively.
type NodeCrypto = typeof import('node:crypto')
function nodeCrypto(): NodeCrypto {
  return require('node:crypto') as NodeCrypto
}

function getSecret(): string {
  const secret =
    process.env.GIGA_COOKIE_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET
  if (!secret) {
    // Fail closed: without a secret we cannot produce/verify a trustworthy
    // signature, so no token will ever validate.
    throw new Error('GIGA_COOKIE_SECRET (or AUTH_SECRET/NEXTAUTH_SECRET) is not set')
  }
  return secret
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Produce a signed giga token of the form `<role>.<base64url-hmac-sha256>`.
 * (Node runtime — use from API route handlers.)
 */
export function signGigaRole(role: string): string {
  const sig = nodeCrypto().createHmac('sha256', getSecret()).update(role).digest()
  return `${role}.${toBase64Url(new Uint8Array(sig))}`
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  try {
    return nodeCrypto().timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Verify a signed giga token (Node runtime). Returns the role string if the
 * signature is valid, otherwise null.
 */
export function verifyGigaRole(cookieValue: string | undefined | null): string | null {
  if (!cookieValue) return null
  const dot = cookieValue.lastIndexOf('.')
  if (dot <= 0) return null
  const role = cookieValue.slice(0, dot)
  const providedSig = cookieValue.slice(dot + 1)

  let secret: string
  try {
    secret = getSecret()
  } catch {
    return null
  }

  const expected = new Uint8Array(nodeCrypto().createHmac('sha256', secret).update(role).digest())
  let provided: Uint8Array
  try {
    provided = base64UrlToBytes(providedSig)
  } catch {
    return null
  }
  return constantTimeEqualBytes(expected, provided) ? role : null
}
