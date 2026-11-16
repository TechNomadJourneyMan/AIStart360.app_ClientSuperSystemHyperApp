/**
 * Review R4-W2-A, outside the B1 package but in middleware.ts:
 *  X-1 — with «2FA для персонала обязательна» an expert without a second
 *        factor was sent to /settings (the enrolment page) and bounced back to
 *        /expert/dashboard (ADMIN_PATHS) — an endless loop. Now it reaches the
 *        enrolment page; other staff pages stay closed to it.
 *  X-2 — the SuperExpert workspace admitted a legacy profiles.role
 *        'super_admin' without a staff_roles row; R-002: staff rights come
 *        from staff_roles only (as GIGA and the landing).
 * The redirect chain is followed through the real middleware.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/mfa/factor-edge', () => ({ secondFactorOnRecordEdge: async () => false }))

const s = vi.hoisted(() => ({
  role: 'expert',
  status: 'approved',
  staffRow: null as null | { role: string },
  settings: { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: true },
}))

const withAbort = <T extends object>(o: T): T => Object.assign(o, { abortSignal: () => o })
vi.mock('@/lib/settings/edge', () => ({ edgeSettings: async () => s.settings }))
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

async function follow(start: string, max = 8): Promise<{ path: string; status: number; hops: string[] }> {
  let path = start
  const hops = [start]
  for (let i = 0; i < max; i++) {
    const res = await middleware(new NextRequest(`http://localhost${path}`))
    const l = res.headers.get('location')
    if (!l) return { path, status: res.status, hops }
    const u = new URL(l)
    path = u.pathname + u.search
    hops.push(path)
  }
  throw new Error(`redirect loop: ${hops.join(' → ')}`)
}

beforeEach(() => {
  s.role = 'expert'
  s.status = 'approved'
  s.staffRow = null
  s.settings = { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: true }
})

describe('X-1: «2FA для персонала обязательна» + an expert without a second factor', () => {
  it.each([
    ['an expert profile', 'expert', null],
    ['a legacy manager profile', 'manager', null],
    ['staff whose profile says expert', 'expert', 'crm_manager'],
  ])('%s reaches the 2FA enrolment page — no loop', async (_name, role, staff) => {
    s.role = role
    s.staffRow = staff ? { role: staff } : null
    for (const start of ['/expert/dashboard', '/settings']) {
      const end = await follow(start)
      expect(end.path, end.hops.join(' → ')).toMatch(/^\/settings/)
      expect(end.status).toBe(200)
    }
    expect((await follow('/expert/dashboard')).path).toBe('/settings?tab=security&mfa=required')
  })

  it('other staff pages stay closed to an expert (only its own settings opened)', async () => {
    s.settings.staff_require_mfa = false
    for (const p of ['/clients', '/reports', '/dashboard', '/metrics', '/profile']) {
      const res = await middleware(new NextRequest(`http://localhost${p}`))
      expect(new URL(res.headers.get('location') ?? 'http://x/none').pathname, p).toBe('/expert/dashboard')
    }
    expect((await middleware(new NextRequest('http://localhost/settings'))).headers.get('location')).toBeNull()
  })

  it('with the requirement off an expert works in its portal as before', async () => {
    s.settings.staff_require_mfa = false
    expect((await follow('/expert/dashboard')).hops).toEqual(['/expert/dashboard'])
  })
})

describe('X-2 / R-002: the SuperExpert workspace by staff_roles only', () => {
  it('a legacy super_admin profile without a staff_roles row is refused', async () => {
    s.settings.staff_require_mfa = false
    s.role = 'super_admin'
    s.staffRow = null
    const res = await middleware(new NextRequest('http://localhost/super-expert'))
    expect(res.headers.get('location')).toContain('/super-expert/login?denied=1')
  })

  it('with the row (super_admin or super_expert) it opens', async () => {
    s.settings.staff_require_mfa = false
    s.role = 'super_admin'
    s.staffRow = { role: 'super_admin' }
    expect((await middleware(new NextRequest('http://localhost/super-expert'))).status).toBe(200)
    s.role = 'client'
    s.staffRow = { role: 'super_expert' }
    expect((await middleware(new NextRequest('http://localhost/super-expert/users'))).status).toBe(200)
  })
})
