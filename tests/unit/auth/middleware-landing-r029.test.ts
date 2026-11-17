/**
 * R-029 «одна дорога в кабинет»: every entry of a signed-in user — the main
 * page, /login (where the e-mail link, the invitation and the finished
 * password reset arrive), the other auth pages, removed legacy screens and
 * staff pages a client cannot open — ends in the cabinet of the role:
 * an approved client in /client/home, a pending one in the waiting room,
 * staff / experts in their panel. And no entry loops (R-002: a legacy
 * profiles.role 'super_admin' without a staff_roles row used to bounce
 * between /giga-login and /admin-giga-panel forever).
 *
 * The chain is followed hop by hop through the real middleware.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// The factor on record (lib/mfa/factor-edge.ts): these accounts have none.
vi.mock('@/lib/mfa/factor-edge', () => ({ secondFactorOnRecordEdge: async () => false }))

const s = vi.hoisted(() => ({
  role: 'client',
  status: 'approved' as string | null,
  staffRow: null as null | { role: string },
}))

const withAbort = <T extends object>(o: T): T => Object.assign(o, { abortSignal: () => o })
// R4 B3 (W3A-1): the invite-only rule for pending clients reads the mode and invitations at the edge;
// the pending accounts here are registrations of the «approval» era — the rule lets them through.
vi.mock('@/lib/auth/invite-only-edge', () => ({ pendingSignupVerdictEdge: async () => 'allow', markSignupBlockedEdge: async () => {} }))
vi.mock('@/lib/settings/edge', () => ({
  edgeSettings: async () => ({ maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false }),
}))
vi.mock('@/lib/mfa/step-up-edge', () => ({ MFA_COOKIE_NAME: 'mfa', verifyStepUpEdge: async () => false }))
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
          maybeSingle: async () => ({ data: table === 'profiles' ? { role: s.role, status: s.status } : s.staffRow, error: null }),
        }),
      }),
    })
    return { supabase: { from, auth: { signOut: async () => ({ error: null }) } }, response: NextResponse.next(), user: { id: 'u-1', user_metadata: {}, app_metadata: {} } }
  },
}))

const { middleware } = await import('@/middleware')
const { homeRedirectFor } = await import('@/components/auth-home/home-routing')
const { CABINET_ENTRY_PATH } = await import('@/lib/role-landing')
const { CLIENT_DOCUMENTS_HREF } = await import('@/lib/documents/client-upload')

/** Follows the redirects of a signed-in browser; throws on a loop. */
async function follow(start: string, max = 8): Promise<{ path: string; status: number; hops: string[] }> {
  let path = start
  const hops = [start]
  for (let i = 0; i < max; i++) {
    if (path === '/') {
      // Middleware passes `/`; the page sends a session to /login (home-routing.ts).
      path = homeRedirectFor([{ name: 'sb-ref-auth-token' }]) ?? '/'
      hops.push(path)
      continue
    }
    const res = await middleware(new NextRequest(`http://localhost${path}`))
    const l = res.headers.get('location')
    if (!l) return { path, status: res.status, hops }
    const u = new URL(l)
    path = u.pathname + u.search
    hops.push(path)
  }
  throw new Error(`redirect loop: ${hops.join(' → ')}`)
}

type Account = { name: string; role: string; status: string; staff: string | null; landing: string }

const ACCOUNTS: Account[] = [
  { name: 'client, approved', role: 'client', status: 'approved', staff: null, landing: '/client/home' },
  { name: 'client, pending', role: 'client', status: 'pending_approval', staff: null, landing: '/client/waiting-room' },
  { name: 'client, clarification asked', role: 'client', status: 'requires_clarification', staff: null, landing: '/client/waiting-room' },
  { name: 'client, rejected', role: 'client', status: 'rejected', staff: null, landing: '/client/waiting-room' },
  { name: 'legacy owner', role: 'owner', status: 'approved', staff: null, landing: '/client/home' },
  { name: 'expert', role: 'expert', status: 'approved', staff: null, landing: '/expert/dashboard' },
  { name: 'admin profile without a staff row', role: 'admin', status: 'approved', staff: null, landing: '/dashboard' },
  { name: 'admin with a staff row', role: 'admin', status: 'approved', staff: 'admin', landing: '/admin-giga-panel' },
  { name: 'super_admin with a staff row', role: 'super_admin', status: 'approved', staff: 'super_admin', landing: '/admin-giga-panel' },
  { name: 'staff whose profile says client', role: 'client', status: 'approved', staff: 'support', landing: '/admin-giga-panel' },
  { name: 'SuperExpert (profile client)', role: 'client', status: 'approved', staff: 'super_expert', landing: '/super-expert' },
  { name: 'legacy super_admin WITHOUT staff_roles', role: 'super_admin', status: 'approved', staff: null, landing: '/client/home' },
  { name: 'legacy super_admin without staff_roles, pending', role: 'super_admin', status: 'pending_approval', staff: null, landing: '/client/waiting-room' },
]

