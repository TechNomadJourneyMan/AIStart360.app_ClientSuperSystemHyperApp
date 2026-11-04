/**
 * «Посмотреть как роль» (Dev-tools): только понижение прав и только для
 * Super Admin; подделанный / чужой cookie игнорируется; выйти можно всегда.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

process.env.AUTH_SECRET = 'test-auth-secret-for-view-as-0123456789'

const db = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: null as null | { role?: string; status?: string },
  staff: null as null | { role?: string },
}))

function table(name: string) {
  if (name === 'webauthn_credentials') return { select: () => ({ eq: async () => ({ count: 0, error: null }) }) }
  const row = name === 'profiles' ? db.profile : name === 'user_security' ? null : db.staff
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({ auth: { getUser: db.getUser }, from: table }) }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: table }) }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => false }))

import { getGigaActor, requireGiga } from '@/lib/admin/giga-actor'
import { signToken } from '@/lib/security/signed-token'
import {
  VIEW_AS_COOKIE_NAME, VIEWABLE_ROLES, canExitViewAs, isViewableRole, needsRealRole, readViewAs, resolveViewAs, signViewAs,
} from '@/lib/devtools/view-as'

const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002'

function request(cookie?: string) {
  return new NextRequest('http://localhost/api/giga-admin/test', {
    headers: cookie ? { cookie: `${VIEW_AS_COOKIE_NAME}=${cookie}` } : undefined,
  })
}

describe('resolveViewAs (pure downgrade rule)', () => {
  it('super_admin with a cookie bound to their own id gets the viewed role', () => {
    expect(resolveViewAs({ realRole: 'super_admin', actorId: ADMIN, claims: { sub: ADMIN, role: 'analyst' } })).toBe('analyst')
  })

  it('a non-super_admin with a (forged or leftover) cookie is ignored', () => {
    for (const realRole of ['admin', 'support', 'analyst', 'super_expert'] as const) {
      expect(resolveViewAs({ realRole, actorId: ADMIN, claims: { sub: ADMIN, role: 'support' } })).toBeNull()
    }
  })

  it('a cookie issued for another user id is ignored', () => {
    expect(resolveViewAs({ realRole: 'super_admin', actorId: ADMIN, claims: { sub: OTHER, role: 'analyst' } })).toBeNull()
    expect(resolveViewAs({ realRole: 'super_admin', actorId: ADMIN, claims: { role: 'analyst' } })).toBeNull()
  })

  it('never upgrades: super_admin or an unknown role in the cookie is ignored', () => {
    expect(resolveViewAs({ realRole: 'super_admin', actorId: ADMIN, claims: { sub: ADMIN, role: 'super_admin' } })).toBeNull()
    expect(resolveViewAs({ realRole: 'super_admin', actorId: ADMIN, claims: { sub: ADMIN, role: 'owner' } })).toBeNull()
    expect(resolveViewAs({ realRole: 'super_admin', actorId: ADMIN, claims: null })).toBeNull()
  })

  it('requests needing devtools.use always run with the real role (exit is always possible)', () => {
    expect(needsRealRole(['devtools.use'])).toBe(true)
    expect(needsRealRole(['users.view'])).toBe(false)
    expect(resolveViewAs({ realRole: 'super_admin', actorId: ADMIN, claims: { sub: ADMIN, role: 'analyst' }, needed: ['devtools.use'] })).toBeNull()
    expect(canExitViewAs()).toBe(true)
  })

  it('every staff role except super_admin is viewable', () => {
    expect(VIEWABLE_ROLES).not.toContain('super_admin')
    expect(VIEWABLE_ROLES).toEqual(expect.arrayContaining(['admin', 'super_expert', 'crm_manager', 'content_manager', 'analyst', 'support']))
    expect(isViewableRole('super_admin')).toBe(false)
  })
})

describe('view-as cookie', () => {
  it('round-trips and is a token type of its own', async () => {
    const t = await signViewAs(ADMIN, 'support')
    await expect(readViewAs(t)).resolves.toMatchObject({ sub: ADMIN, role: 'support' })
    // A staff-panel token is not a view-as token, even with the same claims.
    const staff = await signToken('staff', { sub: ADMIN, role: 'support' }, 60)
    await expect(readViewAs(staff)).resolves.toBeNull()
    await expect(readViewAs(`${t.slice(0, -2)}xx`)).resolves.toBeNull()
  })

  it('refuses to sign super_admin', async () => {
    await expect(signViewAs(ADMIN, 'super_admin')).rejects.toThrow()
  })
})

describe('requireGiga with a view-as cookie', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.profile = null
    db.staff = null
  })

  it('a super_admin viewing as analyst gets analyst permissions on ordinary routes', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: ADMIN, email: 'owner@example.com' } } })
    db.profile = { role: 'super_admin', status: 'approved' }
    const req = request(await signViewAs(ADMIN, 'analyst'))

    const ok = await requireGiga(req, 'users.view')
    expect(ok.actor).toMatchObject({ id: ADMIN, role: 'analyst', realRole: 'super_admin', viewAs: 'analyst' })
    expect(ok.actor?.permissions).not.toContain('users.sensitive')

    const denied = await requireGiga(req, 'settings.manage')
    expect(denied.response?.status).toBe(403)

    const actor = await getGigaActor(req)
    expect(actor?.role).toBe('analyst')
  })

  it('Dev-tools routes (devtools.use) keep the real role while viewing as another role', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: ADMIN, email: 'owner@example.com' } } })
    db.profile = { role: 'super_admin', status: 'approved' }
    const guard = await requireGiga(request(await signViewAs(ADMIN, 'support')), 'devtools.use')
    expect(guard.actor?.role).toBe('super_admin')
    expect(guard.actor?.viewAs).toBeUndefined()
  })

  it('a support member with a view-as cookie bound to their own id keeps exactly their role', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: OTHER, email: 'support@example.com' } } })
    db.profile = { role: 'client', status: 'approved' }
    db.staff = { role: 'support' }
    const guard = await requireGiga(request(await signViewAs(OTHER, 'admin')), 'users.view')
    expect(guard.actor).toMatchObject({ role: 'support' })
    expect(guard.actor?.viewAs).toBeUndefined()
    expect((await requireGiga(request(await signViewAs(OTHER, 'admin')), 'users.manage')).response?.status).toBe(403)
  })

  it('a cookie minted for another super_admin is ignored', async () => {
    db.getUser.mockResolvedValue({ data: { user: { id: ADMIN, email: 'owner@example.com' } } })
    db.profile = { role: 'super_admin', status: 'approved' }
    const guard = await requireGiga(request(await signViewAs(OTHER, 'analyst')), 'settings.manage')
    expect(guard.actor?.role).toBe('super_admin')
  })
})
