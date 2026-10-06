/**
 * Agent Control Center routes enforce agents.* / approvals.decide on the
 * server: a role without the permission gets 403 before any database access
 * or audit write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const state = vi.hoisted(() => ({ role: 'super_admin' as string, touched: 0, audits: 0 }))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: 'session', role: state.role as StaffRole })),
    STAFF_COOKIE_NAME: 'x',
    STAFF_COOKIE_TTL_SECONDS: 60,
  }
})
vi.mock('@/lib/db', () => ({
  prisma: new Proxy({}, { get: () => { state.touched++; throw new Error('must not reach the database') } }),
}))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => { state.audits++; return true } }))

const ID = '99999999-8888-4777-8666-555555555555'
const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const agents = await import('@/app/api/giga-admin/agents/route')
const agent = await import('@/app/api/giga-admin/agents/[key]/route')
const perms = await import('@/app/api/giga-admin/agents/[key]/permissions/route')
const run = await import('@/app/api/giga-admin/agents/[key]/run/route')
const task = await import('@/app/api/giga-admin/agents/tasks/[id]/route')
const approval = await import('@/app/api/giga-admin/agents/approvals/[id]/route')
const costs = await import('@/app/api/giga-admin/agents/costs/route')

beforeEach(() => { state.touched = 0; state.audits = 0 })

const cases: Array<{ name: string; roles: StaffRole[]; call: () => Promise<Response> }> = [
  { name: 'list agents', roles: ['super_expert', 'content_manager', 'support'], call: () => agents.GET(req('/api/giga-admin/agents', 'GET')) },
  { name: 'view costs', roles: ['super_expert', 'content_manager', 'support'], call: () => costs.GET(req('/api/giga-admin/agents/costs', 'GET')) },
  { name: 'change agent config', roles: ['super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'], call: () => agent.PATCH(req('/api/giga-admin/agents/monitoring', 'PATCH', { enabled: false }), { params: { key: 'monitoring' } }) },
  { name: 'change agent permissions', roles: ['super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'], call: () => perms.PUT(req('/api/giga-admin/agents/monitoring/permissions', 'PUT', { grants: { SEND_EMAIL: 'ALLOW' } }), { params: { key: 'monitoring' } }) },
  { name: 'run agent', roles: ['super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'], call: () => run.POST(req('/api/giga-admin/agents/monitoring/run', 'POST', {}), { params: { key: 'monitoring' } }) },
  { name: 'retry task', roles: ['super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'], call: () => task.POST(req(`/api/giga-admin/agents/tasks/${ID}`, 'POST', { action: 'retry' }), { params: { id: ID } }) },
  { name: 'decide approval', roles: ['super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'], call: () => approval.POST(req(`/api/giga-admin/agents/approvals/${ID}`, 'POST', { decision: 'approve' }), { params: { id: ID } }) },
]

describe('Agent Control Center routes enforce permissions server-side', () => {
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

  it('admins may decide approvals; analysts may only view', async () => {
    const { hasPermission } = await import('@/lib/admin/rbac')
    expect(hasPermission('admin', 'approvals.decide')).toBe(true)
    expect(hasPermission('admin', 'agents.manage')).toBe(true)
    expect(hasPermission('analyst', 'agents.view')).toBe(true)
    expect(hasPermission('analyst', 'agents.run')).toBe(false)
    expect(hasPermission('crm_manager', 'approvals.decide')).toBe(false)
  })
})
