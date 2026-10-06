import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ROLES = new Set(['admin', 'expert', 'owner', 'client', 'super_admin'])
// Optional staff_roles row of the signed-in user (cookie `test_staff_role`).

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (request: NextRequest) => {
    const roleCookie = request.cookies.get('aistart360_role')?.value
    const hasValidRole = Boolean(roleCookie && ALLOWED_ROLES.has(roleCookie))
    const role = roleCookie ?? null
    const staffRole = request.cookies.get('test_staff_role')?.value ?? null

    return {
      response: NextResponse.next({ request }),
      user: hasValidRole ? { id: `user-${role}` } : null,
      supabase: {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: !hasValidRole ? null
                  : table === 'staff_roles' ? (staffRole ? { role: staffRole } : null)
                  : { role, status: 'approved' },
              }),
            }),
          }),
        }),
      },
    }
  },
}))

import { middleware } from '../../middleware'

function createRequest(pathname: string, roleCookie?: string, staffRole?: string): NextRequest {
  const url = new URL(pathname, 'http://localhost:3000')
  const req = new NextRequest(url)
  if (roleCookie) {
    req.cookies.set('aistart360_role', roleCookie)
  }
  if (staffRole) req.cookies.set('test_staff_role', staffRole)
  return req
}

const location = (res: Response) => new URL(res.headers.get('location')!).pathname

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

  it('the removed /users and /admin screens send staff to the GIGA panel, others to their home', async () => {
    for (const path of ['/users', '/admin', '/admin/requests']) {
      expect(location(await middleware(createRequest(path, 'client')))).toBe('/dashboard')
      expect(location(await middleware(createRequest(path, 'admin')))).toBe('/admin-giga-panel')
      expect(location(await middleware(createRequest(path, 'expert')))).toBe('/expert/dashboard')
    }
  })

  it('the legacy owner role is a client: no owner cabinet, no staff pages', async () => {
    expect(location(await middleware(createRequest('/owner/dashboard', 'owner')))).toBe('/dashboard')
    expect(location(await middleware(createRequest('/clients', 'owner')))).toBe('/dashboard')
    expect(location(await middleware(createRequest('/login', 'owner')))).toBe('/dashboard')
    expect((await middleware(createRequest('/point-a', 'owner'))).status).toBe(200)
    expect((await middleware(createRequest('/owner/dashboard', 'owner'))).headers.get('location')).not.toContain('/owner/')
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

  it('allows unauthenticated Vercel Workflow step callbacks', async () => {
    const req = createRequest('/.well-known/workflow/v1/step/run-1')
    const res = await middleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  // Authenticated user on public page → redirect to their dashboard
  it('redirects authenticated admin from /login to /dashboard', async () => {
    const req = createRequest('/login', 'admin')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard')
  })

  it('a staff member whose profile is a client lands in their panel, not the client cabinet', async () => {
    expect(location(await middleware(createRequest('/login', 'client', 'super_admin')))).toBe('/admin-giga-panel')
    expect(location(await middleware(createRequest('/login', 'client', 'support')))).toBe('/admin-giga-panel')
    expect(location(await middleware(createRequest('/login', 'client', 'super_expert')))).toBe('/super-expert')
    expect(location(await middleware(createRequest('/login', 'admin', 'admin')))).toBe('/admin-giga-panel')
  })

  it('redirects authenticated client from /login to /dashboard', async () => {
    const req = createRequest('/login', 'client')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard')
  })
})
