import { describe, it, expect, vi, beforeEach } from 'vitest'

const cfg = vi.hoisted(() => ({ mode: 'approval' as string, autoApprove: true }))
const createUserMock = vi.hoisted(() => ({ fn: vi.fn() as any }))
const approveMock = vi.hoisted(() => ({ fn: vi.fn() as any }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { admin: { createUser: (...a: any[]) => createUserMock.fn(...a) } } }),
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimited: () => Promise.resolve(false) }))
vi.mock('@/lib/settings/system-settings', () => ({
  getRegistrationMode: () => Promise.resolve(cfg.mode),
  getAutoApproveClients: () => Promise.resolve(cfg.autoApprove),
}))
vi.mock('@/lib/users/approval', () => ({ applyApprovalDecision: (...a: any[]) => approveMock.fn(...a) }))

import { POST } from '@/app/api/auth/register/route'

function makeReq() {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'new@user.io', password: 'secret123', name: 'New User', role: 'client' }),
  })
}

describe('/api/auth/register — registration mode enforcement', () => {
  beforeEach(() => {
    cfg.mode = 'approval'
    cfg.autoApprove = true
    createUserMock.fn.mockReset()
    createUserMock.fn.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null })
    approveMock.fn.mockReset()
    approveMock.fn.mockResolvedValue({ affected: 1, profile: null, emailSent: false })
  })

  it('invite mode blocks registration (no user created)', async () => {
    cfg.mode = 'invite'
    const res = await POST(makeReq())
    expect(res.status).toBe(403)
    expect(createUserMock.fn).not.toHaveBeenCalled()
    expect(approveMock.fn).not.toHaveBeenCalled()
  })

  it('approval mode + auto_approve_clients OFF → pending user, no auto-approve', async () => {
    cfg.mode = 'approval'
    cfg.autoApprove = false
    const res = await POST(makeReq())
    expect(res.status).toBe(201)
    expect(createUserMock.fn).toHaveBeenCalledTimes(1)
    expect(approveMock.fn).not.toHaveBeenCalled()
    expect((await res.json()).status).toBe('pending_approval')
  })

  it('approval mode + auto_approve_clients ON (default, Фаза 6B/№15) → self-serve auto-approved', async () => {
    cfg.mode = 'approval'
    cfg.autoApprove = true
    const res = await POST(makeReq())
    expect(res.status).toBe(201)
    expect(approveMock.fn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'new-user', status: 'approved', sendEmail: false }),
    )
    expect((await res.json()).status).toBe('approved')
  })

  it('open mode creates the user and immediately approves the profile', async () => {
    cfg.mode = 'open'
    const res = await POST(makeReq())
    expect(res.status).toBe(201)
    expect(createUserMock.fn).toHaveBeenCalledTimes(1)
    expect(approveMock.fn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'new-user', status: 'approved', sendEmail: false }),
    )
    expect((await res.json()).status).toBe('approved')
  })
})
