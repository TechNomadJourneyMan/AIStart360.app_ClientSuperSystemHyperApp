/**
 * SR-07 — из impersonation администратор мог менять саму учётную запись
 * клиента: посадить ему ПЕРВЫЙ фактор 2FA (step-up не нужен) и забрать
 * резервные коды (клиент заперт), сменить пароль, выкинуть со всех устройств,
 * привязать свой Telegram, выдать вечную ссылку на отчёт, дать/отозвать
 * согласия клиента. Теперь всё это — 403 «Недоступно в режиме просмотра от
 * имени клиента», и в режиме правки тоже; отказ пишется в журнал
 * безопасности. Сессия impersonation узнаётся и по cookie, и по серверной
 * привязке сессии (cookie удалён); привязка недоступна → 503 (fail closed).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createChunks, stringToBase64URL } from '@supabase/ssr'

const UID = '11111111-2222-4333-8444-555555555555'
const AID = '99999999-8888-4777-8666-555555555555'
const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const ASID = '12121212-3434-4565-8787-909090909090'
const MSG = 'Недоступно в режиме просмотра от имени клиента'

const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  activity: [] as Array<Record<string, unknown>>,
  bindingRow: null as null | { impersonation_session_id: string },
  bindingError: false,
  sessionRow: null as null | Record<string, unknown>,
  writes: [] as Array<{ table: string; op: string }>,
  signOuts: [] as unknown[],
  updateUser: 0,
}))

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => (h.jar.has(n) ? { name: n, value: h.jar.get(n)! } : undefined),
    getAll: () => Array.from(h.jar.entries()).map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { h.jar.set(name, value) },
    delete: (name: string) => { h.jar.delete(name) },
  }),
  headers: () => new Headers(),
}))

function builder(table: string) {
  const b: Record<string, unknown> = {}
  let op = 'select'
  for (const m of ['eq', 'is', 'neq', 'limit', 'order', 'in']) b[m] = () => b
  b.select = () => b
  b.update = () => { op = 'update'; h.writes.push({ table, op }); return b }
  b.upsert = () => { op = 'upsert'; h.writes.push({ table, op }); return b }
  b.insert = () => { op = 'insert'; h.writes.push({ table, op }); return b }
  b.maybeSingle = async () => {
    if (table === 'admin_audit_log') return h.bindingError ? { data: null, error: { message: 'down' } } : { data: h.bindingRow, error: null }
    if (table === 'impersonation_sessions') return { data: h.sessionRow, error: null }
    if (table === 'profiles') return { data: { role: 'client' }, error: null }
    return { data: null, error: null }
  }
  b.single = b.maybeSingle
  b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: op === 'select' ? [] : [{ id: UID }], error: null }).then(r)
  return b
}

const userClient = () => ({
  auth: {
    getUser: async () => ({ data: { user: { id: UID, email: 'c@x.io', identities: [{ provider: 'email' }] } } }),
    signOut: async (o?: unknown) => { h.signOuts.push(o ?? 'DEFAULT(global)'); return { error: null } },
    updateUser: async () => { h.updateUser++; return { error: null } },
  },
  from: builder,
})

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: builder }) }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: userClient }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => userClient() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }) }))
vi.mock('@/lib/api-identity', () => ({ getSessionUser: async () => ({ id: UID, email: 'c@x.io' }) }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/rate-limit/policies', () => ({ MFA_OTP_DAILY: { max: 100, windowMs: 1 } }))
vi.mock('@/lib/activity/log', () => ({ logActivity: async (e: Record<string, unknown>) => { h.activity.push(e) } }))
vi.mock('@/lib/notifications/create', () => ({ createNotification: async () => undefined }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => false }))
vi.mock('@/lib/dev/dev-request', () => ({ devModeOnForServerRequest: () => false }))
vi.mock('@/lib/crypto/secrets', () => ({ isEncryptionConfigured: () => true, encryptSecret: (s: string) => `enc:${s}`, decryptSecret: (s: string) => s.replace(/^enc:/, '') }))
vi.mock('@/lib/mfa/totp', () => ({ generateSecret: () => 'NEWSECRET', otpauthURL: () => 'otpauth://x', verifyTOTP: () => true }))
vi.mock('@/lib/mfa/backup-codes', () => ({ generateBackupCodes: () => ['AAAAA-BBBBB'], hashBackupCodes: async (c: string[]) => c, findBackupCodeIndex: async () => -1 }))
vi.mock('qrcode', () => ({ default: { toString: async () => '<svg/>' } }))
vi.mock('@/lib/mfa/store', () => ({
  getUserSecurity: async () => null,
  upsertUserSecurity: async () => { h.writes.push({ table: 'user_security', op: 'upsert' }) },
  setMfaMetadataFlag: async () => undefined,
  setMfaWebauthnFlag: async () => undefined,
}))
vi.mock('@/lib/webauthn/store', () => ({
  listCredentials: async () => [{ id: 'cred', transports: [] }],
  countCredentials: async () => 0,
  getCredentialForUser: async () => null,
  deleteCredential: async () => true,
  insertCredential: async () => undefined,
}))
vi.mock('@/lib/webauthn/config', () => ({ getWebAuthnConfig: () => ({ rpID: 'x', rpName: 'x', expectedOrigins: ['http://x'] }), deviceLabelFromRequest: () => 'Mac' }))
vi.mock('@/lib/webauthn/challenge', () => ({
  WEBAUTHN_CHALLENGE_COOKIE: 'wachal', WEBAUTHN_CHALLENGE_COOKIE_OPTIONS: {}, signChallenge: () => 'c', readChallenge: () => 'c',
}))
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: async () => ({ challenge: 'c' }),
  generateAuthenticationOptions: async () => ({ challenge: 'c' }),
  verifyRegistrationResponse: async () => ({ verified: false }),
  verifyAuthenticationResponse: async () => ({ verified: false }),
}))
vi.mock('@/lib/telegram', () => ({ newLinkCode: () => 'code', botDeepLink: () => 'https://t.me/x', telegramConfigured: () => true, botUsername: () => 'bot' }))
vi.mock('@/lib/admin/giga-actor', () => ({ isSameOriginMutation: () => true }))
vi.mock('@/lib/reports/client-access', () => ({ publishedReportForCaller: async () => ({ ok: true, report: { id: 'r-1', version: 1 } }) }))
vi.mock('@/lib/reports/version-link', () => ({
  linkSecretConfigured: () => true,
  signVersionLink: async () => ({ url: 'https://x/r/v/token', expiresAt: '2027-01-01' }),
  VERSION_LINK_DEFAULT_DAYS: 30,
}))

process.env.GIGA_COOKIE_SECRET = 'test-secret-for-signed-tokens-0123456789'
process.env.AUTH_SECRET = 'test-auth-secret-for-step-up'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.app'

const { signImpersonation, IMP_COOKIE_NAME } = await import('@/lib/impersonation/token')
const setup = await import('@/app/api/v1/security/2fa/setup/route')
const verify = await import('@/app/api/v1/security/2fa/verify/route')
const disable = await import('@/app/api/v1/security/2fa/disable/route')
const challenge = await import('@/app/api/v1/security/2fa/challenge/route')
const regen = await import('@/app/api/v1/security/backup-codes/regenerate/route')
const regOptions = await import('@/app/api/v1/security/webauthn/register/options/route')
const authOptions = await import('@/app/api/v1/security/webauthn/authenticate/options/route')
const authVerify = await import('@/app/api/v1/security/webauthn/authenticate/verify/route')
const credentials = await import('@/app/api/v1/security/webauthn/credentials/route')
const password = await import('@/app/api/v1/settings/password/route')
const revokeAll = await import('@/app/api/v1/settings/sessions/revoke-all/route')
const telegram = await import('@/app/api/v1/settings/telegram/route')
const consents = await import('@/app/api/v1/consents/route')
const reportLink = await import('@/app/api/v1/reports/[id]/link/route')

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`
function holdClientSession(sid = ASID) {
  for (const c of createChunks('sb-supabase-auth-token', `base64-${stringToBase64URL(JSON.stringify({ access_token: jwt({ sub: UID, session_id: sid }) }))}`)) h.jar.set(c.name, c.value)
}
async function impersonate(mode: 'view' | 'edit' = 'edit') {
  holdClientSession()
  h.jar.set(IMP_COOKIE_NAME, await signImpersonation({ sid: SID, uid: UID, mode, aid: AID, alabel: 'a@x.io', tlabel: 'c@x.io', asid: ASID }))
}
const req = (path: string, method = 'POST', body: unknown = {}) =>
  new NextRequest(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(body) })

beforeEach(() => {
  h.jar = new Map()
  h.activity = []
  h.bindingRow = null
  h.bindingError = false
  h.sessionRow = null
  h.writes = []
  h.signOuts = []
  h.updateUser = 0
})

const CASES: Array<[string, () => Promise<Response>]> = [
  ['2fa/setup (первый фактор)', () => setup.POST(req('/api/v1/security/2fa/setup'))],
  ['2fa/verify', () => verify.POST(req('/api/v1/security/2fa/verify', 'POST', { code: '123456' }))],
  ['2fa/disable', () => disable.POST(req('/api/v1/security/2fa/disable', 'POST', { code: '123456' }))],
  ['2fa/challenge', () => challenge.POST(req('/api/v1/security/2fa/challenge', 'POST', { code: '123456' }))],
  ['backup-codes/regenerate', () => regen.POST(req('/api/v1/security/backup-codes/regenerate', 'POST', { code: '123456' }))],
  ['webauthn/register/options', () => regOptions.POST(req('/api/v1/security/webauthn/register/options'))],
  ['webauthn/authenticate/options', () => authOptions.POST(req('/api/v1/security/webauthn/authenticate/options'))],
  ['webauthn/authenticate/verify', () => authVerify.POST(req('/api/v1/security/webauthn/authenticate/verify', 'POST', { response: { id: 'cred' } }))],
  ['webauthn/credentials DELETE', () => credentials.DELETE(req('/api/v1/security/webauthn/credentials', 'DELETE', { id: 'cred' }))],
  ['settings/password', () => password.POST(req('/api/v1/settings/password', 'POST', { current: 'old-password-1', newPassword: 'New-password-123!' }))],
  ['settings/sessions/revoke-all', () => revokeAll.POST(req('/api/v1/settings/sessions/revoke-all'))],
  ['settings/telegram POST', () => telegram.POST()],
  ['settings/telegram DELETE', () => telegram.DELETE()],
  ['consents PUT', () => consents.PUT(req('/api/v1/consents', 'PUT', { kind: 'psych_profile', granted: true }))],
  ['reports/:id/link', () => reportLink.POST(req('/api/v1/reports/r-1/link'), { params: { id: 'r-1' } })],
]

describe('SR-07: действия с учётной записью из impersonation — 403', () => {
  it.each(CASES)('SR-07: %s отклоняется в режиме правки «от имени»', async (_name, call) => {
    await impersonate('edit')
    const res = await call()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe(MSG)
    expect(body.code).toBe('IMPERSONATION_FORBIDDEN')
    // Ничего не записано, сессии и пароль клиента не тронуты.
    expect(h.writes).toEqual([])
    expect(h.signOuts).toEqual([])
    expect(h.updateUser).toBe(0)
    expect(h.activity).toContainEqual(expect.objectContaining({ userId: UID, action: 'security.impersonation_action_blocked', category: 'security' }))
  })

  it('SR-07: cookie удалён — сессия узнаётся по серверной привязке и тоже получает 403', async () => {
    holdClientSession()
    h.bindingRow = { impersonation_session_id: SID }
    h.sessionRow = { id: SID, admin_id: AID, admin_email: 'a@x.io', admin_role: 'super_admin', target_user_id: UID, mode: 'edit', expires_at: '2099-01-01', ended_at: null }
    const res = await setup.POST(req('/api/v1/security/2fa/setup'))
    expect(res.status).toBe(403)
    expect(h.writes).toEqual([])
  })

  it('SR-07: привязку сессии не удалось прочитать — 503, фактор не ставится (fail closed)', async () => {
    holdClientSession()
    h.bindingError = true
    const res = await setup.POST(req('/api/v1/security/2fa/setup'))
    expect(res.status).toBe(503)
    expect(h.writes).toEqual([])
  })

  it('SR-07: окончание impersonation (просроченный cookie) не делает сессию клиентской', async () => {
    holdClientSession()
    h.jar.set(IMP_COOKIE_NAME, await signImpersonation({ sid: SID, uid: UID, mode: 'edit', aid: AID, alabel: 'a@x.io', tlabel: 'c@x.io', asid: ASID }, 1))
    const later = Date.now() + 2 * 3_600_000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(later)
    try {
      const res = await regen.POST(req('/api/v1/security/backup-codes/regenerate', 'POST', { code: '123456' }))
      expect(res.status).toBe(403)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('SR-07: сам клиент делает всё как раньше', () => {
  it('SR-07: обычная сессия клиента ставит первый фактор', async () => {
    holdClientSession()
    const res = await setup.POST(req('/api/v1/security/2fa/setup'))
    expect(res.status).toBe(200)
    expect(h.writes).toContainEqual({ table: 'user_security', op: 'upsert' })
  })

  it('SR-07: обычная сессия клиента меняет пароль', async () => {
    holdClientSession()
    const res = await password.POST(req('/api/v1/settings/password', 'POST', { current: 'old-password-1', newPassword: 'New-password-123!' }))
    expect(res.status).toBe(200)
    expect(h.updateUser).toBe(1)
  })

  it('SR-07: обычная сессия клиента выдаёт ссылку на отчёт', async () => {
    holdClientSession()
    const res = await reportLink.POST(req('/api/v1/reports/r-1/link'), { params: { id: 'r-1' } })
    expect(res.status).toBe(200)
  })
})
