/**
 * Platform settings enforced in middleware: maintenance mode, mandatory
 * staff 2FA and the break-glass switch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const s = vi.hoisted(() => ({
  settings: { maintenance: { enabled: false, message: '', until: '' }, break_glass_enabled: true, staff_require_mfa: false },
  user: null as null | { id: string; user_metadata: Record<string, unknown> },
  role: 'client',
  staffRow: null as null | { role: string },
  gigaCookie: false,
}))

vi.mock('@/lib/settings/edge', () => ({ edgeSettings: async () => s.settings }))
vi.mock('@/lib/giga-cookie-edge', () => ({
  GIGA_COOKIE_NAME: 'aistart360_giga',
  verifyGigaRoleEdge: async (v?: string) => (v && s.gigaCookie ? 'super_admin' : null),
}))
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
const get = (path: string, cookie = '') => middleware(new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} }))
const loc = (r: Response) => r.headers.get('location') ?? ''

beforeEach(() => {
  s.settings = { maintenance: { enabled: false, message: '', until: '' }, break_glass_enabled: true, staff_require_mfa: false }
  s.user = { id: 'u1', user_metadata: {} }
  s.role = 'client'
  s.staffRow = null
  s.gigaCookie = false
})

describe('maintenance mode', () => {
  it('sends clients and owners to /maintenance', async () => {
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

describe('break-glass switch', () => {
  it('shared-password cookie opens the panel only while enabled', async () => {
    s.user = null
    s.gigaCookie = true
    expect((await get('/admin-giga-panel', 'aistart360_giga=x')).status).toBe(200)
    s.settings.break_glass_enabled = false
    const r = await get('/admin-giga-panel', 'aistart360_giga=x')
    expect(r.status).toBe(307)
    expect(loc(r)).toContain('/giga-login')
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
