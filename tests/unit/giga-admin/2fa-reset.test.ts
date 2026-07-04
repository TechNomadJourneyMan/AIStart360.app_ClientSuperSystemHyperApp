import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ role: 'super_admin' as string | null }))
const resetMock = vi.hoisted(() => ({ fn: vi.fn() as any }))

vi.mock('@/lib/giga-cookie', () => ({
  GIGA_COOKIE_NAME: 'aistart360_giga',
  verifyGigaRole: () => state.role,
}))

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
    headers: { cookie: 'aistart360_giga=x' },
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
