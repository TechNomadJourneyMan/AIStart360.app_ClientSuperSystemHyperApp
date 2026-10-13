/**
 * Middleware speed-up: the own-profile read (role/status) starts together with
 * the Auth check, and its result is used only for the user getUser() verified.
 * Identity still comes from getUser(); anything unexpected falls back to the
 * sequential read middleware did before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const s = vi.hoisted(() => ({
  session: null as null | { access_token: string },
  verifiedUser: null as null | { id: string },
  getUserCalledAfterFetch: false,
  fetchStarted: false,
  profileRows: [{ role: 'super_admin', status: 'approved' }] as unknown,
  profileStatus: 200,
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: s.session }, error: null }),
      getUser: async () => {
        s.getUserCalledAfterFetch = s.fetchStarted
        return { data: { user: s.verifiedUser }, error: null }
      },
    },
  }),
}))

const { updateSession } = await import('@/lib/supabase/middleware')

function jwt(sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  // Non-ASCII metadata must not break the subject lookup.
  return `${b64({ alg: 'HS256' })}.${b64({ sub, user_metadata: { full_name: 'Тест Тестов' } })}.sig`
}

const req = () => new NextRequest('http://localhost/dashboard')

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  s.session = { access_token: jwt('u1') }
  s.verifiedUser = { id: 'u1' }
  s.fetchStarted = false
  s.getUserCalledAfterFetch = false
  s.profileRows = [{ role: 'super_admin', status: 'approved' }]
  s.profileStatus = 200
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    s.fetchStarted = true
    expect(url).toBe('https://db.example/rest/v1/profiles?id=eq.u1&select=role,status')
    // The caller's own token: the RLS self-read, not a service-role read.
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${s.session!.access_token}`)
    return new Response(JSON.stringify(s.profileRows), { status: s.profileStatus })
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('updateSession: profile read alongside getUser()', () => {
  it('starts the read before getUser() returns and hands it over for the verified user', async () => {
    const out = await updateSession(req())
    expect(out.user).toEqual({ id: 'u1' })
    expect(out.profile).toEqual({ role: 'super_admin', status: 'approved' })
    expect(s.getUserCalledAfterFetch).toBe(true)
  })

  it('drops the result when getUser() verifies nobody or someone else', async () => {
    s.verifiedUser = null
    expect((await updateSession(req())).profile).toBeUndefined()
    s.verifiedUser = { id: 'u2' }
    expect((await updateSession(req())).profile).toBeUndefined()
  })

  it('a missing row reads as no role/status (same as maybeSingle → null)', async () => {
    s.profileRows = []
    expect((await updateSession(req())).profile).toEqual({ role: null, status: null })
  })

  it('a failed read is not handed over (middleware reads the row itself)', async () => {
    s.profileStatus = 500
    expect((await updateSession(req())).profile).toBeUndefined()
  })

  it('no session cookie → no speculative read', async () => {
    s.session = null
    s.verifiedUser = null
    const out = await updateSession(req())
    expect(out.profile).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a malformed token → no speculative read', async () => {
    s.session = { access_token: 'not-a-jwt' }
    expect((await updateSession(req())).profile).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('middleware uses the handed-over profile', () => {
  it('skips the sequential profiles query when the row came with the session', async () => {
    vi.resetModules()
    const from = vi.fn()
    vi.doMock('@/lib/supabase/middleware', () => ({
      updateSession: async () => ({
        supabase: { from, auth: { signOut: async () => {} } },
        response: NextResponse.next(),
        user: { id: 'u1', app_metadata: {}, user_metadata: {} },
        profile: { role: 'client', status: 'approved' },
      }),
    }))
    vi.doMock('@/lib/settings/edge', () => ({ edgeSettings: async () => ({ maintenance: { enabled: false }, staff_require_mfa: false }) }))
    vi.doMock('@/lib/platform/sections-edge', () => ({ blockedSectionFor: async () => null, loadEdgeSections: async () => [] }))
    const { middleware } = await import('@/middleware')
    const res = await middleware(new NextRequest('http://localhost/dashboard'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-user-role')).toBe('client')
    expect(from).not.toHaveBeenCalledWith('profiles')
    vi.doUnmock('@/lib/supabase/middleware')
    vi.doUnmock('@/lib/settings/edge')
    vi.doUnmock('@/lib/platform/sections-edge')
  })
})
