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

// Panel access comes from a personal staff session (the shared-password
// break-glass cookie was removed); the REAL RBAC matrix decides permissions.
// state.role === 'super_admin' ⇒ a super_admin session actor, anything else ⇒ none.
vi.mock('@/lib/admin/giga-actor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/giga-actor')>()
  const { makeRequireGiga } = await import('../_giga-guard')
  const current = () => (state.role === 'super_admin' ? { id: '00000000-0000-4000-8000-0000000000aa', kind: 'session' as const, role: 'super_admin' as const } : null)
  return {
    ...actual,
    requireGiga: makeRequireGiga(current),
    getGigaActor: async () => { const a = current(); return a ? { ...a, permissions: [] } : null },
    isGigaSuperAdmin: async () => current() !== null,
  }
})

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
const USER = '00000000-0000-4000-8000-000000000123'
const GHOST = '00000000-0000-4000-8000-0000000000ff'

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
          // R-007: the target is read first (a pending applicant, unless it is the ghost).
          select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: () => Promise.resolve({ data: id === GHOST ? null : { role: 'client', status: 'pending_approval' }, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => Promise.resolve(profileUpdate) }) }),
        }
      }
      if (table === 'staff_roles') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
      }
      throw new Error('unexpected table: ' + table)
    },
  }
}

function makeReq(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/giga-admin/requests/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/giga-admin/requests/[id] — approve reliability', () => {
  beforeEach(() => {
    state.role = 'super_admin'
    state.stub = null
  })

  it('returns 200 { ok:true } when the profile row is actually updated', async () => {
    state.stub = makeSbStub({ profileUpdate: { data: [{ id: USER }], error: null } })
    const res = await PATCH(makeReq(USER, { action: 'approve' }), { params: { id: USER } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.status).toBe('approved')
  })

  it('returns 404 (NOT ok:true) when zero profile rows change — regression for the silent-success bug', async () => {
    // This is the exact production failure: RLS/anon client updated 0 rows but
    // the old route still returned { ok: true }. The fix must surface a failure.
    state.stub = makeSbStub({ profileUpdate: { data: [], error: null } })
    const res = await PATCH(makeReq(USER, { action: 'approve' }), { params: { id: USER } })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.ok).toBeUndefined()
    expect(json.error).toBeTruthy()
  })

  it('returns 404 when the profile does not exist at all', async () => {
    state.stub = makeSbStub({ profileUpdate: { data: [{ id: GHOST }], error: null } })
    const res = await PATCH(makeReq(GHOST, { action: 'approve' }), { params: { id: GHOST } })
    expect(res.status).toBe(404)
  })

  it('returns 500 when the profile update itself errors', async () => {
    state.stub = makeSbStub({ profileUpdate: { data: null, error: { message: 'permission denied' } } })
    const res = await PATCH(makeReq(USER, { action: 'approve' }), { params: { id: USER } })
    expect(res.status).toBe(500)
  })

  it('returns 403 without a valid super_admin cookie', async () => {
    state.role = null
    state.stub = makeSbStub({ profileUpdate: { data: [{ id: USER }], error: null } })
    const res = await PATCH(makeReq(USER, { action: 'approve' }), { params: { id: USER } })
    expect(res.status).toBe(403)
  })

  it('rejects an unknown action with 400', async () => {
    state.stub = makeSbStub({ profileUpdate: { data: [{ id: USER }], error: null } })
    const res = await PATCH(makeReq(USER, { action: 'nuke' }), { params: { id: USER } })
    expect(res.status).toBe(400)
  })
})
