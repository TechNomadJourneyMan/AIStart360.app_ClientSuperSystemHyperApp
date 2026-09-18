import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/impersonation/edge', () => ({
  isImpersonationActiveEdge: vi.fn(async (sid: string) => sid === 'active'),
  endImpersonationEdge: vi.fn(async () => {}),
  auditImpersonatedRequestEdge: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/middleware', () => ({ updateSession: vi.fn() }))

beforeAll(() => { process.env.GIGA_COOKIE_SECRET = 'test-secret-for-signed-tokens-0123456789' })

const { middleware } = await import('@/middleware')
const { signImpersonation, IMP_COOKIE_NAME } = await import('@/lib/impersonation/token')
const edge = await import('@/lib/impersonation/edge')

async function apiReq(path: string, method: string, mode: 'view' | 'edit', sid = 'active') {
  const token = await signImpersonation({ sid, uid: 'u1', mode, aid: 'admin-1', alabel: 'a@x', tlabel: 't@x' })
  return new NextRequest(`http://localhost${path}`, { method, headers: { cookie: `${IMP_COOKIE_NAME}=${token}` } })
}

describe('middleware: API inside an impersonation session', () => {
  it('view mode blocks mutations', async () => {
    const res = await middleware(await apiReq('/api/v1/onboarding/survey', 'POST', 'view'))
    expect(res.status).toBe(403)
  })

  it('view mode still allows reads, exit and analytics', async () => {
    expect((await middleware(await apiReq('/api/v1/onboarding/survey', 'GET', 'view'))).status).toBe(200)
    expect((await middleware(await apiReq('/api/v1/impersonation/exit', 'POST', 'view'))).status).toBe(200)
    expect((await middleware(await apiReq('/api/v1/events', 'POST', 'view'))).status).toBe(200)
  })

  it('read-only POST helpers work in view mode and are not audited as changes', async () => {
    vi.mocked(edge.auditImpersonatedRequestEdge).mockClear()
    expect((await middleware(await apiReq('/api/v1/assistant/validate', 'POST', 'view'))).status).toBe(200)
    expect((await middleware(await apiReq('/api/v1/assistant/validate', 'POST', 'edit'))).status).toBe(200)
    expect(edge.auditImpersonatedRequestEdge).not.toHaveBeenCalled()
  })

  it('edit mode allows mutations and audits them', async () => {
    const res = await middleware(await apiReq('/api/v1/onboarding/survey', 'POST', 'edit'))
    expect(res.status).toBe(200)
    expect(edge.auditImpersonatedRequestEdge).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: '/api/v1/onboarding/survey', targetUserId: 'u1' }))
  })

  it('a closed session cannot mutate', async () => {
    const res = await middleware(await apiReq('/api/v1/onboarding/survey', 'POST', 'edit', 'closed'))
    expect(res.status).toBe(401)
  })

  it('staff API is not affected by the user-session cookie', async () => {
    const res = await middleware(await apiReq('/api/giga-admin/users/x/block', 'POST', 'view'))
    expect(res.status).toBe(200)
  })
})
