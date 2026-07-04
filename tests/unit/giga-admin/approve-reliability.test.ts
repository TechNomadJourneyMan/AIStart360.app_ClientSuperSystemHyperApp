import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared mutable mock state (hoisted so the vi.mock factories below can close
// over it — see vitest's mock-hoisting rules).
const state = vi.hoisted(() => ({
  stub: null as any,
  role: 'super_admin' as string | null,
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    if (!state.stub) throw new Error('no service stub configured')
    return state.stub
  },
}))

vi.mock('@/lib/giga-cookie', () => ({
  GIGA_COOKIE_NAME: 'aistart360_giga',
  verifyGigaRole: () => state.role,
}))

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/giga-admin/requests/[id]/route'

/**
 * Minimal Supabase query-builder stub matching the exact chains the route uses:
 *   admin_requests: .select().eq().maybeSingle()  and  .update().eq()
 *   profiles:       .update().eq().select()
 */
function makeSbStub({
  adminRow = null,
  profileUpdate,
}: {
  adminRow?: any
  profileUpdate: { data: any[] | null; error: any }
}) {
  return {
    from(table: string) {
      if (table === 'admin_requests') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: adminRow, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        }
      }
      if (table === 'profiles') {
        return {
          update: () => ({ eq: () => ({ select: () => Promise.resolve(profileUpdate) }) }),
        }
      }
      throw new Error('unexpected table: ' + table)
    },
  }
}

function makeReq(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/giga-admin/requests/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: 'aistart360_giga=x' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/giga-admin/requests/[id] — approve reliability', () => {
  beforeEach(() => {
    state.role = 'super_admin'
    state.stub = null
  })

  it('returns 200 { ok:true } when the profile row is actually updated', async () => {
    state.stub = makeSbStub({ profileUpdate: { data: [{ id: 'user-123' }], error: null } })
    const res = await PATCH(makeReq('user-123', { action: 'approve' }), { params: { id: 'user-123' } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.status).toBe('approved')
  })

  it('returns 404 (NOT ok:true) when zero profile rows change — regression for the silent-success bug', async () => {
    // This is the exact production failure: RLS/anon client updated 0 rows but
    // the old route still returned { ok: true }. The fix must surface a failure.
    state.stub = makeSbStub({ profileUpdate: { data: [], error: null } })
    const res = await PATCH(makeReq('ghost', { action: 'approve' }), { params: { id: 'ghost' } })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.ok).toBeUndefined()
    expect(json.error).toBeTruthy()
  })

  it('returns 500 when the profile update itself errors', async () => {
    state.stub = makeSbStub({ profileUpdate: { data: null, error: { message: 'permission denied' } } })
    const res = await PATCH(makeReq('user-123', { action: 'approve' }), { params: { id: 'user-123' } })
    expect(res.status).toBe(500)
  })

  it('returns 403 without a valid super_admin cookie', async () => {
    state.role = null
    state.stub = makeSbStub({ profileUpdate: { data: [{ id: 'user-123' }], error: null } })
    const res = await PATCH(makeReq('user-123', { action: 'approve' }), { params: { id: 'user-123' } })
    expect(res.status).toBe(403)
  })

  it('rejects an unknown action with 400', async () => {
    state.stub = makeSbStub({ profileUpdate: { data: [{ id: 'user-123' }], error: null } })
    const res = await PATCH(makeReq('user-123', { action: 'nuke' }), { params: { id: 'user-123' } })
    expect(res.status).toBe(400)
  })
})
