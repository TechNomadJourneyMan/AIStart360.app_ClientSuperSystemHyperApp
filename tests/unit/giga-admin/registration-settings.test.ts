import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ role: 'super_admin' as string | null }))
const setMock = vi.hoisted(() => ({ fn: vi.fn() as any }))

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

vi.mock('@/lib/settings/system-settings', () => ({
  getRegistrationMode: () => Promise.resolve('approval'),
  setRegistrationMode: (...a: any[]) => setMock.fn(...a),
  isRegistrationMode: (v: unknown) => ['open', 'approval', 'invite'].includes(v as string),
}))

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

import { NextRequest } from 'next/server'
import { GET, PUT } from '@/app/api/giga-admin/settings/registration/route'

function makeReq(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/giga-admin/settings/registration', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

describe('/api/giga-admin/settings/registration', () => {
  beforeEach(() => {
    state.role = 'super_admin'
    setMock.fn.mockReset()
    setMock.fn.mockResolvedValue(undefined)
  })

  it('GET returns the current mode for super_admin', async () => {
    const res = await GET(makeReq('GET'))
    expect(res.status).toBe(200)
    expect((await res.json()).mode).toBe('approval')
  })

  it('GET is forbidden without the super_admin cookie', async () => {
    state.role = null
    const res = await GET(makeReq('GET'))
    expect(res.status).toBe(403)
  })

  it('PUT sets a valid mode', async () => {
    const res = await PUT(makeReq('PUT', { mode: 'open' }))
    expect(res.status).toBe(200)
    expect(setMock.fn).toHaveBeenCalledWith('open', '00000000-0000-4000-8000-0000000000aa')
  })

  it('PUT rejects an invalid mode and does not write', async () => {
    const res = await PUT(makeReq('PUT', { mode: 'sideways' }))
    expect(res.status).toBe(400)
    expect(setMock.fn).not.toHaveBeenCalled()
  })

  it('PUT is forbidden without the super_admin cookie', async () => {
    state.role = null
    const res = await PUT(makeReq('PUT', { mode: 'open' }))
    expect(res.status).toBe(403)
    expect(setMock.fn).not.toHaveBeenCalled()
  })
})
