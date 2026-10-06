/**
 * Кто попадает в ГИГА-панель. Правило из ветки whatsapp-ai-production (только
 * одобренный аккаунт) сохранено и распространено на роли персонала из
 * staff_roles, которые появились вместе с RBAC.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: null as null | { role?: string; status?: string },
  staff: null as null | { role?: string },
  security: null as null | { totp_enabled?: boolean },
  securityError: null as null | { message: string },
  profileError: null as null | { message: string },
  passkeys: 0,
  settings: { staff_require_mfa: false } as Record<string, boolean>,
}))
const prismaMock = vi.hoisted(() => ({ $queryRaw: vi.fn() }))

function table(name: string) {
  if (name === 'webauthn_credentials') {
    return { select: () => ({ eq: async () => ({ count: db.passkeys, error: null }) }) }
  }
  const row = name === 'profiles' ? db.profile : name === 'user_security' ? db.security : db.staff
  const error = name === 'user_security' ? db.securityError : name === 'profiles' ? db.profileError : null
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }
}

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: db.getUser }, from: table }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: table }) }))
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (key: string) => db.settings[key] ?? false }))

import { getGigaActor, requireGiga, signStaffCookie, type GigaActor } from '@/lib/admin/giga-actor'
import { verifyToken } from '@/lib/security/signed-token'
import { MFA_COOKIE_NAME, signStepUp } from '@/lib/mfa/step-up'
import { E2E_SEAM_COOKIE_NAME, signE2eSeamCookie } from '@/lib/admin/e2e-auth-seam-edge'

process.env.AUTH_SECRET = 'test-auth-secret-for-step-up'

function request(cookie?: string, extraCookies: string[] = []) {
  const cookies = [...(cookie ? [`aistart360_giga=${cookie}`] : []), ...extraCookies]
  return new NextRequest('http://localhost/api/giga-admin/test', {
    headers: cookies.length ? { cookie: cookies.join('; ') } : undefined,
  })
}

describe('getGigaActor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.profile = null
    db.staff = null
    db.security = null
    db.securityError = null
    db.profileError = null
    db.passkeys = 0
    db.settings = { staff_require_mfa: false }
  })

  it('accepts an approved personal super_admin session', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } } })
    db.profile = { role: 'super_admin', status: 'approved' }

    const actor = await getGigaActor(request())
    expect(actor).toMatchObject({ id: 'admin-1', kind: 'session', email: 'admin@example.com', role: 'super_admin' })
    expect(actor?.permissions).toContain('settings.manage')
  })

  it('accepts an approved staff member by their staff_roles row', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: 'support-1', email: 'support@example.com' } } })
    db.profile = { role: 'client', status: 'approved' }
    db.staff = { role: 'support' }

    const actor = await getGigaActor(request())
    expect(actor).toMatchObject({ id: 'support-1', kind: 'session', role: 'support' })
    // Роль поддержки не даёт настройки платформы.
    expect(actor?.permissions).not.toContain('settings.manage')
  })

  it.each(['pending_approval', 'rejected', 'blocked', 'archived'])(
    'rejects a personal super_admin whose status is %s',
    async (status) => {
      db.getUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } } })
      db.profile = { role: 'super_admin', status }

      await expect(getGigaActor(request())).resolves.toBeNull()
    },
  )

  it('rejects a staff member whose account is not approved yet', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: 'support-1', email: 'support@example.com' } } })
    db.profile = { role: 'client', status: 'pending_approval' }
    db.staff = { role: 'support' }

    await expect(getGigaActor(request())).resolves.toBeNull()
  })

  it('rejects an approved session without any staff role', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: 'client-1', email: 'client@example.com' } } })
    db.profile = { role: 'client', status: 'approved' }

    await expect(getGigaActor(request())).resolves.toBeNull()
  })

  it('the retired break-glass cookie grants nothing (the shared-password entry was removed)', async () => {
    db.getUser.mockResolvedValue({ data: { user: null } })
    await expect(getGigaActor(request('v1.anything.at-all'))).resolves.toBeNull()
    const guard = await requireGiga(request('v1.anything.at-all'), 'users.view')
    expect(guard.response?.status).toBe(403)
  })
})

describe('E2E auth seam (test-only)', () => {
  const SECRET = 'e2e-seam-secret-0123456789abcdef-xyz'
  const USER = '0b6d6a1e-8f7a-4c3e-9d2b-5a4f3e2d1c0b'

  beforeEach(() => {
    vi.resetAllMocks()
    vi.unstubAllEnvs()
    db.profile = null
    db.staff = null
    db.settings = { staff_require_mfa: false }
    db.getUser.mockResolvedValue({ data: { user: null } })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function seamRequest() {
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', SECRET)
    const cookie = await signE2eSeamCookie(USER)
    return request(undefined, [`${E2E_SEAM_COOKIE_NAME}=${cookie}`])
  }

  it('resolves the seeded user with their REAL staff role from the database', async () => {
    const req = await seamRequest()
    prismaMock.$queryRaw.mockResolvedValue([{ role: 'client', status: 'approved', email: 'e2e@x.kz', staff_role: 'analyst' }])
    const actor = await getGigaActor(req)
    expect(actor).toMatchObject({ id: USER, kind: 'session', role: 'analyst', email: 'e2e@x.kz' })
    expect(actor?.permissions).not.toContain('settings.manage')

    prismaMock.$queryRaw.mockResolvedValue([{ role: 'super_admin', status: 'approved', email: null, staff_role: null }])
    expect(await getGigaActor(req)).toMatchObject({ id: USER, role: 'super_admin' })
  })

  it('admits nobody whose profile is not approved or who has no staff role', async () => {
    const req = await seamRequest()
    prismaMock.$queryRaw.mockResolvedValue([{ role: 'super_admin', status: 'pending_approval', email: null, staff_role: 'super_admin' }])
    expect(await getGigaActor(req)).toBeNull()
    prismaMock.$queryRaw.mockResolvedValue([{ role: 'client', status: 'approved', email: null, staff_role: null }])
    expect(await getGigaActor(req)).toBeNull()
    prismaMock.$queryRaw.mockResolvedValue([])
    expect(await getGigaActor(req)).toBeNull()
  })

  it('is inert in production even with the secret and an authentic cookie', async () => {
    const req = await seamRequest()
    prismaMock.$queryRaw.mockResolvedValue([{ role: 'super_admin', status: 'approved', email: null, staff_role: 'super_admin' }])
    vi.stubEnv('NODE_ENV', 'production')
    expect(await getGigaActor(req)).toBeNull()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('is inert without the secret (or with a short one)', async () => {
    const req = await seamRequest()
    prismaMock.$queryRaw.mockResolvedValue([{ role: 'super_admin', status: 'approved', email: null, staff_role: 'super_admin' }])
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', '')
    expect(await getGigaActor(req)).toBeNull()
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', 'short-secret')
    expect(await getGigaActor(req)).toBeNull()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })

  it('rejects a cookie signed with another secret', async () => {
    const req = await seamRequest()
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', SECRET.replace('e2e', 'xxx'))
    prismaMock.$queryRaw.mockResolvedValue([{ role: 'super_admin', status: 'approved', email: null, staff_role: 'super_admin' }])
    expect(await getGigaActor(req)).toBeNull()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })
})

describe('second factor on the GIGA API (middleware does not gate /api/*)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.profile = { role: 'super_admin', status: 'approved' }
    db.staff = null
    db.security = null
    db.securityError = null
    db.profileError = null
    db.passkeys = 0
    db.settings = { staff_require_mfa: false }
  })

  const session = (meta: { app?: Record<string, unknown>; user?: Record<string, unknown> } = {}) =>
    db.getUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'a@x.kz', app_metadata: meta.app ?? {}, user_metadata: meta.user ?? {} } } })

  it('an enrolled staff session without the step-up cookie is refused with a clear code', async () => {
    session({ app: { mfa_totp: true } })
    expect(await getGigaActor(request())).toBeNull()
    const guard = await requireGiga(request(), 'users.view')
    expect(guard.response?.status).toBe(403)
    expect(await guard.response?.json()).toMatchObject({ code: 'MFA_STEP_UP_REQUIRED' })
  })

  it('the signed step-up cookie of the same user admits the session', async () => {
    session({ app: { mfa_totp: true } })
    const actor = await getGigaActor(request(undefined, [`${MFA_COOKIE_NAME}=${signStepUp('admin-1')}`]))
    expect(actor).toMatchObject({ id: 'admin-1', kind: 'session' })
    // Another user's proof does not count.
    expect(await getGigaActor(request(undefined, [`${MFA_COOKIE_NAME}=${signStepUp('someone-else')}`]))).toBeNull()
  })

  it('clearing the user-editable flag does not bypass the gate: enrolment is read from the database', async () => {
    session({ user: { mfa_totp: false } })
    db.security = { totp_enabled: true }
    expect(await getGigaActor(request())).toBeNull()
    db.security = null
    db.passkeys = 1
    expect(await getGigaActor(request())).toBeNull()
  })

  it('when the platform requires 2FA for staff, a session without a second factor must enrol', async () => {
    session()
    db.settings.staff_require_mfa = true
    const guard = await requireGiga(request(), 'users.view')
    expect(await guard.response?.json()).toMatchObject({ code: 'MFA_ENROLLMENT_REQUIRED' })
    db.settings.staff_require_mfa = false
    expect(await getGigaActor(request())).toMatchObject({ id: 'admin-1' })
  })

  it('an MFA-blocked staff refusal is marked as staff, so shared routes do not fall back to the expert path', async () => {
    session({ app: { mfa_totp: true } })
    const guard = await requireGiga(request(), 'users.view')
    expect(guard.staff).toBe(true)
    // A plain client session is not staff.
    db.profile = { role: 'client', status: 'approved' }
    expect((await requireGiga(request(), 'users.view')).staff).toBe(false)
  })

  it('a failing second-factor lookup is a 503 for a staff caller, never a silent non-staff fall-through', async () => {
    session()
    db.securityError = { message: 'timeout' }
    const guard = await requireGiga(request(), 'users.view')
    expect(guard.response?.status).toBe(503)
    expect(guard.staff).toBe(true)
  })

  it('a failing role lookup is not "no role"', async () => {
    session()
    db.profileError = { message: 'timeout' }
    const guard = await requireGiga(request(), 'users.view')
    expect(guard.response?.status).toBe(503)
    expect(guard.staff).toBe(true)
  })
})

describe('signStaffCookie (impersonation keeps the admin in the panel)', () => {
  const base = { role: 'super_admin' as const, permissions: [], email: 'a@x.kz' }
  it('is minted for a personal session actor', async () => {
    const token = await signStaffCookie({ ...base, id: 'admin-1', kind: 'session' } as GigaActor)
    expect(token).toBeTruthy()
    const v = await verifyToken<{ sub: string }>('staff', token!)
    expect(v.ok && v.claims.sub).toBe('admin-1')
  })

  it('is NOT re-minted for a staff-cookie actor (no indefinite extension without a second factor)', async () => {
    expect(await signStaffCookie({ ...base, id: 'admin-1', kind: 'staff_cookie' } as GigaActor)).toBeNull()
  })
})