const as = (a: Account) => {
  s.role = a.role
  s.status = a.status
  s.staffRow = a.staff ? { role: a.staff } : null
}

beforeEach(() => {
  s.role = 'client'
  s.status = 'approved'
  s.staffRow = null
})

describe('R-029: a signed-in user on an entry page lands in the cabinet of the role', () => {
  // `/login` = CABINET_ENTRY_PATH: the e-mail link, the invitation to an existing
  // account, the finished password reset, 404 / error pages arrive there.
  const ENTRIES = ['/', CABINET_ENTRY_PATH, '/register', '/forgot-password', '/admin', '/users/x', '/owner/dashboard']

  it.each(ACCOUNTS)('$name → $landing', async (a) => {
    as(a)
    for (const entry of ENTRIES) {
      const end = await follow(entry)
      expect(end.path, `${entry}: ${end.hops.join(' → ')}`).toBe(a.landing)
      expect(end.status, entry).toBe(200)
    }
  })

  it('the client is never sent to the old /dashboard shell by an entry', async () => {
    for (const a of ACCOUNTS.filter((x) => x.role === 'client' && !x.staff)) {
      as(a)
      for (const entry of ENTRIES) expect((await follow(entry)).hops, `${a.name} ${entry}`).not.toContain('/dashboard')
    }
  })
})

describe('R-029 / R-002: no entry loops, for any role and status', () => {
  const PAGES = ['/giga-login', '/admin-giga-panel', '/admin-giga-panel/users', '/super-expert', '/reports', '/clients', '/expert/dashboard', '/dashboard', '/client/home', '/client/waiting-room']

  it.each(ACCOUNTS)('$name', async (a) => {
    as(a)
    for (const p of PAGES) {
      const end = await follow(p) // throws on a loop
      expect(end.status, `${p}: ${end.hops.join(' → ')}`).toBe(200)
    }
  })

  it('R-002: the legacy super_admin without staff_roles stays on /giga-login (it used to loop with the panel)', async () => {
    as(ACCOUNTS.find((a) => a.name === 'legacy super_admin WITHOUT staff_roles')!)
    expect((await follow('/admin-giga-panel')).hops).toEqual(['/admin-giga-panel', '/giga-login'])
  })

  it('a client on a staff page goes to the cabinet, staff whose profile says client — to their panel', async () => {
    as(ACCOUNTS[0])
    expect((await follow('/reports')).path).toBe('/client/home')
    as(ACCOUNTS[1])
    expect((await follow('/expert/dashboard')).path).toBe('/client/waiting-room')
    as(ACCOUNTS.find((a) => a.staff === 'super_expert')!)
    expect((await follow('/reports')).path).toBe('/super-expert')
  })
})

describe('N4B-5 / N4B-6: the waiting room and «Мои документы» are not dead ends', () => {
  it('every cabinet link of the waiting room opens for a pending client (no bounce to «Главная»)', async () => {
    const src = readFileSync('app/client/waiting-room/page.tsx', 'utf8')
    const hrefs = Array.from(src.matchAll(/href="(\/client[^"]*)"/g), (m) => m[1])
    expect(hrefs).toContain('/client/onboarding/answers')
    expect(hrefs).not.toContain('/client/my-data')
    s.status = 'pending_approval'
    for (const href of hrefs) {
      const res = await middleware(new NextRequest(`http://localhost${href}`))
      expect(res.headers.get('location'), href).toBeNull()
    }
  })

  it('the documents page opens for a pending client too (documents are free)', async () => {
    s.status = 'pending_approval'
    expect(CLIENT_DOCUMENTS_HREF).toBe('/client/onboarding/documents')
    expect((await middleware(new NextRequest(`http://localhost${CLIENT_DOCUMENTS_HREF}`))).headers.get('location')).toBeNull()
  })
})
