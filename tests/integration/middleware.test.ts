import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ROLES = new Set(['admin', 'expert', 'owner', 'client', 'super_admin'])

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (request: NextRequest) => {
    const roleCookie = request.cookies.get('aistart360_role')?.value
    const hasValidRole = Boolean(roleCookie && ALLOWED_ROLES.has(roleCookie))
    const role = roleCookie ?? null
    // Approval status comes from a separate test cookie and defaults to
    // 'approved', so the RBAC cases below stay about roles only.
    const status = request.cookies.get('aistart360_status')?.value ?? 'approved'

    return {
      response: NextResponse.next({ request }),
      user: hasValidRole ? { id: `user-${role}` } : null,
      supabase: {
        auth: { signOut: async () => ({ error: null }) },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: hasValidRole ? { role, status } : null }),
            }),
          }),
        }),
      },
    }
  },
}))

import { middleware } from '../../middleware'

function createRequest(pathname: string, roleCookie?: string, status?: string): NextRequest {
  const url = new URL(pathname, 'http://localhost:3000')
  const req = new NextRequest(url)
  if (roleCookie) {
    req.cookies.set('aistart360_role', roleCookie)
  }
  if (status) {
    req.cookies.set('aistart360_status', status)
  }
  return req
}

const locationOf = (res: Response) => new URL(res.headers.get('location')!)

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

  // The owner portal is not an expert playground either — OWNER_PATHS used to
  // be missing from the expert branch, so /owner/* was wide open.
  it('redirects expert away from the owner portal', async () => {
    const req = createRequest('/owner/dashboard', 'expert')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/expert/dashboard')
  })

  it('redirects owner away from the expert portal', async () => {
    const req = createRequest('/expert/dashboard', 'owner')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/owner/dashboard')
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

  // FE-06: the landing destination now comes from the shared roleLandingPath —
  // an approved client belongs in the /client cabinet, not on /dashboard.
  it('redirects an approved client from /login to /client/point-a', async () => {
    const req = createRequest('/login', 'client', 'approved')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(locationOf(res).pathname).toBe('/client/point-a')
  })

  it('redirects a pending client from /login to the waiting room', async () => {
    const req = createRequest('/login', 'client', 'pending_approval')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(locationOf(res).pathname).toBe('/client/waiting-room')
  })

  it('redirects an owner from /login to the owner portal', async () => {
    const req = createRequest('/login', 'owner')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(locationOf(res).pathname).toBe('/owner/dashboard')
  })
})

describe('Approval gate', () => {
  // A pending client must not roam the portal — only the waiting room, the
  // questionnaire and their own data are open until an admin decides.
  it('redirects a pending client from the cabinet to the waiting room', async () => {
    const req = createRequest('/client/point-a', 'client', 'pending_approval')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(locationOf(res).pathname).toBe('/client/waiting-room')
  })

  it('redirects a pending client from the shared /dashboard to the waiting room', async () => {
    const req = createRequest('/dashboard', 'client', 'pending_approval')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(locationOf(res).pathname).toBe('/client/waiting-room')
  })

  it('redirects a client awaiting clarification to the waiting room', async () => {
    const req = createRequest('/client/dashboard', 'client', 'requires_clarification')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(locationOf(res).pathname).toBe('/client/waiting-room')
  })

  it('keeps the waiting room itself reachable for a pending client', async () => {
    const req = createRequest('/client/waiting-room', 'client', 'pending_approval')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  // The questionnaire is how a pending client gets approved — every variant of
  // it (and the documents step) must stay open, together with the vertical
  // picker that is the only UI route into the medical / e-commerce forms.
  it.each([
    '/client/welcome',
    '/client/onboarding',
    '/client/onboarding/documents',
    '/client/onboarding-medical',
    '/client/onboarding-ecommerce',
    '/client/my-data',
    '/2fa',
  ])('keeps %s open for a pending client', async (pathname) => {
    const req = createRequest(pathname, 'client', 'pending_approval')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it('lets an approved client into the cabinet', async () => {
    const req = createRequest('/client/point-a', 'client', 'approved')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  // A rejected client is signed out and pushed back to /login with a notice —
  // leaving the session alive would bounce them between /login and the cabinet.
  it('sends a rejected client to /login?rejected=1', async () => {
    const req = createRequest('/client/point-a', 'client', 'rejected')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    const location = locationOf(res)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('rejected')).toBe('1')
  })

  it('sends a rejected client away from the waiting room too', async () => {
    const req = createRequest('/client/waiting-room', 'client', 'rejected')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(locationOf(res).pathname).toBe('/login')
  })

  // R4: blocked/archived is a harder stop — sign out and back to /login.
  it('signs out a blocked user', async () => {
    const req = createRequest('/dashboard', 'client', 'blocked')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    const location = locationOf(res)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('blocked')).toBe('1')
  })

  // The gate is client-only: staff status is handled by roleLandingPath at
  // login time, not by blocking their portal routes.
  it('does not gate a pending owner out of the owner portal', async () => {
    const req = createRequest('/owner/dashboard', 'owner', 'pending_approval')
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })
})
