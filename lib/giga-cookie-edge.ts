// ───────────────────────────────────────────────────────────────────────────────
// Edge-safe verifier for the signed giga super-admin cookie (audit A2b).
//
// This is the only giga-cookie module that middleware imports. It deliberately
// uses Web Crypto only: importing node:crypto here would break the Edge bundle.
// The Node signer/verifier lives in `lib/giga-cookie.ts` and reuses the exact
// parser below so claim validation cannot drift between runtimes.
//
// Token format:
//   v1.base64url(JSON({ role, iat, exp, jti })).base64url(HMAC-SHA256)
//
// The old `<role>.<signature>` format is intentionally rejected. It contained
// no expiry and could therefore be replayed indefinitely after disclosure.
// ────────────────────────────────────────────────────────────────────────────────

export const GIGA_COOKIE_NAME = 'aistart360_giga'
export const GIGA_TOKEN_VERSION = 'v1'
export const GIGA_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
export const GIGA_TOKEN_FUTURE_SKEW_SECONDS = 60

const GIGA_ROLE = 'super_admin'
const HMAC_SHA256_BYTES = 32
const JTI_BYTES = 16
const JTI_BASE64URL_LENGTH = 22
const MAX_TOKEN_LENGTH = 512
const MAX_PAYLOAD_BASE64URL_LENGTH = 256
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

export interface GigaTokenClaims {
  role: typeof GIGA_ROLE
  iat: number
  exp: number
  jti: string
}

export interface ParsedGigaToken {
  claims: GigaTokenClaims
  signingInput: string
  signature: Uint8Array
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Strict, canonical base64url decoder. Returns null instead of throwing. */
function base64UrlToBytes(value: string, maxLength: number): Uint8Array | null {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    value.length % 4 === 1 ||
    !BASE64URL_RE.test(value)
  ) {
    return null
  }

  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    // Reject alternate/non-canonical encodings of the same byte sequence.
    return bytesToBase64Url(bytes) === value ? bytes : null
  } catch {
    return null
  }
}

function isExactClaimsObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  return keys.length === 4 && keys.join(',') === 'exp,iat,jti,role'
}

/**
 * Parse and validate every non-cryptographic part of a token. Node and Edge
 * verifiers both call this function, which guarantees claim-validation parity.
 */
export function parseGigaTokenForVerification(
  cookieValue: string | undefined | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): ParsedGigaToken | null {
  if (!cookieValue || cookieValue.length > MAX_TOKEN_LENGTH) return null
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) return null

  const parts = cookieValue.split('.')
  if (parts.length !== 3) return null
  const [version, encodedPayload, encodedSignature] = parts
  if (version !== GIGA_TOKEN_VERSION) return null

  const payloadBytes = base64UrlToBytes(encodedPayload, MAX_PAYLOAD_BASE64URL_LENGTH)
  const signature = base64UrlToBytes(encodedSignature, 64)
  if (!payloadBytes || !signature || signature.length !== HMAC_SHA256_BYTES) return null

  let rawClaims: unknown
  try {
    const payload = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes)
    rawClaims = JSON.parse(payload)
  } catch {
    return null
  }

  if (!isExactClaimsObject(rawClaims)) return null
  const { role, iat, exp, jti } = rawClaims
  if (role !== GIGA_ROLE) return null
  if (typeof iat !== 'number' || typeof exp !== 'number') return null
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return null
  if (iat < 0 || exp <= iat) return null
  if (exp - iat > GIGA_TOKEN_MAX_AGE_SECONDS) return null
  if (iat > nowSeconds + GIGA_TOKEN_FUTURE_SKEW_SECONDS) return null
  if (exp <= nowSeconds) return null
  if (exp > nowSeconds + GIGA_TOKEN_MAX_AGE_SECONDS + GIGA_TOKEN_FUTURE_SKEW_SECONDS) return null
  if (typeof jti !== 'string' || jti.length !== JTI_BASE64URL_LENGTH) return null
  const jtiBytes = base64UrlToBytes(jti, JTI_BASE64URL_LENGTH)
  if (!jtiBytes || jtiBytes.length !== JTI_BYTES) return null

  return {
    claims: { role, iat, exp, jti },
    signingInput: `${version}.${encodedPayload}`,
    signature,
  }
}

async function verifyHmacSha256Edge(
  secret: string,
  message: string,
  signature: Uint8Array,
): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  // Web Crypto performs HMAC verification inside the runtime's cryptographic
  // implementation, avoiding a timing-sensitive JavaScript string comparison.
  const signatureBuffer = new Uint8Array(signature.byteLength)
  signatureBuffer.set(signature)
  return globalThis.crypto.subtle.verify('HMAC', key, signatureBuffer.buffer, encoder.encode(message))
}

function getSecretEdge(): string | null {
  return (
    process.env.GIGA_COOKIE_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    null
  )
}

/** Verify a signed, unexpired giga token in the Edge runtime. Never throws. */
export async function verifyGigaRoleEdge(
  cookieValue: string | undefined | null,
): Promise<string | null> {
  try {
    const parsed = parseGigaTokenForVerification(cookieValue)
    const secret = getSecretEdge()
    if (!parsed || !secret) return null

    return await verifyHmacSha256Edge(secret, parsed.signingInput, parsed.signature)
      ? parsed.claims.role
      : null
  } catch {
    return null
  }
}
