/**
 * R-132: the step-up cookie (proof of a passed second factor, 12 h) was bound
 * to the user id only. After a sign-out the cookie stayed in the browser and a
 * later sign-in of the same account — by anyone who knows the password — was
 * admitted without the second factor. Now the proof is bound to the GoTrue
 * session (`session_id` of the access token): a new sign-in is a new session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChunks, stringToBase64URL } from '@supabase/ssr'

const jar = vi.hoisted(() => ({ cookies: [] as Array<{ name: string; value: string }> }))
vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => jar.cookies,
    get: (n: string) => jar.cookies.find((c) => c.name === n),
  }),
  headers: () => new Headers(),
}))

process.env.AUTH_SECRET = 'test-auth-secret-for-step-up'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.app'

const { signStepUp, verifyStepUp } = await import('@/lib/mfa/step-up')
const { verifyStepUpEdge } = await import('@/lib/mfa/step-up-edge')
const binding = await import('@/lib/mfa/session-binding')

const b64url = (s: string) => Buffer.from(s).toString('base64url')
function jwt(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.sig`
}
const SESSION_A = '11111111-1111-4111-8111-111111111111'
const SESSION_B = '22222222-2222-4222-8222-222222222222'

/** Cookies exactly as @supabase/ssr writes them (base64- prefix, chunked when long). */
function ssrCookies(accessToken: string, padding = 0): Array<{ name: string; value: string }> {
  const session = JSON.stringify({ access_token: accessToken, refresh_token: 'r', user: { id: 'u-1', pad: 'x'.repeat(padding) } })
  return createChunks('sb-supabase-auth-token', `base64-${stringToBase64URL(session)}`)
}

beforeEach(() => { jar.cookies = [] })

describe('R-132: step-up proof is bound to the Supabase session', () => {
  it('R-132: a proof of session A is not accepted in session B (Node and Edge)', async () => {
    const token = signStepUp('u-1', SESSION_A)
    expect(verifyStepUp(token, 'u-1', SESSION_A)).toBe(true)
    expect(verifyStepUp(token, 'u-1', SESSION_B)).toBe(false)
    expect(verifyStepUp(token, 'u-2', SESSION_A)).toBe(false)
    expect(await verifyStepUpEdge(token, 'u-1', SESSION_A)).toBe(true)
    expect(await verifyStepUpEdge(token, 'u-1', SESSION_B)).toBe(false)
  })

  it('R-132: an old user-only proof (`userId.exp`) is no longer accepted', async () => {
    const crypto = await import('node:crypto')
    const payload = `u-1.${Date.now() + 60_000}`
    const sig = crypto.createHmac('sha256', process.env.AUTH_SECRET!).update(payload).digest('hex')
    const legacy = `${Buffer.from(payload).toString('base64url')}.${sig}`
    expect(verifyStepUp(legacy, 'u-1', SESSION_A)).toBe(false)
    expect(await verifyStepUpEdge(legacy, 'u-1', SESSION_A)).toBe(false)
  })

  it('R-132: without an explicit session the verifier reads the session of the current request', () => {
    const token = signStepUp('u-1', SESSION_A)
    jar.cookies = ssrCookies(jwt({ sub: 'u-1', session_id: SESSION_A }))
    expect(verifyStepUp(token, 'u-1')).toBe(true)
    // Signed out and signed in again: another session, the old proof is void.
    jar.cookies = ssrCookies(jwt({ sub: 'u-1', session_id: SESSION_B }))
    expect(verifyStepUp(token, 'u-1')).toBe(false)
    // Signed out: no session at all.
    jar.cookies = []
    expect(verifyStepUp(token, 'u-1')).toBe(false)
  })

  it('R-132: a proof cannot be minted without a session', () => {
    expect(() => signStepUp('u-1', '')).toThrow()
  })
})

describe('R-132: reading the session id from the @supabase/ssr cookies', () => {
  it('reads a single base64- cookie', () => {
    const cookies = ssrCookies(jwt({ sub: 'u-1', session_id: SESSION_A, exp: 2_000_000_000, amr: [{ method: 'password', timestamp: 1 }] }))
    expect(cookies).toHaveLength(1)
    expect(binding.authSessionFromCookies(cookies)).toEqual({ sub: 'u-1', sessionKey: SESSION_A, expMs: 2_000_000_000_000, amr: ['password'] })
  })

  it('reads a chunked cookie (.0, .1, …)', () => {
    const cookies = ssrCookies(jwt({ sub: 'u-1', session_id: SESSION_A }), 9000)
    expect(cookies.length).toBeGreaterThan(1)
    expect(binding.stepUpSessionKeyFromCookies([{ name: 'other', value: 'x' }, ...cookies.reverse()])).toBe(SESSION_A)
  })

  it('reads plain JSON (older ssr) and ignores the PKCE code-verifier cookie', () => {
    const cookies = [
      { name: 'sb-supabase-auth-token-code-verifier', value: 'abc' },
      { name: 'sb-supabase-auth-token', value: encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: 'u-1', session_id: SESSION_B }) })) },
    ]
    expect(binding.stepUpSessionKeyFromCookies(cookies)).toBe(SESSION_B)
  })

  it('a token without session_id (very old GoTrue) gets the stand-in key; garbage gets null', () => {
    expect(binding.stepUpSessionKeyFromCookies(ssrCookies(jwt({ sub: 'u-1' })))).toBe(binding.NO_SESSION_ID)
    expect(binding.stepUpSessionKeyFromCookies([{ name: 'sb-supabase-auth-token', value: 'base64-@@@' }])).toBeNull()
    expect(binding.stepUpSessionKeyFromCookies([])).toBeNull()
  })

  it('prefers the cookie of the configured Supabase project when several are present', () => {
    const mine = ssrCookies(jwt({ sub: 'u-1', session_id: SESSION_A }))
    const other = createChunks('sb-other-auth-token', `base64-${stringToBase64URL(JSON.stringify({ access_token: jwt({ session_id: SESSION_B }) }))}`)
    expect(binding.stepUpSessionKeyFromCookies([...other, ...mine])).toBe(SESSION_A)
  })
})
