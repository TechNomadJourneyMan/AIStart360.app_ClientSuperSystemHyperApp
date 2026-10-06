import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const s = vi.hoisted(() => ({
  actor: null as null | { id: string; role: string },
  allowed: false,
  /** requireGiga refused a caller who is staff (MFA-blocked / role unreadable). */
  staffRefused: false,
  mfaCode: null as null | string,
  expert: null as null | { id: string; role: string },
  expertBlock: 'forbidden' as string,
  targetRole: 'client',
}))

vi.mock('@/lib/admin/giga-actor', () => ({
  isSameOriginMutation: () => true,
  // An MFA-blocked staff session is NOT returned as an actor (resolveGigaActor
  // admits only sessions that passed the second-factor gate).
  getGigaActor: async () => s.actor,
  requireGiga: async () => {
    if (s.actor && s.allowed) return { actor: s.actor }
    const response = NextResponse.json({ ok: false, ...(s.mfaCode ? { code: s.mfaCode } : {}) }, { status: 403 })
    return { response, staff: !!s.actor || s.staffRefused }
  },
}))
vi.mock('@/lib/expert-auth', () => ({
  requireExpert: async () => s.expert,
  resolveExpert: async () => (s.expert ? { ok: true, viewer: s.expert } : { ok: false, block: s.expertBlock }),
  expertBlockResponse: (block: string) =>
    NextResponse.json({ ok: false, code: block === 'step_up' ? 'MFA_STEP_UP_REQUIRED' : block }, { status: block === 'unavailable' ? 503 : 403 }),
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: s.targetRole } }) }) }) }),
  }),
}))

const { authorizeUserDataRead } = await import('@/lib/admin/user-data-access')
const req = () => new NextRequest('http://localhost/api/giga-admin/requests/x/documents')
const UID = '11111111-2222-3333-4444-555555555555'

beforeEach(() => {
  s.actor = null; s.allowed = false; s.staffRefused = false; s.mfaCode = null
  s.expert = null; s.expertBlock = 'forbidden'; s.targetRole = 'client'
})

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

  it('an MFA-blocked staff session does NOT fall through to the expert path', async () => {
    // super_admin with TOTP enrolled, session cookies only (no step-up cookie):
    // requireGiga answers MFA_STEP_UP_REQUIRED, getGigaActor returns null, and
    // the expert path would admit the same session.
    s.staffRefused = true; s.mfaCode = 'MFA_STEP_UP_REQUIRED'; s.expert = { id: 'sa', role: 'super_admin' }
    const r = await authorizeUserDataRead(req(), 'users.sensitive', async () => UID)
    expect('response' in r && r.response.status).toBe(403)
    expect('response' in r && (await r.response.json()).code).toBe('MFA_STEP_UP_REQUIRED')
  })

  it('a non-staff expert reads clients only (the legacy owner role is a client)', async () => {
    s.expert = { id: 'e', role: 'expert' }
    expect('response' in (await authorizeUserDataRead(req(), 'users.sensitive', async () => UID))).toBe(false)
    s.targetRole = 'owner'
    expect('response' in (await authorizeUserDataRead(req(), 'users.sensitive', async () => UID))).toBe(false)
    s.targetRole = 'admin'
    const r = await authorizeUserDataRead(req(), 'users.sensitive', async () => UID)
    expect('response' in r && r.response.status).toBe(403)
  })

  it('an expert who must pass the second factor is told so', async () => {
    s.expertBlock = 'step_up'
    const r = await authorizeUserDataRead(req(), 'users.sensitive', async () => UID)
    expect('response' in r && (await r.response.json()).code).toBe('MFA_STEP_UP_REQUIRED')
  })

  it('anyone else is refused', async () => {
    const r = await authorizeUserDataRead(req(), 'users.sensitive', async () => UID)
    expect('response' in r && r.response.status).toBe(403)
  })
})
