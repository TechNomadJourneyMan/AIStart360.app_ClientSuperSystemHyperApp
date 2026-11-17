import { beforeEach, describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { EdgeSection } from '@/lib/platform/sections-edge'

// Platform settings (maintenance, staff 2FA) and the GIGA-CRM section list are
// PostgREST reads (lib/settings/edge.ts, lib/platform/sections-edge.ts). Without
// these mocks every request waited on retries to the dead test Supabase and saw
// only the fallbacks. Defaults below = «nothing switched on»; a test sets what it needs.
const edge = vi.hoisted(() => ({
  settings: null as unknown as { maintenance: { enabled: boolean; message: string; until: string }; staff_require_mfa: boolean },
  sections: [] as Array<{ key: string; paths: string[]; enabled: boolean; visibility: unknown }>,
}))
const DEFAULT_SETTINGS = () => ({ maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false })
vi.mock('@/lib/settings/edge', () => ({ edgeSettings: async () => edge.settings }))
vi.mock('@/lib/platform/sections-edge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform/sections-edge')>()
  const loadEdgeSections = async (): Promise<EdgeSection[]> => edge.sections
  return {
    ...actual,
    loadEdgeSections,
    // The real matching (paths, enabled, audience); the list comes from the mock above
    // also when middleware did not preload it (no session cookie in these requests).
    blockedSectionFor: (pathname: string, userId: string, preloaded?: Promise<EdgeSection[]> | null) =>
      actual.blockedSectionFor(pathname, userId, preloaded ?? loadEdgeSections()),
  }
})

const ALLOWED_ROLES = new Set(['admin', 'expert', 'owner', 'client', 'super_admin'])
// Optional staff_roles row of the signed-in user (cookie `test_staff_role`).

// postgrest builders accept .abortSignal() (middleware times its reads out)
const withAbort = <T extends object>(o: T): T => Object.assign(o, { abortSignal: () => o })
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
            eq: () => withAbort({
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
// The factor on record (lib/mfa/factor-edge.ts): these accounts have none.
vi.mock('@/lib/mfa/factor-edge', () => ({ secondFactorOnRecordEdge: async () => false }))

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
  beforeEach(() => {
    edge.settings = DEFAULT_SETTINGS()
    edge.sections = []
  })

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

  // Портал /expert закрыт: эксперт без роли персонала видит отказ на входе SuperExpert.
  it('keeps an expert inside the /expert portal', async () => {
    const res = await middleware(createRequest('/expert/dashboard', 'expert'))
    expect(res.status).toBe(200)
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
    // R-029: to the client's cabinet, not the old /dashboard shell
    expect(new URL(res.headers.get('location')!).pathname).toBe('/client/home')
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
    expect(new URL(res.headers.get('location')!).pathname).toBe('/client/home')
  })

  it('the removed /users and /admin screens send staff to the GIGA panel, others to their home', async () => {
    for (const path of ['/users', '/admin', '/admin/requests']) {
      // R-029: a client to the new cabinet (was the old /dashboard shell)
      expect(location(await middleware(createRequest(path, 'client')))).toBe('/client/home')
      expect(location(await middleware(createRequest(path, 'super_admin', 'super_admin')))).toBe('/admin-giga-panel')
      // R-002: a legacy super_admin profile without a staff_roles row is not staff — the panel would bounce it back
      expect(location(await middleware(createRequest(path, 'super_admin')))).toBe('/client/home')
      expect(location(await middleware(createRequest(path, 'admin', 'admin')))).toBe('/admin-giga-panel')
      // Legacy profiles.role 'admin' without a staff_roles row has no panel
      // access (099): no redirect into a gate that would bounce it back.
      expect(location(await middleware(createRequest(path, 'admin')))).toBe('/dashboard')
      expect(location(await middleware(createRequest(path, 'expert')))).toBe('/expert/dashboard')
    }
  })

  it('the legacy owner role is a client: no owner cabinet, no staff pages', async () => {
    // R-029: the client's landing — the new cabinet
    expect(location(await middleware(createRequest('/owner/dashboard', 'owner')))).toBe('/client/home')
    expect(location(await middleware(createRequest('/clients', 'owner')))).toBe('/client/home')
    expect(location(await middleware(createRequest('/login', 'owner')))).toBe('/client/home')
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

  // R-029: one landing for a client — the new cabinet, not the old /dashboard shell
  it('redirects authenticated client from /login to /client/home', async () => {
    const req = createRequest('/login', 'client')
    const res = await middleware(req)
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/client/home')
  })

  it('maintenance on: a client cabinet goes to /maintenance; staff (also with a client profile), experts and public pages do not', async () => {
    edge.settings.maintenance = { enabled: true, message: 'Техработы', until: '' }
    expect(location(await middleware(createRequest('/dashboard', 'client')))).toBe('/maintenance')
    expect(location(await middleware(createRequest('/client/waiting-room', 'client')))).toBe('/maintenance')
    expect((await middleware(createRequest('/client/waiting-room', 'client', 'support'))).status).toBe(200)
    expect((await middleware(createRequest('/expert/dashboard', 'expert'))).status).toBe(200)
    expect((await middleware(createRequest('/dashboard', 'admin'))).status).toBe(200)
    expect((await middleware(createRequest('/login'))).status).toBe(200)
    // switched off again → the cabinet opens
    edge.settings = DEFAULT_SETTINGS()
    expect((await middleware(createRequest('/dashboard', 'client'))).status).toBe(200)
  })

  it('staff 2FA required: staff without a factor are sent to enrol (the enrolment page stays open); clients are not', async () => {
    edge.settings.staff_require_mfa = true
    const res = await middleware(createRequest('/dashboard', 'admin', 'admin'))
    expect(res.status).toBe(307)
    const url = new URL(res.headers.get('location')!)
    expect(url.pathname).toBe('/settings')
    expect(url.searchParams.get('tab')).toBe('security')
    expect(url.searchParams.get('mfa')).toBe('required')
    expect(location(await middleware(createRequest('/expert/dashboard', 'expert')))).toBe('/settings')
    expect((await middleware(createRequest('/settings', 'admin', 'admin'))).headers.get('location')).toBeNull()
    expect((await middleware(createRequest('/dashboard', 'client'))).status).toBe(200)
  })

  it('a section switched off in GIGA-CRM closes its pages for a client (→ /client/home?unavailable=key), not for staff', async () => {
    edge.sections = [
      { key: 'pulse', paths: ['/pulse'], enabled: false, visibility: null },
      { key: 'point_a', paths: ['/point-a'], enabled: true, visibility: { audience: 'all' } },
    ]
    const res = await middleware(createRequest('/pulse', 'client'))
    expect(res.status).toBe(307)
    const url = new URL(res.headers.get('location')!)
    expect(url.pathname).toBe('/client/home')
    expect(url.searchParams.get('unavailable')).toBe('pulse')
    expect(location(await middleware(createRequest('/pulse/today', 'client')))).toBe('/client/home')
    expect((await middleware(createRequest('/point-a', 'client'))).status).toBe(200)
    expect((await middleware(createRequest('/pulse', 'admin'))).status).toBe(200)
  })
})
