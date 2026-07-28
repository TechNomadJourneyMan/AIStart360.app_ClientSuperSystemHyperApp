import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const supabase = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}))
const gigaCookie = vi.hoisted(() => ({
  verify: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: supabase.getUser },
    from: supabase.from,
  }),
}))

vi.mock('@/lib/giga-cookie', () => ({
  GIGA_COOKIE_NAME: 'aistart360_giga',
  verifyGigaRole: gigaCookie.verify,
}))

import { getGigaActor } from '@/lib/admin/giga-actor'

function request(cookie?: string) {
  return new NextRequest('http://localhost/api/giga-admin/test', {
    headers: cookie ? { cookie: `aistart360_giga=${cookie}` } : undefined,
  })
}

describe('getGigaActor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    supabase.from.mockReturnValue({ select: supabase.select })
    supabase.select.mockReturnValue({ eq: supabase.eq })
    supabase.eq.mockReturnValue({ maybeSingle: supabase.maybeSingle })
    gigaCookie.verify.mockReturnValue(null)
  })

  it('accepts an approved personal super_admin session', async () => {
    supabase.getUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@example.com' } },
    })
    supabase.maybeSingle.mockResolvedValue({
      data: { role: 'super_admin', status: 'approved' },
    })

    await expect(getGigaActor(request())).resolves.toEqual({
      id: 'admin-1',
      kind: 'session',
      email: 'admin@example.com',
    })
  })

  it.each(['pending_approval', 'rejected', 'blocked'])(
    'rejects a personal super_admin whose status is %s',
    async (status) => {
      supabase.getUser.mockResolvedValue({
        data: { user: { id: 'admin-1', email: 'admin@example.com' } },
      })
      supabase.maybeSingle.mockResolvedValue({
        data: { role: 'super_admin', status },
      })

      await expect(getGigaActor(request())).resolves.toBeNull()
    },
  )

  it('rejects an approved session without the super_admin role', async () => {
    supabase.getUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@example.com' } },
    })
    supabase.maybeSingle.mockResolvedValue({
      data: { role: 'admin', status: 'approved' },
    })

    await expect(getGigaActor(request())).resolves.toBeNull()
  })

  it('keeps the signed break-glass cookie as a recovery fallback', async () => {
    supabase.getUser.mockResolvedValue({ data: { user: null } })
    gigaCookie.verify.mockReturnValue('super_admin')

    await expect(getGigaActor(request('signed-token'))).resolves.toEqual({
      id: 'giga:super_admin',
      kind: 'break_glass',
    })
    expect(gigaCookie.verify).toHaveBeenCalledWith('signed-token')
  })
})
