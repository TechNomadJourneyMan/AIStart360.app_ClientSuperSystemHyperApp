import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const s = vi.hoisted(() => ({ actor: null as null | { id: string; role: string }, allowed: false, expert: null as null | { id: string; role: string }, targetRole: 'client' }))

vi.mock('@/lib/admin/giga-actor', () => ({
  isSameOriginMutation: () => true,
  getGigaActor: async () => s.actor,
  requireGiga: async () => (s.actor && s.allowed ? { actor: s.actor } : { response: NextResponse.json({ ok: false }, { status: 403 }) }),
}))
vi.mock('@/lib/expert-auth', () => ({ requireExpert: async () => s.expert }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: s.targetRole } }) }) }) }),
  }),
}))

const { authorizeUserDataRead } = await import('@/lib/admin/user-data-access')
const req = () => new NextRequest('http://localhost/api/giga-admin/requests/x/documents')
const UID = '11111111-2222-3333-4444-555555555555'

beforeEach(() => { s.actor = null; s.allowed = false; s.expert = null; s.targetRole = 'client' })

describe('authorizeUserDataRead', () => {
  it('staff with the permission may read', async () => {
    s.actor = { id: 'a', role: 'support' }; s.allowed = true
    const r = await authorizeUserDataRead(req(), 'users.sensitive', async () => UID)
    expect('response' in r).toBe(false)
  })

  it('staff WITHOUT the permission is refused even if the expert path would allow it', async () => {
    s.actor = { id: 'a', role: 'analyst' }; s.expert = { id: 'a', role: 'admin' }
    const r = await authorizeUserDataRead(req(), 'users.sensitive', async () => UID)
    expect('response' in r && r.response.status).toBe(403)
  })

  it('a non-staff expert reads clients only', async () => {
    s.expert = { id: 'e', role: 'expert' }
    expect('response' in (await authorizeUserDataRead(req(), 'users.sensitive', async () => UID))).toBe(false)
    s.targetRole = 'owner'
    const r = await authorizeUserDataRead(req(), 'users.sensitive', async () => UID)
    expect('response' in r && r.response.status).toBe(403)
  })

  it('anyone else is refused', async () => {
    const r = await authorizeUserDataRead(req(), 'users.sensitive', async () => UID)
    expect('response' in r && r.response.status).toBe(403)
  })
})
