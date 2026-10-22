/**
 * W6: вход и восстановление пароля не должны «отскакивать» в middleware.
 *
 *  • Ссылка «Задать новый пароль» (/auth/verify) создаёт сессию и ведёт на
 *    /auth/reset-password. Middleware считал эту страницу «страницей входа» и
 *    уводил вошедшего пользователя в кабинет — форма нового пароля была
 *    недостижима, восстановление не работало ни у кого.
 *  • Персонал, у которого profiles.role = 'client' (роль только в staff_roles),
 *    в режиме техработ попадал на /maintenance — в том числе с /settings, где
 *    меняют пароль и включают 2FA.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const s = vi.hoisted(() => ({
  settings: { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false },
  user: null as null | { id: string; user_metadata: Record<string, unknown>; app_metadata?: Record<string, unknown> },
  role: 'client',
  staffRow: null as null | { role: string },
  stepUp: false,
}))

const withAbort = <T extends object>(o: T): T => Object.assign(o, { abortSignal: () => o })
vi.mock('@/lib/settings/edge', () => ({ edgeSettings: async () => s.settings }))
vi.mock('@/lib/mfa/step-up-edge', () => ({ MFA_COOKIE_NAME: 'mfa', verifyStepUpEdge: async () => s.stepUp }))
vi.mock('@/lib/platform/sections-edge', () => ({ blockedSectionFor: async () => null, loadEdgeSections: async () => [] }))
vi.mock('@/lib/impersonation/edge', () => ({
  isImpersonationActiveEdge: async () => false,
  endImpersonationEdge: async () => {},
  auditImpersonatedRequestEdge: async () => {},
}))
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => {
    const from = (table: string) => ({
      select: () => ({
        eq: () => withAbort({
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
const get = (path: string) => middleware(new NextRequest(`http://localhost${path}`))
const loc = (r: Response) => r.headers.get('location') ?? ''

beforeEach(() => {
  s.settings = { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false }
  s.user = { id: 'u1', user_metadata: {} }
  s.role = 'client'
  s.staffRow = null
  s.stepUp = false
})

describe('страница нового пароля после ссылки из письма', () => {
  it('вошедший по ссылке клиент видит форму, а не кабинет', async () => {
    const r = await get('/auth/reset-password')
    expect(r.status).toBe(200)
    expect(loc(r)).toBe('')
  })

  it('и super_admin, и сотрудник с ролью только в staff_roles тоже', async () => {
    s.role = 'super_admin'
    expect((await get('/auth/reset-password')).status).toBe(200)
    s.role = 'client'
    s.staffRow = { role: 'super_expert' }
    expect((await get('/auth/reset-password')).status).toBe(200)
  })

  it('не требует 2FA и не закрывается техработами (это вход, а не кабинет)', async () => {
    s.user = { id: 'u1', user_metadata: {}, app_metadata: { mfa_totp: true } }
    s.settings.maintenance.enabled = true
    const r = await get('/auth/reset-password')
    expect(r.status).toBe(200)
  })

  it('гость тоже открывает страницу (она сама скажет, что ссылка истекла)', async () => {
    s.user = null
    expect((await get('/auth/reset-password')).status).toBe(200)
  })

  it('/auth/callback с кодом доходит до обработчика и у вошедшего пользователя', async () => {
    const r = await get('/auth/callback?code=fcb2630e-6fa8-4abb-a93f-3f180e40b510')
    expect(r.status).toBe(200)
  })

  it('страницы входа по-прежнему уводят вошедшего в его кабинет', async () => {
    expect(loc(await get('/login'))).toMatch(/\/dashboard$/)
    expect(loc(await get('/forgot-password'))).toMatch(/\/dashboard$/)
    s.role = 'super_admin'
    expect(loc(await get('/login'))).toMatch(/\/admin-giga-panel$/)
  })
})

describe('техработы не закрывают персонал с profiles.role = client', () => {
  it('сотрудник из staff_roles открывает настройки (смена пароля, 2FA)', async () => {
    s.settings.maintenance.enabled = true
    s.staffRow = { role: 'super_admin' }
    const r = await get('/settings')
    expect(loc(r)).not.toMatch(/maintenance/)
  })

  it('обычный клиент по-прежнему уходит на /maintenance', async () => {
    s.settings.maintenance.enabled = true
    expect(loc(await get('/settings'))).toMatch(/\/maintenance$/)
    expect(loc(await get('/client/home'))).toMatch(/\/maintenance$/)
  })
})
