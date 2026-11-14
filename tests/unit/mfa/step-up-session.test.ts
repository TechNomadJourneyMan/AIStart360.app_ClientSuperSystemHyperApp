/**
 * SR-01 (migration 143): the step-up is recorded for the database
 * (public.staff_mfa_sessions, read by staff_session_ok() in every staff RLS
 * helper) BEFORE the step-up cookie is handed out. No record → no cookie
 * (fail closed), and a backup code is not spent on a step-up that did not
 * happen. RLS side: tests/integration/db/staff-mfa-sessions.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChunks, stringToBase64URL } from '@supabase/ssr'

const SESSION = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  rows: [] as Array<Record<string, unknown>>,
  deletes: [] as Array<Array<[string, string, unknown]>>,
  recordFails: false,
  sec: null as null | { user_id: string; totp_enabled: boolean; totp_secret_enc: string | null; totp_pending_enc: string | null; backup_codes: string[] },
  totpOk: false,
  upsertSecFails: false,
}))

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => (h.jar.has(n) ? { name: n, value: h.jar.get(n)! } : undefined),
    getAll: () => Array.from(h.jar.entries()).map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { h.jar.set(name, value) },
  }),
  headers: () => new Headers(),
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>) => {
        if (table !== 'staff_mfa_sessions') throw new Error(`unexpected table ${table}`)
        if (h.recordFails) return { error: { code: 'PGRST301' } }
        h.rows.push(row)
        return { error: null }
      },
      delete: () => {
        const calls: Array<[string, string, unknown]> = []
        h.deletes.push(calls)
        const chain: Record<string, unknown> = {
          eq: (c: string, v: unknown) => { calls.push(['eq', c, v]); return chain },
          lt: (c: string, v: unknown) => { calls.push(['lt', c, v]); return chain },
          then: (r: (v: unknown) => unknown) => r({ error: null }),
        }
        return chain
      },
    }),
  }),
}))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/api-identity', () => ({ getSessionUser: async () => ({ id: 'u-1', email: 'u@x.kz' }) }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/rate-limit/policies', () => ({ MFA_OTP_DAILY: { max: 100, windowMs: 1 } }))
vi.mock('@/lib/crypto/secrets', () => ({ decryptSecret: (s: string) => s }))
vi.mock('@/lib/mfa/totp', () => ({ verifyTOTP: () => h.totpOk }))
vi.mock('@/lib/mfa/backup-codes', () => ({ findBackupCodeIndex: async (code: string, hashes: string[]) => hashes.indexOf(`h:${code}`) }))
vi.mock('@/lib/mfa/store', () => ({
  getUserSecurity: async () => h.sec,
  upsertUserSecurity: async (_id: string, patch: Record<string, unknown>) => {
    if (h.upsertSecFails) throw new Error('mfa store: user_security upsert failed (500)')
    h.sec = { ...h.sec!, ...patch } as typeof h.sec
  },
}))
vi.mock('@/lib/webauthn/store', () => ({
  countCredentials: async () => 0,
  getCredentialForUser: async () => ({ id: 'AQID', public_key: 'BA', counter: 0, transports: [], label: 'Mac' }),
  updateCredentialCounter: async () => undefined,
}))
vi.mock('@/lib/webauthn/config', () => ({ getWebAuthnConfig: () => ({ rpID: 'x', expectedOrigins: ['http://x'] }) }))
vi.mock('@/lib/webauthn/challenge', () => ({ WEBAUTHN_CHALLENGE_COOKIE: 'wachal', readChallenge: () => 'challenge' }))
vi.mock('@simplewebauthn/server', () => ({ verifyAuthenticationResponse: async () => ({ verified: true, authenticationInfo: { newCounter: 1 } }) }))
vi.mock('@/lib/activity/log', () => ({ logActivity: async () => undefined }))
vi.mock('@/lib/impersonation/guard', () => ({ refuseDuringImpersonation: async () => null }))

process.env.AUTH_SECRET = 'test-auth-secret-for-step-up'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.app'

const { MFA_COOKIE_NAME, verifyStepUp } = await import('@/lib/mfa/step-up')
const mod = await import('@/lib/mfa/step-up-session')
const challenge = await import('@/app/api/v1/security/2fa/challenge/route')
const passkey = await import('@/app/api/v1/security/webauthn/authenticate/verify/route')

const b64url = (s: string) => Buffer.from(s).toString('base64url')
function signIn(sid: string) {
  const token = `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: 'u-1', session_id: sid }))}.sig`
  for (const c of createChunks('sb-supabase-auth-token', `base64-${stringToBase64URL(JSON.stringify({ access_token: token }))}`)) h.jar.set(c.name, c.value)
}
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  h.jar = new Map()
  h.rows = []
  h.deletes = []
  h.recordFails = false
  h.totpOk = false
  h.upsertSecFails = false
  h.sec = { user_id: 'u-1', totp_enabled: true, totp_secret_enc: 'SECRET', totp_pending_enc: null, backup_codes: ['h:CODE1-AAAAA', 'h:CODE2-BBBBB'] }
  signIn(SESSION)
})

describe('lib/mfa/step-up-session', () => {
  it('records session, user, method and the cookie lifetime; prunes the user’s expired rows', async () => {
    await mod.recordStepUpSession('u-1', SESSION.toUpperCase(), 'totp')
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toMatchObject({ session_id: SESSION, user_id: 'u-1', method: 'totp' })
    expect(Date.parse(String(h.rows[0].expires_at)) - Date.parse(String(h.rows[0].verified_at))).toBe(12 * 60 * 60 * 1000)
    expect(h.deletes[0]).toEqual([['eq', 'user_id', 'u-1'], ['lt', 'expires_at', expect.any(String)]])
  })

  it('SR-16: no GoTrue session id (nosid / missing / not a uuid) → refused, nothing written', async () => {
    for (const key of ['nosid', null, undefined, '', 'session-1']) {
      await expect(mod.recordStepUpSession('u-1', key, 'totp')).rejects.toMatchObject({ code: 'no_session' })
    }
    expect(h.rows).toEqual([])
  })

  it('a failed write throws store_failed, and issueStepUp sets no cookie', async () => {
    h.recordFails = true
    const jar = { set: vi.fn() }
    await expect(mod.issueStepUp(jar, 'u-1', SESSION, 'passkey')).rejects.toMatchObject({ code: 'store_failed' })
    expect(jar.set).not.toHaveBeenCalled()
  })

  it('forget* remove by session / by user and never throw', async () => {
    await mod.forgetStepUpSession(SESSION)
    await mod.forgetStepUpSessionsOfUser('u-1')
    await mod.forgetStepUpSession('nosid')
    expect(h.deletes).toEqual([[['eq', 'session_id', SESSION]], [['eq', 'user_id', 'u-1']]])
  })
})

describe('POST /api/v1/security/2fa/challenge', () => {
  it('TOTP: the record is written, then the session-bound cookie', async () => {
    h.totpOk = true
    const res = await challenge.POST(post({ code: '123456' }))
    expect(res.status).toBe(200)
    expect(h.rows).toEqual([expect.objectContaining({ session_id: SESSION, method: 'totp' })])
    expect(verifyStepUp(h.jar.get(MFA_COOKIE_NAME), 'u-1', SESSION)).toBe(true)
  })

  it('record fails → 503 with a clear message, no cookie, the backup code stays usable', async () => {
    h.recordFails = true
    const res = await challenge.POST(post({ code: 'CODE1-AAAAA' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe(mod.STEP_UP_RECORD_FAILED_MESSAGE)
    expect(h.jar.has(MFA_COOKIE_NAME)).toBe(false)
    expect(h.sec!.backup_codes).toEqual(['h:CODE1-AAAAA', 'h:CODE2-BBBBB'])
  })

  it('backup code: recorded, then spent; when spending fails the record is undone and no cookie is set', async () => {
    const ok = await challenge.POST(post({ code: 'CODE1-AAAAA' }))
    expect(ok.status).toBe(200)
    expect(h.rows).toEqual([expect.objectContaining({ method: 'backup_code' })])
    expect(h.sec!.backup_codes).toEqual(['h:CODE2-BBBBB'])

    h.jar.delete(MFA_COOKIE_NAME)
    h.deletes = []
    h.upsertSecFails = true
    await expect(challenge.POST(post({ code: 'CODE2-BBBBB' }))).rejects.toThrow(/user_security/)
    expect(h.deletes).toContainEqual([['eq', 'session_id', SESSION]])
    expect(h.jar.has(MFA_COOKIE_NAME)).toBe(false)
  })

  it('a token without session_id gets no step-up at all', async () => {
    h.jar = new Map()
    const token = `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: 'u-1' }))}.sig`
    for (const c of createChunks('sb-supabase-auth-token', `base64-${stringToBase64URL(JSON.stringify({ access_token: token }))}`)) h.jar.set(c.name, c.value)
    h.totpOk = true
    const res = await challenge.POST(post({ code: '123456' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/Войдите заново/)
    expect(h.jar.has(MFA_COOKIE_NAME)).toBe(false)
  })
})

describe('POST /api/v1/security/webauthn/authenticate/verify', () => {
  it('passkey: recorded with method passkey, cookie set', async () => {
    const res = await passkey.POST(post({ response: { id: 'AQID' } }))
    expect(res.status).toBe(200)
    expect(h.rows).toEqual([expect.objectContaining({ session_id: SESSION, method: 'passkey' })])
    expect(verifyStepUp(h.jar.get(MFA_COOKIE_NAME), 'u-1', SESSION)).toBe(true)
  })

  it('record fails → 503, no cookie', async () => {
    h.recordFails = true
    const res = await passkey.POST(post({ response: { id: 'AQID' } }))
    expect(res.status).toBe(503)
    expect(h.jar.has(MFA_COOKIE_NAME)).toBe(false)
  })
})

describe('lib/dev/dev-step-up (localhost developer login)', () => {
  it('records the session of the token just issued for that user (method dev); never for another user; never throws', async () => {
    const dev = await import('@/lib/dev/dev-step-up')
    const token = (sub: string, sid: string) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub, session_id: sid }))}.sig`
    expect(await dev.recordDevStepUp(token('u-2', SESSION), 'u-1')).toBe(false)
    expect(h.rows).toEqual([])
    expect(await dev.recordDevStepUp(token('u-1', SESSION), 'u-1')).toBe(true)
    expect(h.rows).toEqual([expect.objectContaining({ session_id: SESSION, user_id: 'u-1', method: 'dev' })])
    h.recordFails = true
    expect(await dev.recordDevStepUp(token('u-1', SESSION), 'u-1')).toBe(false)
    await dev.forgetDevStepUp(SESSION)
    expect(h.deletes.at(-1)).toEqual([['eq', 'session_id', SESSION], ['eq', 'method', 'dev']])
  })
})
