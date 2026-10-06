/**
 * Security P2-8 — internal server-to-server tokens (lib/internal-auth.ts).
 * A token may be bound to the target path, the user and the diagnostic, so a
 * leaked one cannot be replayed against another endpoint or for another user;
 * the default lifetime is one minute (was five), and the pre-v2 format that
 * signed only the expiry is no longer accepted.
 */
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INTERNAL_TOKEN_HEADER,
  hasValidInternalToken,
  internalBaseUrl,
  internalFetchHeaders,
  signInternalToken,
  verifyInternalToken,
} from '@/lib/internal-auth'

const AI = '/api/v1/diagnostics/ai-analyze'
const PB = '/api/v1/diagnostics/point-b/ai-generate'

function req(path: string, token: string): Request {
  return new Request(`http://localhost${path}`, { method: 'POST', headers: { [INTERNAL_TOKEN_HEADER]: token } })
}

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-internal-secret'
  delete process.env.INTERNAL_TOKEN_SECRET
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('internal tokens', () => {
  it('a bound token verifies only on its own path and for its own ids', () => {
    const token = signInternalToken({ path: AI, userId: 'user-a', diagnosticId: 'd-1' })
    expect(hasValidInternalToken(req(AI, token), { userId: 'user-a', diagnosticId: 'd-1' })).toBe(true)
    expect(hasValidInternalToken(req(PB, token), { userId: 'user-a', diagnosticId: 'd-1' })).toBe(false)
    expect(hasValidInternalToken(req(AI, token), { userId: 'user-b', diagnosticId: 'd-1' })).toBe(false)
    expect(hasValidInternalToken(req(AI, token), { userId: 'user-a', diagnosticId: 'd-2' })).toBe(false)
    // A receiver that cannot name the ids does not accept a bound token.
    expect(hasValidInternalToken(req(AI, token))).toBe(false)
  })

  it('internalFetchHeaders binds when asked', () => {
    const h = internalFetchHeaders({}, { path: AI, userId: 'user-a' })
    expect(hasValidInternalToken(req(AI, h[INTERNAL_TOKEN_HEADER]), { userId: 'user-a' })).toBe(true)
    expect(hasValidInternalToken(req(PB, h[INTERNAL_TOKEN_HEADER]), { userId: 'user-a' })).toBe(false)
  })

  it('expires after a minute by default', () => {
    vi.useFakeTimers()
    const token = signInternalToken()
    expect(verifyInternalToken(token)).toBe(true)
    vi.advanceTimersByTime(61_000)
    expect(verifyInternalToken(token)).toBe(false)
  })

  it('rejects tampered claims and the old expiry-only format', () => {
    const token = signInternalToken({ path: AI, userId: 'user-a' })
    const [v, , sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000, path: AI, uid: 'user-b' })).toString('base64url')
    expect(verifyInternalToken(`${v}.${forged}.${sig}`, { path: AI, userId: 'user-b' })).toBe(false)

    const exp = String(Date.now() + 60_000)
    const legacy = `${Buffer.from(exp).toString('base64url')}.${crypto.createHmac('sha256', 'test-internal-secret').update(exp).digest('hex')}`
    expect(verifyInternalToken(legacy)).toBe(false)
  })

  it('a token signed with another secret is refused (INTERNAL_TOKEN_SECRET wins over AUTH_SECRET)', () => {
    const token = signInternalToken()
    vi.stubEnv('INTERNAL_TOKEN_SECRET', 'dedicated')
    expect(verifyInternalToken(token)).toBe(false)
    expect(verifyInternalToken(signInternalToken())).toBe(true)
  })
})

describe('internalBaseUrl', () => {
  it('prefers the configured app URL over the request Host', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.aistart360.app/')
    expect(internalBaseUrl({ nextUrl: { origin: 'https://evil.example' } })).toBe('https://app.aistart360.app')
  })

  it('never uses the request Host in production', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('VERCEL_URL', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(internalBaseUrl({ nextUrl: { origin: 'https://evil.example' } })).toBeNull()
    vi.stubEnv('VERCEL_URL', 'my-app-abc.vercel.app')
    expect(internalBaseUrl({ nextUrl: { origin: 'https://evil.example' } })).toBe('https://my-app-abc.vercel.app')
  })
})
