/**
 * R-003: second factors could be managed with a password-only session.
 *  - a new passkey was registered without the step-up of THIS session — and
 *    the registration then HANDED OUT the step-up cookie (2FA bypass);
 *  - 2fa/setup + 2fa/verify re-bound TOTP while 2FA was on, no old code;
 *  - a passkey was deleted without a second factor; deleting the last one
 *    switched 2FA off, also for staff who must keep it.
 * Now: once the account has a factor, every factor operation needs the
 * step-up of this session; a registration never mints a proof unless it is
 * the very first factor (onboarding); staff under «2FA обязательна» cannot
 * drop their last factor; refusals land in the security journal (critical).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChunks, stringToBase64URL } from '@supabase/ssr'

const SESSION = '11111111-1111-4111-8111-111111111111'
const OTHER_SESSION = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as Array<{ name: string; value: string }>,
  sec: null as null | { user_id: string; totp_enabled: boolean; totp_secret_enc: string | null; totp_pending_enc: string | null; backup_codes: string[] },
  creds: [] as Array<{ id: string; user_id: string; label: string | null; transports: string[]; public_key: string; counter: number }>,
  flags: { totp: false, webauthn: false },
  activity: [] as Array<Record<string, unknown>>,
  settings: { staff_require_mfa: false } as Record<string, boolean>,
  profileRole: 'client',
  staffRow: null as null | { user_id: string },
}))

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => (h.jar.has(n) ? { name: n, value: h.jar.get(n)! } : undefined),
    getAll: () => Array.from(h.jar.entries()).map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { h.sets.push({ name, value }); h.jar.set(name, value) },
    delete: (name: string) => { h.jar.delete(name) },
  }),
  headers: () => new Headers(),
}))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/api-identity', () => ({ getSessionUser: async () => ({ id: 'u-1', email: 'u@x.kz' }) }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/rate-limit/policies', () => ({ MFA_OTP_DAILY: { max: 100, windowMs: 1 } }))
vi.mock('@/lib/crypto/secrets', () => ({ isEncryptionConfigured: () => true, encryptSecret: (s: string) => `enc:${s}`, decryptSecret: (s: string) => s.replace(/^enc:/, '') }))
vi.mock('@/lib/mfa/totp', () => ({ generateSecret: () => 'NEWSECRET', otpauthURL: () => 'otpauth://x', verifyTOTP: (code: string) => code === '123456' }))
vi.mock('@/lib/mfa/backup-codes', () => ({
  generateBackupCodes: () => ['AAAAA-BBBBB'],
  hashBackupCodes: async (c: string[]) => c.map((x) => `h:${x}`),
  findBackupCodeIndex: async (code: string, hashes: string[]) => hashes.indexOf(`h:${code}`),
}))
vi.mock('qrcode', () => ({ default: { toString: async () => '<svg/>' } }))
vi.mock('@/lib/activity/log', () => ({ logActivity: async (e: Record<string, unknown>) => { h.activity.push(e) } }))
vi.mock('@/lib/notifications/create', () => ({ createNotification: async () => undefined }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (k: string) => h.settings[k] ?? false }))
vi.mock('@/lib/dev/dev-request', () => ({ devModeOnForServerRequest: () => false }))
// SR-07: the impersonation refusal is covered by tests/unit/security/sr07-impersonation-account-actions.test.ts.
vi.mock('@/lib/impersonation/guard', () => ({ refuseDuringImpersonation: async () => null }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'profiles' ? { role: h.profileRole } : table === 'staff_roles' ? h.staffRow : null,
            error: null,
          }),
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/mfa/store', () => ({
  getUserSecurity: async () => h.sec,
  upsertUserSecurity: async (_id: string, patch: Record<string, unknown>) => {
    h.sec = { user_id: 'u-1', totp_enabled: false, totp_secret_enc: null, totp_pending_enc: null, backup_codes: [], ...h.sec, ...patch } as typeof h.sec
  },
  setMfaMetadataFlag: async (_id: string, on: boolean) => { h.flags.totp = on },
  setMfaWebauthnFlag: async (_id: string, on: boolean) => { h.flags.webauthn = on },
}))
vi.mock('@/lib/webauthn/store', () => ({
  listCredentials: async () => h.creds,
  countCredentials: async () => h.creds.length,
  insertCredential: async (row: (typeof h.creds)[number]) => { h.creds.push(row) },
  deleteCredential: async (_u: string, id: string) => {
    const before = h.creds.length
    h.creds = h.creds.filter((c) => c.id !== id)
    return h.creds.length < before
  },
}))
vi.mock('@/lib/webauthn/config', () => ({ getWebAuthnConfig: () => ({ rpID: 'x', rpName: 'x', expectedOrigins: ['http://x'] }), deviceLabelFromRequest: () => 'Mac' }))
vi.mock('@/lib/webauthn/challenge', () => ({
  WEBAUTHN_CHALLENGE_COOKIE: 'wachal',
  WEBAUTHN_CHALLENGE_COOKIE_OPTIONS: {},
  signChallenge: () => 'signed-challenge',
  readChallenge: () => 'challenge',
}))
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: async () => ({ challenge: 'challenge' }),
  verifyRegistrationResponse: async () => ({
    verified: true,
    registrationInfo: { credentialID: new Uint8Array([1, 2, 3]), credentialPublicKey: new Uint8Array([4]), counter: 0, credentialDeviceType: 'singleDevice', credentialBackedUp: false },
  }),
}))

process.env.AUTH_SECRET = 'test-auth-secret-for-step-up'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.app'

const { signStepUp, verifyStepUp, MFA_COOKIE_NAME } = await import('@/lib/mfa/step-up')
const regOptions = await import('@/app/api/v1/security/webauthn/register/options/route')
const regVerify = await import('@/app/api/v1/security/webauthn/register/verify/route')
const credentials = await import('@/app/api/v1/security/webauthn/credentials/route')
const setup = await import('@/app/api/v1/security/2fa/setup/route')
const verify = await import('@/app/api/v1/security/2fa/verify/route')
const disable = await import('@/app/api/v1/security/2fa/disable/route')
const regen = await import('@/app/api/v1/security/backup-codes/regenerate/route')

const b64url = (s: string) => Buffer.from(s).toString('base64url')
const accessToken = (sid: string) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: 'u-1', session_id: sid }))}.sig`
function signIn(sid = SESSION) {
  for (const c of createChunks('sb-supabase-auth-token', `base64-${stringToBase64URL(JSON.stringify({ access_token: accessToken(sid) }))}`)) h.jar.set(c.name, c.value)
}
const withStepUp = (sid = SESSION) => h.jar.set(MFA_COOKIE_NAME, signStepUp('u-1', sid))
const post = (body?: unknown, method = 'POST') => new Request('http://x/api', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const stepUpIssued = () => h.sets.some((s) => s.name === MFA_COOKIE_NAME && s.value)
const blockedLogged = () => h.activity.some((a) => a.action === 'security.factor_change_blocked' && a.severity === 'critical')

function enrolTotp() {
  h.sec = { user_id: 'u-1', totp_enabled: true, totp_secret_enc: 'enc:OLDSECRET', totp_pending_enc: null, backup_codes: ['h:AAAAA-BBBBB'] }
  h.flags.totp = true
}
function enrolPasskey(id = 'key-1') {
  h.creds.push({ id, user_id: 'u-1', label: id, transports: [], public_key: 'pk', counter: 0 })
  h.flags.webauthn = true
}

beforeEach(() => {
  h.jar = new Map()
  h.sets = []
  h.sec = null
  h.creds = []
  h.flags = { totp: false, webauthn: false }
  h.activity = []
  h.settings = { staff_require_mfa: false }
  h.profileRole = 'client'
  h.staffRow = null
  signIn()
})

describe('R-003: adding a passkey', () => {
  it('R-003: an account with a factor cannot start a passkey registration without step-up', async () => {
    enrolTotp()
    const res = await regOptions.POST(post())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('MFA_STEP_UP_REQUIRED')
    expect(blockedLogged()).toBe(true)
  })

  it('R-003: …nor finish one — no credential stored, no step-up handed out', async () => {
    enrolPasskey()
    const res = await regVerify.POST(post({ response: { id: 'x', response: {} } }))
    expect(res.status).toBe(403)
    expect(h.creds).toHaveLength(1)
    expect(stepUpIssued()).toBe(false)
  })

  it('R-003: a proof from another session does not count', async () => {
    enrolTotp()
    withStepUp(OTHER_SESSION)
    expect((await regOptions.POST(post())).status).toBe(403)
  })

  it('R-003: with the step-up of this session a second key is added, and no new proof is minted', async () => {
    enrolTotp()
    withStepUp()
    expect((await regOptions.POST(post())).status).toBe(200)
    h.sets = []
    const res = await regVerify.POST(post({ response: { id: 'x', response: {} } }))
    expect(res.status).toBe(200)
    expect(h.creds).toHaveLength(1)
    expect(stepUpIssued()).toBe(false)
  })

  it('R-003: the very first factor (onboarding) needs no step-up and earns a proof bound to this session', async () => {
    expect((await regOptions.POST(post())).status).toBe(200)
    const res = await regVerify.POST(post({ response: { id: 'x', response: {} } }))
    expect(res.status).toBe(200)
    expect((await res.json()).backup_codes).toEqual(['AAAAA-BBBBB'])
    expect(verifyStepUp(h.jar.get(MFA_COOKIE_NAME), 'u-1', SESSION)).toBe(true)
    expect(verifyStepUp(h.jar.get(MFA_COOKIE_NAME), 'u-1', OTHER_SESSION)).toBe(false)
  })
})

describe('R-003: TOTP', () => {
  it('R-003: re-binding TOTP while a factor exists needs step-up (setup and verify)', async () => {
    enrolTotp()
    expect((await setup.POST(post())).status).toBe(403)
    // A pending secret left over from before must not be confirmable either.
    h.sec!.totp_pending_enc = 'enc:ATTACKER'
    const res = await verify.POST(post({ code: '123456' }))
    expect(res.status).toBe(403)
    expect(h.sec!.totp_secret_enc).toBe('enc:OLDSECRET')
    expect(stepUpIssued()).toBe(false)
    expect(blockedLogged()).toBe(true)
  })

  it('R-003: a passkey-only account cannot add TOTP without step-up', async () => {
    enrolPasskey()
    expect((await setup.POST(post())).status).toBe(403)
  })

  it('R-003: with step-up TOTP is re-bound; the proof is not re-minted', async () => {
    enrolTotp()
    withStepUp()
    expect((await setup.POST(post())).status).toBe(200)
    h.sets = []
    const res = await verify.POST(post({ code: '123456' }))
    expect(res.status).toBe(200)
    expect(h.sec!.totp_secret_enc).toBe('enc:NEWSECRET')
    expect(stepUpIssued()).toBe(false)
  })

  it('R-003: first TOTP enrolment still works and earns a session-bound proof', async () => {
    expect((await setup.POST(post())).status).toBe(200)
    const res = await verify.POST(post({ code: '123456' }))
    expect(res.status).toBe(200)
    expect(verifyStepUp(h.jar.get(MFA_COOKIE_NAME), 'u-1', SESSION)).toBe(true)
  })

  it('R-003: switching 2FA off needs step-up even with a valid code', async () => {
    enrolTotp()
    const res = await disable.POST(post({ code: '123456' }))
    expect(res.status).toBe(403)
    expect(h.sec!.totp_enabled).toBe(true)
  })

  it('R-003: re-issuing backup codes needs step-up', async () => {
    enrolTotp()
    expect((await regen.POST(post({ code: '123456' }))).status).toBe(403)
    withStepUp()
    expect((await regen.POST(post({ code: '123456' }))).status).toBe(200)
  })
})

describe('R-003: removing factors', () => {
  it('R-003: deleting a passkey needs step-up', async () => {
    enrolPasskey()
    const res = await credentials.DELETE(post({ id: 'key-1' }, 'DELETE'))
    expect(res.status).toBe(403)
    expect(h.creds).toHaveLength(1)
    expect(h.flags.webauthn).toBe(true)
  })

  it('R-003: a client may remove the last passkey with step-up (2FA is optional for clients)', async () => {
    enrolPasskey()
    withStepUp()
    const res = await credentials.DELETE(post({ id: 'key-1' }, 'DELETE'))
    expect(res.status).toBe(200)
    expect(h.flags.webauthn).toBe(false)
  })

  it('R-003: staff under «2FA обязательна» cannot remove the last factor', async () => {
    h.settings.staff_require_mfa = true
    h.staffRow = { user_id: 'u-1' }
    enrolPasskey()
    withStepUp()
    const res = await credentials.DELETE(post({ id: 'key-1' }, 'DELETE'))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('MFA_REQUIRED_FOR_STAFF')
    expect(h.creds).toHaveLength(1)
    expect(h.flags.webauthn).toBe(true)
  })

  it('R-003: …but may remove one of two passkeys', async () => {
    h.settings.staff_require_mfa = true
    h.profileRole = 'expert'
    enrolPasskey('key-1')
    enrolPasskey('key-2')
    withStepUp()
    expect((await credentials.DELETE(post({ id: 'key-1' }, 'DELETE'))).status).toBe(200)
    expect(h.creds).toHaveLength(1)
  })

  it('R-003: staff under «2FA обязательна» cannot switch TOTP off when it is the only factor', async () => {
    h.settings.staff_require_mfa = true
    h.profileRole = 'super_admin'
    enrolTotp()
    withStepUp()
    const res = await disable.POST(post({ code: '123456' }))
    expect(res.status).toBe(409)
    expect(h.sec!.totp_enabled).toBe(true)
    // With a passkey left, switching TOTP off is fine.
    enrolPasskey()
    expect((await disable.POST(post({ code: '123456' }))).status).toBe(200)
    expect(h.sec!.totp_enabled).toBe(false)
  })
})
