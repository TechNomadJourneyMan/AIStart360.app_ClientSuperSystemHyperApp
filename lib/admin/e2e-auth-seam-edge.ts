// ─────────────────────────────────────────────────────────────────────────────
// E2E authentication seam — test-only entry into the GIGA panel.
//
// Playwright runs the app against a local Postgres where Supabase Auth is not
// reachable, so a browser cannot hold a real Supabase session. Instead the
// spec seeds an approved super_admin profile and sends a cookie that carries
// that user's id plus an HMAC of it under E2E_AUTH_SEAM_SECRET.
//
// The seam is inert unless BOTH hold:
//   1. process.env.NODE_ENV !== 'production'. Next.js inlines NODE_ENV at build
//      time, so in a production build `e2eSeamEnabled()` is the constant
//      `false` and the verification path is dead code;
//   2. E2E_AUTH_SEAM_SECRET is set and at least 32 characters long.
//
// It never mints a role: middleware only learns "this cookie is authentic"
// (enough to render the panel shell), and every API route resolves the user's
// REAL staff role from the database in lib/admin/giga-actor.ts.
//
// Edge-safe (Web Crypto only) — middleware imports this module.
// ─────────────────────────────────────────────────────────────────────────────

export const E2E_SEAM_COOKIE_NAME = 'aistart360_e2e_seam'
export const E2E_SEAM_MIN_SECRET_LENGTH = 32

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIG_RE = /^[A-Za-z0-9_-]{43}$/
const CONTEXT = 'aistart360:e2e-auth-seam:v1:'

/** The seam secret, or null when the seam is disabled (always null in production). */
export function e2eSeamSecret(): string | null {
  if (process.env.NODE_ENV === 'production') return null
  const secret = process.env.E2E_AUTH_SEAM_SECRET
  return typeof secret === 'string' && secret.length >= E2E_SEAM_MIN_SECRET_LENGTH ? secret : null
}

export function e2eSeamEnabled(): boolean {
  return e2eSeamSecret() !== null
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  )
}

/**
 * Cookie value for `userId`: `<uuid>.<base64url HMAC-SHA256>`. Used by the
 * Playwright specs; refuses to sign when the seam is disabled.
 */
export async function signE2eSeamCookie(userId: string): Promise<string> {
  const secret = e2eSeamSecret()
  if (!secret) throw new Error('E2E auth seam is disabled (production build, or E2E_AUTH_SEAM_SECRET missing/shorter than 32 chars)')
  if (!UUID_RE.test(userId)) throw new Error('E2E auth seam: userId must be a UUID')
  const id = userId.toLowerCase()
  const sig = await globalThis.crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), new TextEncoder().encode(CONTEXT + id))
  return `${id}.${toBase64Url(new Uint8Array(sig))}`
}

/**
 * The user id carried by an authentic seam cookie, or null. Always null when
 * the seam is disabled — no crypto runs and nothing is read. Never throws.
 */
export async function verifyE2eSeamEdge(cookieValue: string | null | undefined): Promise<string | null> {
  const secret = e2eSeamSecret()
  if (!secret || !cookieValue || cookieValue.length > 128) return null
  const dot = cookieValue.indexOf('.')
  if (dot < 0) return null
  const id = cookieValue.slice(0, dot)
  const sig = cookieValue.slice(dot + 1)
  if (!UUID_RE.test(id) || id !== id.toLowerCase() || !SIG_RE.test(sig)) return null
  try {
    const sigBytes = fromBase64Url(sig)
    const buf = new Uint8Array(sigBytes.byteLength)
    buf.set(sigBytes)
    const ok = await globalThis.crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), buf.buffer, new TextEncoder().encode(CONTEXT + id))
    return ok ? id : null
  } catch {
    return null
  }
}
