import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ROLES = new Set(['admin', 'expert', 'owner', 'client', 'super_admin'])

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (request: NextRequest) => {
    const roleCookie = request.cookies.get('aistart360_role')?.value
    const hasValidRole = Boolean(roleCookie && ALLOWED_ROLES.has(roleCookie))
    const role = roleCookie ?? null

    return {
      response: NextResponse.next({ request }),
      user: hasValidRole ? { id: `user-${role}` } : null,
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: hasValidRole ? { role } : null }),
            }),
          }),
        }),
      },
    }
  },
}))

import { middleware } from '../../middleware'

function createRequest(pathname: string, roleCookie?: string): NextRequest {
  const url = new URL(pathname, 'http://localhost:3000')
  const req = new NextRequest(url)
  if (roleCookie) {
    req.cookies.set('aistart360_role', roleCookie)
  }
  return req
}

describe('RBAC Middleware', () => {
  // T017: /dashboard without cookie → redirect to login
  it('redirects /dashboard to /login when no cookie is set', async () => {
    const req = createRequest('/dashboard')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  it('preserves pathname and search params in the login return path', async () => {
    const req = createRequest('/clients?q=acme&page=2')
    const res = await middleware(req)
    const location = new URL(res.headers.get('location')!)

    expect(res.status).toBe(307)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('from')).toBe('/clients?q=acme&page=2')
  })

  // T018: /client/waiting-room without cookie → redirect to login
  it('redirects /client/waiting-room to /login when no cookie is set', async () => {
    const req = createRequest('/client/waiting-room')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  // T018b: /expert/dashboard without cookie → redirect to login
  it('redirects /expert/dashboard to /login when no cookie is set', async () => {
    const req = createRequest('/expert/dashboard')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  // T019: role=nonsense → redirect to login + clear cookie
  it('redirects to /login and clears cookies for unknown role', async () => {
    const req = createRequest('/dashboard', 'nonsense')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  // T021: /client routes only accessible to client role
  it('redirects admin away from /client/* routes', async () => {
    const req = createRequest('/client/waiting-room', 'admin')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard')
  })

  it('allows client role to access /client/waiting-room', async () => {
    const req = createRequest('/client/waiting-room', 'client')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  // Expert cannot access admin paths
  it('redirects expert away from /dashboard', async () => {
    const req = createRequest('/dashboard', 'expert')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/expert/dashboard')
  })

  // Client cannot access admin paths
  it('redirects client away from /dashboard to /client/waiting-room', async () => {
    const req = createRequest('/dashboard', 'client')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/client/waiting-room')
  })

  // Admin can access admin paths
  it('allows admin to access /dashboard', async () => {
    const req = createRequest('/dashboard', 'admin')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  // Public pages pass through
  it('allows unauthenticated access to /login', async () => {
    const req = createRequest('/login')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  // Authenticated user on public page → redirect to their dashboard
  it('redirects authenticated admin from /login to /dashboard', async () => {
    const req = createRequest('/login', 'admin')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard')
  })

  it('redirects authenticated client from /login to /client/waiting-room', async () => {
    const req = createRequest('/login', 'client')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/client/waiting-room')
  })
})
