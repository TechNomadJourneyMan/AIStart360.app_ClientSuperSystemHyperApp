import { describe, it, expect, vi, beforeEach } from 'vitest'

const cfg = vi.hoisted(() => ({ mode: 'approval' as string, autoApprove: true }))
const createUserMock = vi.hoisted(() => ({ fn: vi.fn() as any }))
const profileUpdates = vi.hoisted(() => ({ calls: [] as unknown[] }))
const approveMock = vi.hoisted(() => ({ fn: vi.fn() as any }))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    auth: { admin: { createUser: (...a: any[]) => createUserMock.fn(...a) } },
    from: () => ({
      update: (patch: unknown) => {
        profileUpdates.calls.push(patch)
        return { eq: () => ({ select: async () => ({ data: [{ id: 'new-user' }], error: null }) }) }
      },
    }),
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimited: () => Promise.resolve(false) }))
vi.mock('@/lib/settings/system-settings', () => ({
  getRegistrationMode: () => Promise.resolve(cfg.mode),
  getAutoApproveClients: () => Promise.resolve(cfg.autoApprove),
}))
vi.mock('@/lib/users/approval', () => ({ applyApprovalDecision: (...a: any[]) => approveMock.fn(...a) }))

import { POST } from '@/app/api/auth/register/route'

function makeReq(extra: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'new@user.io', password: 'secret123', name: 'New User', role: 'client', ...extra }),
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
    profileUpdates.calls = []
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

  it('never sends role/status as user metadata and never touches profiles.role (F-001)', async () => {
    const res = await POST(makeReq())
    expect(res.status).toBe(201)
    const meta = createUserMock.fn.mock.calls[0][0].user_metadata
    expect(meta).not.toHaveProperty('role')
    expect(meta).not.toHaveProperty('status')
    expect(profileUpdates.calls).toEqual([])
  })

  it.each(['owner', 'super_admin', 'admin', 'expert', 'manager', 'analyst'])(
    'rejects self-registration with role=%s (no user created)',
    async (role) => {
      const res = await POST(makeReq({ role }))
      expect(res.status).toBe(400)
      expect(createUserMock.fn).not.toHaveBeenCalled()
      expect(approveMock.fn).not.toHaveBeenCalled()
    },
  )
})
