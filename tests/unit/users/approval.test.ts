import { describe, it, expect, vi, beforeEach } from 'vitest'

// Records what the helper writes / filters on, and lets each test configure the
// simulated update result.
const calls = vi.hoisted(() => ({ update: null as any, eqCol: '', eqVal: '' }))
const config = vi.hoisted(() => ({ updated: [] as any[], error: null as any }))
const emailMock = vi.hoisted(() => ({ fn: vi.fn() }))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({
      update: (patch: any) => {
        calls.update = patch
        return {
          eq: (col: string, val: string) => {
            calls.eqCol = col
            calls.eqVal = val
            return { select: () => Promise.resolve({ data: config.updated, error: config.error }) }
          },
        }
      },
    }),
  }),
}))

vi.mock('@/lib/email', () => ({
  sendUserEmail: (...args: any[]) => {
    emailMock.fn(...args)
    return Promise.resolve({ ok: true })
  },
}))

import { applyApprovalDecision } from '@/lib/users/approval'

describe('applyApprovalDecision — single source of truth for profiles.status', () => {
  beforeEach(() => {
    calls.update = null
    calls.eqCol = ''
    calls.eqVal = ''
    config.updated = []
    config.error = null
    emailMock.fn.mockReset()
  })

  it('approve by userId: writes status + approved_at + approved_by, verifies row, emails', async () => {
    config.updated = [{ id: 'u1', email: 'a@b.io', full_name: 'A' }]
    const r = await applyApprovalDecision({ userId: 'u1', status: 'approved', approvedBy: 'admin-uuid' })
    expect(r.affected).toBe(1)
    expect(calls.eqCol).toBe('id')
    expect(calls.eqVal).toBe('u1')
    expect(calls.update.status).toBe('approved')
    expect(calls.update.approved_at).toBeTruthy()
    expect(calls.update.approved_by).toBe('admin-uuid')
    expect(emailMock.fn).toHaveBeenCalledTimes(1)
    expect(r.emailSent).toBe(true)
  })

  it('affected=0 and NO email when no profile matches (never silent success)', async () => {
    config.updated = []
    const r = await applyApprovalDecision({ userId: 'ghost', status: 'approved' })
    expect(r.affected).toBe(0)
    expect(emailMock.fn).not.toHaveBeenCalled()
  })

  it('reject by email: resolves via email column and forwards the reason', async () => {
    config.updated = [{ id: 'u2', email: 'x@y.io', full_name: null }]
    const r = await applyApprovalDecision({ email: 'x@y.io', status: 'rejected', reason: 'неполные данные' })
    expect(calls.eqCol).toBe('email')
    expect(calls.eqVal).toBe('x@y.io')
    expect(calls.update.status).toBe('rejected')
    expect(calls.update.approved_at).toBeUndefined()
    expect(r.emailSent).toBe(true)
    expect(emailMock.fn.mock.calls[0][0].body).toContain('неполные данные')
  })

  it('pending_approval sets status but sends no email', async () => {
    config.updated = [{ id: 'u3', email: 'p@q.io', full_name: null }]
    const r = await applyApprovalDecision({ userId: 'u3', status: 'pending_approval' })
    expect(calls.update.status).toBe('pending_approval')
    expect(emailMock.fn).not.toHaveBeenCalled()
    expect(r.emailSent).toBe(false)
  })

  it('throws when neither userId nor email is provided', async () => {
    await expect(applyApprovalDecision({ status: 'approved' } as any)).rejects.toThrow()
  })
})
