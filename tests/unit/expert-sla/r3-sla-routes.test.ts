/**
 * R3-SLA (миграция 152) — маршруты SLA для новых источников:
 *   PATCH /api/giga-admin/expert-sla/:id  план Точки Б: «Взять себе» — только Admin / Super Admin,
 *                                          ответственный клиента не меняется, журнал expert_sla.taken;
 *   GET   /api/giga-admin/expert-sla?source=plan_prep — «Ждут план» в очереди Точки Б;
 *   GET   /api/v1/expert-sla               клиенту — кто готовит план (имя, не email) и срок.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { slaDeadlines } from '@/lib/expert-sla/policy'
import { slaDb, type Row } from './_fake'

const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const SE = 'aaaaaaaa-0000-4000-8000-000000000002'
const E1 = 'eeeeeeee-0000-4000-8000-000000000001'
const C1 = 'cccccccc-0000-4000-8000-000000000001'
const T = (n: number) => `77777777-0000-4000-8000-00000000000${n}`
const T0 = new Date(Date.now() - 2 * 3_600_000)

const s = vi.hoisted(() => ({
  role: 'admin' as string,
  actorId: '',
  world: null as null | ReturnType<typeof import('./_fake').slaDb>,
  serverUser: null as null | { id: string },
  assigned: [] as Array<[string, string | null]>,
  audits: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: s.actorId, kind: 'session', role: s.role as StaffRole, email: 'x@x.io' })) }
})
vi.mock('@/lib/admin/actor-scope', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/actor-scope')>()),
  actorClientScope: async () => ({ scope: 'all', clientIds: [] }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.world!.sb }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.serverUser } }) }, from: (t: string) => s.world!.sb.from(t) }),
}))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => ({ enabled: true, reaction_hours: 24, answer_hours: 48, auto_assign: true }) }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async (_a: unknown, e: Record<string, unknown>) => { s.audits.push(e); return true } }))
vi.mock('@/lib/admin/client-actions', () => ({
  setClientAssignment: async (a: { userId: string; assigneeId: string | null }) => { s.assigned.push([a.userId, a.assigneeId]); return { ok: true } },
}))

function task(n: number, over: Row = {}): Row {
  return {
    id: T(n), source: 'plan_prep', source_id: `co-${n}`, client_id: C1, company_id: `co-${n}`, title: 'Подготовить план Точки Б', assignee_id: null,
    assigned_at: null, assigned_via: null, received_at: T0.toISOString(), ...slaDeadlines(T0), first_response_at: null, closed_at: null,
    close_reason: null, escalated_at: null, breached_at: null, created_at: T0.toISOString(), assign_notified_at: null, ...over,
  }
}

beforeEach(() => {
  s.role = 'admin'
  s.actorId = ADMIN
  s.serverUser = null
  s.assigned = []
  s.audits = []
  s.world = slaDb({
    profiles: [
      { id: ADMIN, status: 'approved', full_name: 'Анна Админ', email: 'anna@x.io' },
      { id: SE, status: 'approved', full_name: 'Супер Эксперт' },
      { id: E1, role: 'expert', status: 'approved', full_name: 'Эксперт 1' },
    ],
    staff_roles: [{ user_id: ADMIN, role: 'admin' }, { user_id: SE, role: 'super_expert' }],
    expert_sla_tasks: [task(1), task(2, { source: 'case', source_id: 'k2' }), task(3, { source: 'pa_ai_review', source_id: 'diag-3' })],
  })
})

const req = (url: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json', origin: 'http://localhost' } } : {}),
  })
const byId = (id: string) => s.world!.db.expert_sla_tasks.find((t) => t.id === id)!

describe('PATCH /api/giga-admin/expert-sla/:id — the plan of Point B', () => {
  it('an admin takes it himself: he holds the task, the client\'s responsible is untouched, the journal has it', async () => {
    const { PATCH } = await import('@/app/api/giga-admin/expert-sla/[id]/route')
    const res = await PATCH(req(`/api/giga-admin/expert-sla/${T(1)}`, { method: 'PATCH', body: { assigneeId: ADMIN } }), { params: { id: T(1) } })
    expect(res.status).toBe(200)
    expect(byId(T(1))).toMatchObject({ assignee_id: ADMIN, assigned_via: 'manual' })
    expect(s.assigned).toEqual([]) // no setClientAssignment
    expect(s.audits).toEqual([expect.objectContaining({ action: 'expert_sla.taken', entityId: T(1), targetUserId: C1, metadata: expect.objectContaining({ source: 'plan_prep', self: true }) })])
  })

  it('a SuperExpert cannot take a plan; nobody hands a plan to an expert', async () => {
    const { PATCH } = await import('@/app/api/giga-admin/expert-sla/[id]/route')
    s.role = 'super_expert'
    s.actorId = SE
    expect((await PATCH(req(`/api/giga-admin/expert-sla/${T(1)}`, { method: 'PATCH', body: { assigneeId: SE } }), { params: { id: T(1) } })).status).toBe(403)
    s.role = 'admin'
    s.actorId = ADMIN
    expect((await PATCH(req(`/api/giga-admin/expert-sla/${T(1)}`, { method: 'PATCH', body: { assigneeId: E1 } }), { params: { id: T(1) } })).status).toBe(400)
    expect(byId(T(1)).assignee_id).toBeNull()
  })

  it('the AI review is expert work: handed with the client (the responsible changes), like a case', async () => {
    const { PATCH } = await import('@/app/api/giga-admin/expert-sla/[id]/route')
    const res = await PATCH(req(`/api/giga-admin/expert-sla/${T(3)}`, { method: 'PATCH', body: { assigneeId: E1 } }), { params: { id: T(3) } })
    expect(res.status).toBe(200)
    expect(s.assigned).toEqual([[C1, E1]])
    expect(byId(T(3)).assignee_id).toBe(E1)
  })
})

describe('GET /api/giga-admin/expert-sla?source=…', () => {
  it('one source only (the Point B queue «Ждут план»); an unknown source is 400', async () => {
    const { GET } = await import('@/app/api/giga-admin/expert-sla/route')
    const body = await (await GET(req('/api/giga-admin/expert-sla?view=open&source=plan_prep'))).json()
    expect(body.data.map((t: { id: string }) => t.id)).toEqual([T(1)])
    expect(body.data[0]).toMatchObject({ takeable: true, reassignable: false, sourceLabel: 'Подготовить план Точки Б' })
    expect(body.summary).toMatchObject({ open: 1, queue: 1 })
    expect((await GET(req('/api/giga-admin/expert-sla?view=open&source=bogus'))).status).toBe(400)
  })
})

describe('GET /api/v1/expert-sla — the client', () => {
  it('who prepares the plan: the profile name (never the email); nobody → null', async () => {
    const { GET } = await import('@/app/api/v1/expert-sla/route')
    s.serverUser = { id: C1 }
    byId(T(1)).assignee_id = ADMIN
    const body = await (await GET()).json()
    expect(body.data.find((t: { id: string }) => t.id === T(1))).toMatchObject({ source: 'plan_prep', label: 'Подготовить план Точки Б', assignee: 'Анна Админ' })
    expect(JSON.stringify(body)).not.toContain('anna@x.io')
    expect(body.data.find((t: { id: string }) => t.id === T(2))).not.toHaveProperty('assignee')
    byId(T(1)).assignee_id = null
    expect((await (await GET()).json()).data.find((t: { id: string }) => t.id === T(1)).assignee).toBeNull()
  })
})
