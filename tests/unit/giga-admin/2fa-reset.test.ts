import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ role: 'super_admin' as string | null }))
const resetMock = vi.hoisted(() => ({ fn: vi.fn() as any }))

// Panel access comes from a personal staff session (the shared-password
// break-glass cookie was removed); the REAL RBAC matrix decides permissions.
vi.mock('@/lib/admin/giga-actor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/giga-actor')>()
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    ...actual,
    requireGiga: makeRequireGiga(() => (state.role === 'super_admin' ? { id: '00000000-0000-4000-8000-0000000000aa', kind: 'session', role: 'super_admin' as const } : null)),
  }
})

vi.mock('@/lib/mfa/store', () => ({
  adminResetUserMfa: (...args: any[]) => resetMock.fn(...args),
}))

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { email: 'user@example.io', full_name: 'User' } }),
        }),
      }),
    }),
  }),
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/giga-admin/users/[id]/2fa-reset/route'

function makeReq() {
  return new NextRequest('http://localhost/api/giga-admin/users/u1/2fa-reset', {
    method: 'POST',
    headers: {},
  })
}

describe('POST /api/giga-admin/users/[id]/2fa-reset — emergency MFA recovery', () => {
  beforeEach(() => {
    state.role = 'super_admin'
    resetMock.fn.mockReset()
    resetMock.fn.mockResolvedValue(undefined)
  })

  it('clears the target user MFA and returns ok for super_admin', async () => {
    const res = await POST(makeReq(), { params: { id: 'u1' } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(resetMock.fn).toHaveBeenCalledWith('u1')
  })

  it('returns 403 and does NOT touch MFA without a super_admin cookie', async () => {
    state.role = null
    const res = await POST(makeReq(), { params: { id: 'u1' } })
    expect(res.status).toBe(403)
    expect(resetMock.fn).not.toHaveBeenCalled()
  })

  it('returns 500 when the reset itself fails (does not falsely report success)', async () => {
    resetMock.fn.mockRejectedValue(new Error('db down'))
    const res = await POST(makeReq(), { params: { id: 'u1' } })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.ok).toBeUndefined()
  })
})
