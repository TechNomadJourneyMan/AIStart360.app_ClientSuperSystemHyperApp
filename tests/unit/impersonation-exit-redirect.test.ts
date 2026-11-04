/** «Выйти из режима пользователя» возвращает сотрудника в его кабинет. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({ claims: null as null | Record<string, unknown> }))

vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: 'tok' }), delete: () => {} }) }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({ auth: { signOut: async () => ({}) } }) }))
vi.mock('@/lib/impersonation/token', () => ({
  IMP_COOKIE_NAME: 'imp',
  readImpersonation: async () => ({ ok: !!s.claims, claims: s.claims }),
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({ update: () => ({ eq: () => ({ is: () => ({ select: async () => ({ data: [{ id: 'sid' }] }) }) }) }) }),
  }),
}))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => {} }))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => {} }))

const { POST } = await import('@/app/api/v1/impersonation/exit/route')
const exit = async () => (await (await POST(new NextRequest('http://localhost/api/v1/impersonation/exit', { method: 'POST' }))).json()).redirect

beforeEach(() => { s.claims = null })

describe('POST /api/v1/impersonation/exit', () => {
  it('админ возвращается в карточку пользователя в ГИГА-CRM', async () => {
    s.claims = { sid: 'sid', uid: 'user-1', aid: 'a', alabel: 'a@x', arole: 'admin' }
    expect(await exit()).toBe('/admin-giga-panel/users/user-1')
  })

  it('SuperExpert — в карточку в своём кабинете /super-expert', async () => {
    s.claims = { sid: 'sid', uid: 'user-1', aid: 'a', alabel: 'a@x', arole: 'super_expert' }
    expect(await exit()).toBe('/super-expert/users/user-1')
  })

  it('без сессии impersonation — на главную панели', async () => {
    expect(await exit()).toBe('/admin-giga-panel')
  })
})
