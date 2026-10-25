import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  setSession: vi.fn(),
  profile: { full_name: 'Клиент', role: 'client', status: 'approved' },
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { setSession: s.setSession },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: table === 'profiles' ? s.profile : null, error: null,
      }) }) }),
    }),
  }),
}))
vi.mock('@/lib/events/client', () => ({ track: vi.fn(), flushEvents: vi.fn() }))

import { useAuthStore } from '@/stores/auth.store'

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, role: null, isLoading: false, error: null })
  s.setSession.mockResolvedValue({
    data: { user: { id: 'verified-user', email: 'client@example.kz' } }, error: null,
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('password login store', () => {
  it('makes one request for rapid repeated submissions, exposes loading and retains the denial', async () => {
    let reply!: (response: Response) => void
    const fetch = vi.fn(() => new Promise<Response>(resolve => { reply = resolve }))
    vi.stubGlobal('fetch', fetch)
    const first = useAuthStore.getState().login('client@example.kz', 'wrong')
    expect(useAuthStore.getState().isLoading).toBe(true)
    await useAuthStore.getState().login('client@example.kz', 'wrong')
    await useAuthStore.getState().login('client@example.kz', 'wrong')
    expect(fetch).toHaveBeenCalledTimes(1)
    reply(Response.json({ ok: false, error: 'Неверный адрес почты или пароль.' }))
    await expect(first).rejects.toThrow('Неверный адрес почты или пароль.')
    expect(useAuthStore.getState()).toMatchObject({
      isLoading: false, user: null, error: 'Неверный адрес почты или пароль.',
    })
    expect(s.setSession).not.toHaveBeenCalled()
  })

  it('installs the authenticated session before loading the user and preserves role routing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      ok: true, session: { access_token: 'access-token', refresh_token: 'refresh-token' },
    })))
    await useAuthStore.getState().login('client@example.kz', 'correct')
    expect(s.setSession).toHaveBeenCalledWith({ access_token: 'access-token', refresh_token: 'refresh-token' })
    expect(useAuthStore.getState()).toMatchObject({
      isLoading: false, role: 'client', error: null,
      user: { id: 'verified-user', name: 'Клиент', role: 'client' },
    })
  })
})
