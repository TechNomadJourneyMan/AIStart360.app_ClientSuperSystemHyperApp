/**
 * Область видимости клиентов для эксперта (F-008, миграция 086):
 * по умолчанию эксперт видит всех, в режиме 'assigned' — только тех, где он
 * ответственный. Проверяем хелпер, матрицу прав и реальный маршрут User 360.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const ME = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER_STAFF = 'aaaaaaaa-0000-4000-8000-000000000002'
const MY_CLIENT = 'cccccccc-0000-4000-8000-000000000001'
const FOREIGN_CLIENT = 'cccccccc-0000-4000-8000-000000000002'

const s = vi.hoisted(() => ({
  role: 'super_expert' as string,
  scope: 'all' as 'all' | 'assigned',
  assignments: [] as Array<{ user_id: string; assignee_id: string | null }>,
  queries: [] as string[],
}))

/** Мини-PostgREST: фильтры eq сохраняются, результат зависит от таблицы. */
function query(table: string) {
  const filters: Record<string, string> = {}
  const rows = (): Array<Record<string, unknown>> => {
    if (table === 'user_assignments') {
      return s.assignments.filter((a) => Object.entries(filters).every(([k, v]) => String((a as Record<string, unknown>)[k]) === v))
    }
    if (table === 'user_notes') return [{ id: 'n-1', body: 'заметка', user_id: filters.user_id }]
    return []
  }
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (col: string, v: string) => { filters[col] = v; return q },
    order: () => q,
    limit: () => q,
    in: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
  }
  s.queries.push(table)
  return q
}

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: (t: string) => query(t) }) }))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const inner = makeRequireGiga(() => ({ id: ME, kind: 'session', role: s.role as StaffRole }))
  return {
    requireGiga: async (req: unknown, p: Parameters<typeof inner>[1]) => {
      const g = await inner(req, p)
      return g.actor ? { actor: { ...g.actor, clientScope: s.scope } } : g
    },
  }
})
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => true }))

const scope = await import('@/lib/admin/client-scope')
const notes = await import('@/app/api/giga-admin/users/[id]/notes/route')
const { effectiveClientScope, hasPermission } = await import('@/lib/admin/rbac')

beforeEach(() => {
  s.role = 'super_expert'
  s.scope = 'all'
  s.queries = []
  s.assignments = [
    { user_id: MY_CLIENT, assignee_id: ME },
    { user_id: FOREIGN_CLIENT, assignee_id: OTHER_STAFF },
  ]
})

describe('canAccessClient', () => {
  it("scope 'all' — доступ к любому клиенту без запроса к БД", async () => {
    expect(await scope.canAccessClient({ id: ME, clientScope: 'all' }, FOREIGN_CLIENT)).toBe(true)
    expect(await scope.canAccessClient({ id: ME }, FOREIGN_CLIENT)).toBe(true)
    expect(s.queries).toHaveLength(0)
  })

  it("scope 'assigned' — только клиенты, где я ответственный", async () => {
    const me = { id: ME, clientScope: 'assigned' as const }
    expect(await scope.canAccessClient(me, MY_CLIENT)).toBe(true)
    expect(await scope.canAccessClient(me, FOREIGN_CLIENT)).toBe(false)
  })

  it("scope 'assigned' — клиент без ответственного недоступен", async () => {
    s.assignments = []
    expect(await scope.canAccessClient({ id: ME, clientScope: 'assigned' }, MY_CLIENT)).toBe(false)
  })

  it('кривой id никогда не даёт доступа', async () => {
    expect(await scope.canAccessClient({ id: ME, clientScope: 'assigned' }, 'not-a-uuid')).toBe(false)
  })

  it('assignedClientIds и scopedClientIds', async () => {
    expect(await scope.assignedClientIds(ME)).toEqual([MY_CLIENT])
    expect(await scope.scopedClientIds({ id: ME, clientScope: 'all' })).toBeNull()
    expect(await scope.scopedClientIds({ id: ME, clientScope: 'assigned' })).toEqual([MY_CLIENT])
  })

  it('guardClientAccess: 400 на кривой id, 403 на чужого клиента', async () => {
    expect((await scope.guardClientAccess({ id: ME }, 'x'))?.status).toBe(400)
    const denied = await scope.guardClientAccess({ id: ME, clientScope: 'assigned' }, FOREIGN_CLIENT)
    expect(denied?.status).toBe(403)
    expect((await denied!.json()).error).toBe('Клиент вам не назначен')
    expect(await scope.guardClientAccess({ id: ME, clientScope: 'assigned' }, MY_CLIENT)).toBeNull()
  })

  it('filterByScope', () => {
    const rows = [{ u: MY_CLIENT }, { u: FOREIGN_CLIENT }]
    expect(scope.filterByScope(rows, null, (r) => r.u)).toHaveLength(2)
    expect(scope.filterByScope(rows, [MY_CLIENT], (r) => r.u)).toEqual([{ u: MY_CLIENT }])
  })
})

describe('матрица: scope и clients.review', () => {
  it("руководящие роли и CRM-менеджер всегда видят всех", () => {
    expect(effectiveClientScope('super_admin', 'assigned')).toBe('all')
    expect(effectiveClientScope('admin', 'assigned')).toBe('all')
    expect(effectiveClientScope('crm_manager', 'assigned')).toBe('all')
    expect(effectiveClientScope('super_expert', 'assigned')).toBe('assigned')
    expect(effectiveClientScope('super_expert', undefined)).toBe('all')
    expect(effectiveClientScope('super_expert', 'garbage')).toBe('all')
  })

  it('clients.review — у super_admin, admin и super_expert', () => {
    expect(hasPermission('super_admin', 'clients.review')).toBe(true)
    expect(hasPermission('admin', 'clients.review')).toBe(true)
    expect(hasPermission('super_expert', 'clients.review')).toBe(true)
    for (const r of ['crm_manager', 'content_manager', 'analyst', 'support'] as const) {
      expect(hasPermission(r, 'clients.review')).toBe(false)
    }
  })
})

describe('маршрут User 360 учитывает scope', () => {
  const get = (id: string) =>
    notes.GET(new NextRequest(`http://localhost/api/giga-admin/users/${id}/notes`), { params: { id } })

  it("scope 'assigned': чужой клиент → 403 «Клиент вам не назначен»", async () => {
    s.scope = 'assigned'
    const res = await get(FOREIGN_CLIENT)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Клиент вам не назначен')
    expect(s.queries).not.toContain('user_notes')
  })

  it("scope 'assigned': свой клиент → 200", async () => {
    s.scope = 'assigned'
    const res = await get(MY_CLIENT)
    expect(res.status).toBe(200)
  })

  it("scope 'all': любой клиент → 200", async () => {
    s.scope = 'all'
    const res = await get(FOREIGN_CLIENT)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(1)
  })
})
