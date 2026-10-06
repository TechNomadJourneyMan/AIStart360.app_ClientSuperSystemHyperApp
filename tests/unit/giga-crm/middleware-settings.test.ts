/**
 * Platform settings enforced in middleware: maintenance mode and mandatory
 * staff 2FA; the panel has no shared-password entry any more, only the
 * test-only E2E seam outside production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const s = vi.hoisted(() => ({
  settings: { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false },
  user: null as null | { id: string; user_metadata: Record<string, unknown> },
  role: 'client',
  staffRow: null as null | { role: string },
}))

vi.mock('@/lib/settings/edge', () => ({ edgeSettings: async () => s.settings }))
vi.mock('@/lib/mfa/step-up-edge', () => ({ MFA_COOKIE_NAME: 'mfa', verifyStepUpEdge: async () => false }))
vi.mock('@/lib/platform/sections-edge', () => ({ blockedSectionFor: async () => null }))
vi.mock('@/lib/impersonation/edge', () => ({
  isImpersonationActiveEdge: async () => false,
  endImpersonationEdge: async () => {},
  auditImpersonatedRequestEdge: async () => {},
}))
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => {
    const from = (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'profiles' ? { role: s.role, status: 'approved' } : s.staffRow,
          }),
        }),
      }),
    })
    return { supabase: { from, auth: { signOut: async () => {} } }, response: NextResponse.next(), user: s.user }
  },
}))

const { middleware } = await import('@/middleware')
const { E2E_SEAM_COOKIE_NAME, signE2eSeamCookie } = await import('@/lib/admin/e2e-auth-seam-edge')
const get = (path: string, cookie = '') => middleware(new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} }))
const loc = (r: Response) => r.headers.get('location') ?? ''

beforeEach(() => {
  s.settings = { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false }
  s.user = { id: 'u1', user_metadata: {} }
  s.role = 'client'
  s.staffRow = null
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('maintenance mode', () => {
  it('sends clients and (legacy) owners to /maintenance', async () => {
    s.settings.maintenance.enabled = true
    const r = await get('/client/home')
    expect(r.status).toBe(307)
    expect(loc(r)).toMatch(/\/maintenance$/)
    s.role = 'owner'
    expect(loc(await get('/owner/dashboard'))).toMatch(/\/maintenance$/)
  })

  it('leaves staff, experts and the maintenance page itself alone', async () => {
    s.settings.maintenance.enabled = true
    s.role = 'expert'
    expect(loc(await get('/expert/dashboard'))).not.toMatch(/maintenance/)
    s.role = 'super_admin'
    expect((await get('/admin-giga-panel')).status).toBe(200)
    s.user = null
    expect((await get('/maintenance')).status).toBe(200)
  })

  it('is inert when switched off', async () => {
    expect(loc(await get('/client/home'))).not.toMatch(/maintenance/)
  })
})

describe('mandatory staff 2FA', () => {
  it('sends a staff member without 2FA to the security settings', async () => {
    s.settings.staff_require_mfa = true
    s.role = 'super_admin'
    const r = await get('/admin-giga-panel/users')
    expect(r.status).toBe(307)
    expect(loc(r)).toContain('/settings?tab=security&mfa=required')
  })

  it('lets staff in when not required', async () => {
    s.role = 'super_admin'
    expect((await get('/admin-giga-panel/users')).status).toBe(200)
  })

  it('an enrolled staff member goes through the usual step-up', async () => {
    s.settings.staff_require_mfa = true
    s.role = 'super_admin'
    s.user = { id: 'u1', user_metadata: { mfa_totp: true } }
    expect(loc(await get('/admin-giga-panel'))).toContain('/2fa')
  })
})

describe('no shared-password entry', () => {
  it('the retired break-glass cookie does not open the panel', async () => {
    s.user = null
    const r = await get('/admin-giga-panel', 'aistart360_giga=v1.forged.token')
    expect(r.status).toBe(307)
    expect(loc(r)).toContain('/giga-login')
  })

  it('a signed-in non-staff user is sent to /giga-login (which only links to the personal /login)', async () => {
    s.role = 'client'
    expect(loc(await get('/admin-giga-panel'))).toContain('/giga-login')
    s.role = 'super_admin'
    expect(loc(await get('/giga-login'))).toMatch(/\/admin-giga-panel$/)
  })
})

describe('E2E auth seam (test-only)', () => {
  const SECRET = 'middleware-seam-secret-0123456789abcd'
  const USER = '6a0b5c3d-2e1f-4a7b-9c8d-1e2f3a4b5c6d'

  it('an authentic seam cookie renders the panel shell outside production', async () => {
    s.user = null
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', SECRET)
    const cookie = `${E2E_SEAM_COOKIE_NAME}=${await signE2eSeamCookie(USER)}`
    expect((await get('/admin-giga-panel/agents', cookie)).status).toBe(200)
    expect(loc(await get('/giga-login', cookie))).toMatch(/\/admin-giga-panel$/)
  })

  it('is ignored in production, without the secret and when forged', async () => {
    s.user = null
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', SECRET)
    const cookie = `${E2E_SEAM_COOKIE_NAME}=${await signE2eSeamCookie(USER)}`
    expect(loc(await get('/admin-giga-panel', `${E2E_SEAM_COOKIE_NAME}=${USER}.${'A'.repeat(43)}`))).toContain('/giga-login')
    vi.stubEnv('NODE_ENV', 'production')
    expect(loc(await get('/admin-giga-panel', cookie))).toContain('/giga-login')
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('E2E_AUTH_SEAM_SECRET', '')
    expect(loc(await get('/admin-giga-panel', cookie))).toContain('/giga-login')
  })
})

describe('OAuth-код, прилетевший не на свой адрес', () => {
  it('переклеивает ?code= с корня и страниц входа на /auth/callback', async () => {
    s.user = null
    for (const path of ['/', '/login', '/register']) {
      const r = await get(`${path}?code=fcb2630e-6fa8-4abb-a93f-3f180e40b510`)
      expect(r.status, path).toBe(307)
      expect(loc(r), path).toContain('/auth/callback?code=fcb2630e-6fa8-4abb-a93f-3f180e40b510')
    }
  })

  it('сохраняет next и не трогает короткие или чужие code', async () => {
    s.user = null
    expect(loc(await get('/login?code=fcb2630e-6fa8-4abb-a93f-3f180e40b510&next=%2Fgri'))).toContain('next=%2Fgri')
    // Слишком короткое значение — это не OAuth-код (например, промокод).
    expect(loc(await get('/login?code=SALE10'))).not.toContain('/auth/callback')
    // На других страницах параметр не перехватываем.
    expect(loc(await get('/client/home?code=fcb2630e-6fa8-4abb-a93f-3f180e40b510'))).not.toContain('/auth/callback')
  })
})

describe('ссылка из письма', () => {
  it('/auth/verify доходит до маршрута и не уводится на /login', async () => {
    s.user = null
    const r = await get('/auth/verify?token_hash=abc&type=magiclink')
    expect(r.status).toBe(200)
    expect(loc(r)).not.toContain('/login')
  })

  it('работает и когда в браузере уже есть сессия', async () => {
    s.role = 'client'
    const r = await get('/auth/verify?token_hash=abc&type=recovery')
    expect(r.status).toBe(200)
  })
})
