/**
 * PUT /api/giga-admin/settings: permission, validation, lock-out guards,
 * audit-before-write and no-op detection.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const state = vi.hoisted(() => ({
  role: 'super_admin' as string,
  kind: 'session' as 'session' | 'staff_cookie' | 'break_glass',
  stored: {} as Record<string, unknown>,
  order: [] as string[],
  auditFails: false,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: state.kind, role: state.role as StaffRole })) }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async () => {
    state.order.push('audit')
    if (state.auditFails) throw new Error('Audit log unavailable — action refused')
    return true
  },
}))
vi.mock('@/lib/settings/store', async () => {
  const { SETTING_KEYS, coerceSetting } = await import('@/lib/settings/registry')
  return {
    getAllSettings: async (_opts?: unknown) => ({
      values: Object.fromEntries(SETTING_KEYS.map((k) => [k, coerceSetting(k, state.stored[k])])),
      meta: {},
    }),
    saveSettings: async (v: Record<string, unknown>) => {
      state.order.push('save')
      Object.assign(state.stored, v)
    },
  }
})

const route = await import('@/app/api/giga-admin/settings/route')
const put = (values: unknown) =>
  route.PUT(new NextRequest('http://localhost/api/giga-admin/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ values }),
  }))

beforeEach(() => {
  state.role = 'super_admin'
  state.kind = 'session'
  state.stored = {}
  state.order = []
  state.auditFails = false
})

describe('settings API', () => {
  it('only settings.manage may write', async () => {
    for (const role of ['admin', 'crm_manager', 'content_manager', 'analyst', 'support']) {
      state.role = role
      expect((await put({ access_gates: true })).status, role).toBe(403)
    }
    expect(state.order).toEqual([])
  })

  it('rejects unknown keys and invalid values', async () => {
    expect((await put({ nope: 1 })).status).toBe(422)
    expect((await put({ impersonation_ttl_minutes: 1 })).status).toBe(422)
    expect((await put({ announcement: { enabled: true, text: 'x', tone: 'info', link_label: '', link_href: 'javascript:alert(1)' } })).status).toBe(422)
    expect((await put({})).status).toBe(422)
    expect(state.order).toEqual([])
  })

  it('audits before saving and returns new values', async () => {
    const res = await put({ gri_free_runs: 3, access_gates: true })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.changed.sort()).toEqual(['access_gates', 'gri_free_runs'])
    expect(body.values.gri_free_runs).toBe(3)
    expect(state.order).toEqual(['audit', 'save'])
  })

  it('does nothing when values are unchanged', async () => {
    const res = await put({ access_gates: false })
    expect((await res.json()).changed).toEqual([])
    expect(state.order).toEqual([])
  })

  it('refuses the write when the audit log is unavailable', async () => {
    state.auditFails = true
    expect((await put({ access_gates: true })).status).toBe(500)
    expect(state.order).toEqual(['audit'])
  })

  it('the removed break-glass switch is no longer a setting', async () => {
    expect((await put({ break_glass_enabled: false })).status).toBe(422)
  })
})
