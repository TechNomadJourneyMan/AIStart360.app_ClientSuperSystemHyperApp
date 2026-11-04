/**
 * Server-side RBAC on destructive GIGA-CRM routes: a role without the
 * permission gets 403 BEFORE anything is read or written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const state = vi.hoisted(() => ({ role: 'super_admin' as string, touched: 0, audits: 0 }))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: 'session', role: state.role as StaffRole })),
    staffRoleOfUser: async () => { state.touched++; return { staffRole: null, profileRole: 'client', status: 'approved', email: 'c@x.io' } },
    forbidTarget: async () => null,
    STAFF_COOKIE_NAME: 'x',
    STAFF_COOKIE_TTL_SECONDS: 60,
  }
})
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => { state.touched++; throw new Error('must not reach the database') },
}))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => { state.audits++; return true } }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))

const UID = '11111111-2222-3333-4444-555555555555'
const AID = '99999999-8888-4777-8666-555555555555'
const req = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const archive = await import('@/app/api/giga-admin/users/[id]/archive/route')
const purge = await import('@/app/api/giga-admin/users/[id]/purge/route')
const userProfile = await import('@/app/api/giga-admin/users/[id]/profile/route')
const usersBulk = await import('@/app/api/giga-admin/users/bulk/route')
const gri = await import('@/app/api/giga-admin/users/[id]/gri/[assessmentId]/route')
const staffRole = await import('@/app/api/giga-admin/users/[id]/staff-role/route')
const content = await import('@/app/api/giga-admin/content/pages/[id]/route')
const sections = await import('@/app/api/giga-admin/sections/route')
const imp = await import('@/app/api/giga-admin/impersonation/route')
const cfEvents = await import('@/app/api/giga-admin/content-filter/events/[id]/route')
const cfTerms = await import('@/app/api/giga-admin/content-filter/terms/route')
const devViewAs = await import('@/app/api/giga-admin/dev-tools/view-as/route')
const devAccounts = await import('@/app/api/giga-admin/dev-tools/test-accounts/route')
const devAccount = await import('@/app/api/giga-admin/dev-tools/test-accounts/[id]/route')
const devEndAll = await import('@/app/api/giga-admin/dev-tools/impersonation/end-all/route')
const DEV_ONLY: StaffRole[] = ['admin', 'super_expert', 'crm_manager', 'content_manager', 'analyst', 'support']

beforeEach(() => { state.touched = 0; state.audits = 0 })

const cases: Array<{ name: string; roles: StaffRole[]; call: () => Promise<Response> }> = [
  { name: 'archive user', roles: ['crm_manager', 'content_manager', 'analyst', 'support'], call: () => archive.POST(req(`/api/giga-admin/users/${UID}/archive`, 'POST', { action: 'archive', reason: 'test' }), { params: { id: UID } }) },
  { name: 'purge user', roles: ['admin', 'super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'], call: () => purge.POST(req(`/api/giga-admin/users/${UID}/purge`, 'POST', { confirmEmail: 'c@x.io', reason: 'test' }), { params: { id: UID } }) },
  { name: 'rename user', roles: ['super_expert', 'content_manager', 'analyst', 'support'], call: () => userProfile.PATCH(req(`/api/giga-admin/users/${UID}/profile`, 'PATCH', { full_name: 'Новое Имя' }), { params: { id: UID } }) },
  { name: 'bulk purge users', roles: ['admin', 'super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'], call: () => usersBulk.POST(req('/api/giga-admin/users/bulk', 'POST', { action: 'purge', ids: [UID], confirm: 'УДАЛИТЬ', reason: 'test' })) },
  { name: 'bulk unblock users', roles: ['super_expert', 'content_manager', 'analyst', 'support'], call: () => usersBulk.POST(req('/api/giga-admin/users/bulk', 'POST', { action: 'unblock', ids: [UID] })) },
  { name: 'purge preview', roles: ['admin', 'super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'], call: () => purge.GET(req(`/api/giga-admin/users/${UID}/purge`, 'GET', undefined), { params: { id: UID } }) },
  { name: 'delete GRI result', roles: ['crm_manager', 'content_manager', 'analyst', 'support'], call: () => gri.DELETE(req(`/api/giga-admin/users/${UID}/gri/${AID}`, 'DELETE', { reason: 'test' }), { params: { id: UID, assessmentId: AID } }) },
  { name: 'edit GRI answers', roles: ['content_manager', 'analyst', 'support'], call: () => gri.PATCH(req(`/api/giga-admin/users/${UID}/gri/${AID}`, 'PATCH', { makeCurrent: true, reason: 'test' }), { params: { id: UID, assessmentId: AID } }) },
  { name: 'grant staff role', roles: ['admin', 'crm_manager', 'content_manager', 'analyst', 'support'], call: () => staffRole.PUT(req(`/api/giga-admin/users/${UID}/staff-role`, 'PUT', { role: 'support', reason: 'test' }), { params: { id: UID } }) },
  { name: 'delete content page', roles: ['crm_manager', 'analyst', 'support'], call: () => content.DELETE(req(`/api/giga-admin/content/pages/${AID}`, 'DELETE', {}), { params: { id: AID } }) },
  { name: 'change platform sections', roles: ['crm_manager', 'analyst', 'support'], call: () => sections.PUT(req('/api/giga-admin/sections', 'PUT', { sections: [] })) },
  { name: 'impersonate (edit mode)', roles: ['content_manager', 'analyst', 'support'], call: () => imp.POST(req('/api/giga-admin/impersonation', 'POST', { userId: UID, mode: 'edit', reason: 'проверка прав' })) },
  { name: 'content filter: review event', roles: ['super_expert', 'analyst', 'support'], call: () => cfEvents.PATCH(req(`/api/giga-admin/content-filter/events/${AID}`, 'PATCH', { status: 'reviewed' }), { params: { id: AID } }) },
  { name: 'content filter: add term', roles: ['super_expert', 'analyst', 'support'], call: () => cfTerms.POST(req('/api/giga-admin/content-filter/terms', 'POST', { term: 'казино', kind: 'block' })) },
  { name: 'content filter: delete term', roles: ['super_expert', 'analyst', 'support'], call: () => cfTerms.DELETE(req('/api/giga-admin/content-filter/terms', 'DELETE', { id: AID })) },
  // Dev-tools (devtools.use): Super Admin only — admin included in the denied list.
  { name: 'dev-tools: view as role', roles: DEV_ONLY, call: () => devViewAs.POST(req('/api/giga-admin/dev-tools/view-as', 'POST', { role: 'analyst' })) },
  { name: 'dev-tools: create test account', roles: DEV_ONLY, call: () => devAccounts.POST(req('/api/giga-admin/dev-tools/test-accounts', 'POST', { kind: 'client' })) },
  { name: 'dev-tools: delete all test accounts', roles: DEV_ONLY, call: () => devAccounts.DELETE(req('/api/giga-admin/dev-tools/test-accounts', 'DELETE', { confirm: 'УДАЛИТЬ' })) },
  { name: 'dev-tools: test account status', roles: DEV_ONLY, call: () => devAccount.PATCH(req(`/api/giga-admin/dev-tools/test-accounts/${UID}`, 'PATCH', { status: 'blocked' }), { params: { id: UID } }) },
  { name: 'dev-tools: delete test account', roles: DEV_ONLY, call: () => devAccount.DELETE(req(`/api/giga-admin/dev-tools/test-accounts/${UID}`, 'DELETE', undefined), { params: { id: UID } }) },
  { name: 'dev-tools: end all impersonation', roles: DEV_ONLY, call: () => devEndAll.POST(req('/api/giga-admin/dev-tools/impersonation/end-all', 'POST', {})) },
]

describe('GIGA-CRM destructive routes enforce permissions server-side', () => {
  for (const c of cases) {
    it(`${c.name}: denied for ${c.roles.join(', ')}`, async () => {
      for (const role of c.roles) {
        state.role = role
        const res = await c.call()
        expect(res.status, `${c.name} as ${role}`).toBe(403)
      }
      expect(state.touched).toBe(0)
      expect(state.audits).toBe(0)
    })
  }

  it('cross-site mutation is rejected even for super_admin', async () => {
    const { isSameOriginMutation } = await vi.importActual<typeof import('@/lib/admin/giga-actor')>('@/lib/admin/giga-actor')
    const evil = new NextRequest('http://localhost/api/giga-admin/users/x/block', { method: 'POST', headers: { origin: 'https://evil.example', host: 'localhost' } })
    expect(isSameOriginMutation(evil)).toBe(false)
    const same = new NextRequest('http://localhost/api/giga-admin/users/x/block', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' } })
    expect(isSameOriginMutation(same)).toBe(true)
    const read = new NextRequest('http://localhost/api/giga-admin/users', { method: 'GET', headers: { origin: 'https://evil.example' } })
    expect(isSameOriginMutation(read)).toBe(true)
  })
})
