/**
 * Вход в кабинет SuperExpert: страница входа открыта, сам кабинет — нет.
 * Гость и пользователь без роли персонала до кабинета не доходят.
 */
import { describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const state = vi.hoisted(() => ({ staffRole: null as string | null }))

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (request: NextRequest) => {
    const role = request.cookies.get('aistart360_role')?.value ?? null
    const signedIn = role !== null
    return {
      response: NextResponse.next({ request }),
      user: signedIn ? { id: 'user-1', email: 'se@aistart360.app', user_metadata: {} } : null,
      supabase: {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: table === 'staff_roles'
                  ? (state.staffRole ? { role: state.staffRole } : null)
                  : { role, status: 'approved' },
              }),
            }),
          }),
        }),
      },
    }
  },
}))
vi.mock('@/lib/settings/edge', () => ({
  edgeSettings: async () => ({ break_glass_enabled: true, staff_require_mfa: false, maintenance: { enabled: false } }),
}))

const { middleware } = await import('../../../middleware')

const go = (path: string, role?: string) => {
  const req = new NextRequest(new URL(path, 'http://localhost:3000'))
  if (role) req.cookies.set('aistart360_role', role)
  return middleware(req)
}
const location = (res: Response) => new URL(res.headers.get('location')!).pathname

describe('шлагбаум кабинета SuperExpert', () => {
  it('страница входа открыта всем', async () => {
    state.staffRole = null
    const res = await go('/super-expert/login')
    expect(res.status).toBe(200)
  })

  it('гостя уводит на свой вход, а не на клиентский', async () => {
    state.staffRole = null
    const res = await go('/super-expert')
    expect(res.status).toBe(307)
    expect(location(res)).toBe('/super-expert/login')
  })

  it('обычного клиента без роли персонала не пускает', async () => {
    state.staffRole = null
    const res = await go('/super-expert/users', 'client')
    expect(res.status).toBe(307)
    expect(location(res)).toBe('/super-expert/login')
  })

  it('роль без права работы с пользователями не пускает', async () => {
    state.staffRole = 'content_manager'
    const res = await go('/super-expert/users', 'client')
    expect(res.status).toBe(307)
    expect(location(res)).toBe('/super-expert/login')
  })

  it('SuperExpert проходит в кабинет', async () => {
    state.staffRole = 'super_expert'
    const res = await go('/super-expert/users', 'client')
    expect(res.status).toBe(200)
  })

  it('Super Admin проходит тоже', async () => {
    state.staffRole = null
    const res = await go('/super-expert', 'super_admin')
    expect(res.status).toBe(200)
  })

  it('похожий путь не открывает кабинет по ошибке', async () => {
    state.staffRole = null
    const res = await go('/super-expertise', 'client')
    const to = res.headers.get('location')
    expect(to === null || new URL(to).pathname !== '/super-expert/login').toBe(true)
  })

  it('после входа SuperExpert приземляется в своём кабинете', async () => {
    state.staffRole = 'super_expert'
    const res = await go('/login', 'client')
    expect(res.status).toBe(307)
    expect(location(res)).toBe('/super-expert')
  })
})
