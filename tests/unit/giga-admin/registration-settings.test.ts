import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ role: 'super_admin' as string | null }))
const setMock = vi.hoisted(() => ({ fn: vi.fn() as any }))

vi.mock('@/lib/giga-cookie', () => ({
  GIGA_COOKIE_NAME: 'aistart360_giga',
  verifyGigaRole: () => state.role,
}))

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
    headers: { 'content-type': 'application/json', cookie: 'aistart360_giga=x' },
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
    expect(setMock.fn).toHaveBeenCalledWith('open')
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
