import crypto from 'node:crypto'

/**
 * RFC 6238 TOTP + RFC 4648 base32, implemented on node:crypto (no external
 * dependency — verified against the RFC 6238 test vectors). Compatible with
 * Google Authenticator / 1Password / Authy (SHA1, 6 digits, 30s step).
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Random base32 secret (default 20 bytes → 160 bits, the RFC-recommended size). */
export function generateSecret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes)
  let bits = ''
  for (const b of buf) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)]
  const rem = bits.length % 5
  if (rem) out += BASE32[parseInt(bits.slice(bits.length - rem).padEnd(5, '0'), 2)]
  return out
}

function base32Decode(input: string): Buffer {
  const s = input.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const c of s) {
    const v = BASE32.indexOf(c)
    if (v < 0) continue
    bits += v.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function hotp(secret: string, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest()
  const o = h[h.length - 1] & 0xf
  const bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff)
  return (bin % 10 ** digits).toString().padStart(digits, '0')
}

/** Current TOTP for `secret`. `nowMs` defaults to Date.now(). */
export function generateTOTP(secret: string, nowMs = Date.now(), step = 30, digits = 6): string {
  return hotp(secret, Math.floor(nowMs / 1000 / step), digits)
}

/**
 * Verify a submitted `token`, allowing ±`window` steps of clock drift.
 * Constant-time comparison per candidate step.
 */
export function verifyTOTP(token: string, secret: string, window = 1, nowMs = Date.now(), step = 30, digits = 6): boolean {
  const clean = (token ?? '').replace(/\D/g, '')
  if (clean.length !== digits) return false
  const counter = Math.floor(nowMs / 1000 / step)
  const submitted = Buffer.from(clean)
  for (let i = -window; i <= window; i++) {
    const expected = Buffer.from(hotp(secret, counter + i, digits))
    if (expected.length === submitted.length && crypto.timingSafeEqual(expected, submitted)) return true
  }
  return false
}

/** otpauth:// URI for QR / manual entry. */
export function otpauthURL(secret: string, account: string, issuer = 'AIStart360'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${label}?${params.toString()}`
}
