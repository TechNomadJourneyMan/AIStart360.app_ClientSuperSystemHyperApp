/**
 * Кто попадает в ГИГА-панель. Правило из ветки whatsapp-ai-production (только
 * одобренный аккаунт) сохранено и распространено на роли персонала из
 * staff_roles, которые появились вместе с RBAC.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: null as null | { role?: string; status?: string },
  staff: null as null | { role?: string },
  security: null as null | { totp_enabled?: boolean },
  passkeys: 0,
  settings: { break_glass_enabled: true, staff_require_mfa: false } as Record<string, boolean>,
}))
const gigaCookie = vi.hoisted(() => ({ verify: vi.fn() }))

function table(name: string) {
  if (name === 'webauthn_credentials') {
    return { select: () => ({ eq: async () => ({ count: db.passkeys, error: null }) }) }
  }
  const row = name === 'profiles' ? db.profile : name === 'user_security' ? db.security : db.staff
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }
}

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: db.getUser }, from: table }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: table }) }))
vi.mock('@/lib/giga-cookie', () => ({
  GIGA_COOKIE_NAME: 'aistart360_giga',
  verifyGigaRole: gigaCookie.verify,
}))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (key: string) => db.settings[key] ?? false }))

import { getGigaActor, requireGiga } from '@/lib/admin/giga-actor'
import { MFA_COOKIE_NAME, signStepUp } from '@/lib/mfa/step-up'

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
    db.passkeys = 0
    db.settings = { break_glass_enabled: true, staff_require_mfa: false }
    gigaCookie.verify.mockReturnValue(null)
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

  it('keeps the signed break-glass cookie as a recovery fallback', async () => {
    db.getUser.mockResolvedValue({ data: { user: null } })
    gigaCookie.verify.mockReturnValue('super_admin')

    const actor = await getGigaActor(request('signed-token'))
    expect(actor).toMatchObject({ id: 'giga:super_admin', kind: 'break_glass', role: 'super_admin' })
    expect(gigaCookie.verify).toHaveBeenCalledWith('signed-token')
  })
})

describe('second factor on the GIGA API (middleware does not gate /api/*)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.profile = { role: 'super_admin', status: 'approved' }
    db.staff = null
    db.security = null
    db.passkeys = 0
    db.settings = { break_glass_enabled: true, staff_require_mfa: false }
    gigaCookie.verify.mockReturnValue(null)
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
})
