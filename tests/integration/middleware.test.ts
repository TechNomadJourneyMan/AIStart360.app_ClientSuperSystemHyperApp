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

  // Admins may open /client/* cabinet pages (preview of the client UX) —
  // the 2026-07 middleware rework dropped the old admin→/dashboard redirect.
  it('allows admin to pass through to /client/* routes', async () => {
    const req = createRequest('/client/waiting-room', 'admin')
    const res = await middleware(req)
    expect(res.status).toBe(200)
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

  // Clients use the shared (dashboard) layout — /dashboard is allowed
  // (CLIENT_DASHBOARD_PATHS), the old waiting-room redirect is gone.
  it('allows client to access shared /dashboard', async () => {
    const req = createRequest('/dashboard', 'client')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  // Regression: '/clients' (admin-only) must NOT leak through the '/client'
  // cabinet prefix — startsWith matching allowed clients onto /clients.
  it('redirects client away from admin-only /clients', async () => {
    const req = createRequest('/clients', 'client')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard')
  })

  // GRI Pulse is client-facing (CLIENT_DASHBOARD_PATHS) — its API scopes data
  // per role, so a client may open it and sees only their own pulse.
  it('allows client to access GRI Pulse (/pulse)', async () => {
    const req = createRequest('/pulse', 'client')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it('redirects client away from legacy /ai-scanner', async () => {
    const req = createRequest('/ai-scanner', 'client')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard')
  })

  it('redirects client away from admin-only /users', async () => {
    const req = createRequest('/users', 'client')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard')
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

  it('redirects authenticated client from /login to /dashboard', async () => {
    const req = createRequest('/login', 'client')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard')
  })
})
