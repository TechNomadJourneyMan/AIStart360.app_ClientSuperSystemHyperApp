/**
 * Review routes (103): the expert cabinet POST /api/expert/reports/:id/review
 * admits only through resolveExpert (role, approval, the staff 2FA gate),
 * blocks cross-site posts, validates the body (comment for changes) and hands
 * the decision to decideReportReview as a web decision with the 2FA proven;
 * outcomes map to HTTP codes.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  auth: { ok: true, viewer: { id: 'e0e0e0e0-0000-4000-8000-000000000001', role: 'expert', email: 'e@x.kz' } } as Record<string, unknown>,
}))
vi.mock('@/lib/expert-auth', async () => {
  const { NextResponse } = await import('next/server')
  return {
    EXPERT_ROLES: new Set(['expert', 'admin', 'super_admin']),
    resolveExpert: async () => s.auth,
    expertBlockResponse: (block: string) => NextResponse.json({ ok: false, code: block === 'step_up' ? 'MFA_STEP_UP_REQUIRED' : block }, { status: block === 'unauthenticated' ? 401 : 403 }),
  }
})
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: vi.fn(async () => true) }))
const flow = vi.hoisted(() => ({ decideReportReview: vi.fn() }))
vi.mock('@/lib/reports/review-flow', async () => {
  const real = await vi.importActual<typeof import('@/lib/reports/review-flow')>('@/lib/reports/review-flow')
  return { ...real, decideReportReview: flow.decideReportReview }
})

const route = await import('@/app/api/expert/reports/[id]/review/route')
const ID = '7b0c4e2a-1d3f-4a5b-8c6d-9e0f1a2b3c4d'
const post = (body: unknown, headers: Record<string, string> = {}) => new NextRequest(`http://localhost/api/expert/reports/${ID}/review`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
})
const call = (body: unknown, headers?: Record<string, string>) => route.POST(post(body, headers), { params: { id: ID } })
const version = { id: ID, status: 'published', version: 3 }

describe('POST /api/expert/reports/:id/review', () => {
  beforeEach(() => {
    s.auth = { ok: true, viewer: { id: 'e0e0e0e0-0000-4000-8000-000000000001', role: 'expert', email: 'e@x.kz' } }
    flow.decideReportReview.mockReset()
  })

  it('refuses without the expert gate (incl. a missing second factor) before deciding anything', async () => {
    s.auth = { ok: false, block: 'step_up' }
    const res = await call({ decision: 'approve' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'MFA_STEP_UP_REQUIRED' })
    s.auth = { ok: false, block: 'unauthenticated' }
    expect((await call({ decision: 'approve' })).status).toBe(401)
    expect(flow.decideReportReview).not.toHaveBeenCalled()
  })

  it('blocks cross-site posts and bad bodies', async () => {
    expect((await call({ decision: 'approve' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await call({ decision: 'changes_requested' })).status).toBe(400)
    expect((await call({ decision: 'changes_requested', comment: 'no' })).status).toBe(400)
    expect((await call({ decision: 'publish' })).status).toBe(400)
    expect(flow.decideReportReview).not.toHaveBeenCalled()
  })

  it('decides as the signed-in expert, from the web, with the 2FA gate passed', async () => {
    flow.decideReportReview.mockResolvedValue({ ok: true, decision: 'approve', already: false, reviewId: 'r1', version, superseded: [], rerun: null })
    const res = await call({ decision: 'approve' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, decision: 'approve', status: 'published', version: 3 })
    expect(flow.decideReportReview.mock.calls[0][0]).toMatchObject({
      versionId: ID, reviewerId: 'e0e0e0e0-0000-4000-8000-000000000001', decision: 'approve', channel: 'web', mfaVerified: true, comment: null,
    })
  })

  it('maps outcomes: 409 already decided by someone else, 403 no right, 404, 503 audit', async () => {
    flow.decideReportReview.mockResolvedValueOnce({ ok: false, code: 'wrong_status', status: 'published', decided: 'approve' })
    const conflict = await call({ decision: 'changes_requested', comment: 'Поправьте выручку' })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ decided: 'approve' })
    flow.decideReportReview.mockResolvedValueOnce({ ok: false, code: 'forbidden' })
    expect((await call({ decision: 'approve' })).status).toBe(403)
    flow.decideReportReview.mockResolvedValueOnce({ ok: false, code: 'not_found' })
    expect((await call({ decision: 'approve' })).status).toBe(404)
    flow.decideReportReview.mockResolvedValueOnce({ ok: false, code: 'audit_unavailable' })
    expect((await call({ decision: 'approve' })).status).toBe(503)
  })
})
