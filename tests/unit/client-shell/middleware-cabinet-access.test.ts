/**
 * W2 (п. 8): «Открыть кабинет клиента (проверка)» leads staff to /client/home —
 * middleware must let every staff role into their OWN cabinet (no redirect),
 * also while maintenance mode closes the cabinets of regular clients.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const s = vi.hoisted(() => ({
  settings: { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false },
  role: 'client',
  staffRow: null as null | { role: string },
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
          maybeSingle: async () => ({ data: table === 'profiles' ? { role: s.role, status: 'approved' } : s.staffRow }),
        }),
      }),
    })
    return { supabase: { from, auth: { signOut: async () => {} } }, response: NextResponse.next(), user: { id: 'u1', user_metadata: {} } }
  },
}))

const { middleware } = await import('@/middleware')
const get = (path: string) => middleware(new NextRequest(`http://localhost${path}`))

beforeEach(() => {
  s.settings = { maintenance: { enabled: false, message: '', until: '' }, staff_require_mfa: false }
  s.role = 'client'
  s.staffRow = null
})

const STAFF: Array<[string, string | null]> = [
  ['super_admin', null],
  ['admin', 'admin'],
  ['expert', null],
  ['client', 'super_expert'],
  ['client', 'crm_manager'],
  ['client', 'support'],
]
const PAGES = ['/client/home', '/client/point-a', '/client/point-b', '/client/messages', '/client/onboarding/documents']

describe('staff open the client cabinet', () => {
  it.each(STAFF)('profiles.role=%s staff_roles=%s → no redirect', async (role, staff) => {
    s.role = role
    s.staffRow = staff ? { role: staff } : null
    for (const p of PAGES) expect((await get(p)).status, p).toBe(200)
  })

  it.each(STAFF)('…also in maintenance mode (profiles.role=%s staff_roles=%s)', async (role, staff) => {
    s.settings.maintenance.enabled = true
    s.role = role
    s.staffRow = staff ? { role: staff } : null
    expect((await get('/client/home')).status).toBe(200)
  })

  it('a regular client still goes to /maintenance while it is on', async () => {
    s.settings.maintenance.enabled = true
    expect((await get('/client/home')).headers.get('location') ?? '').toMatch(/\/maintenance$/)
  })
})
