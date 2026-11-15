/**
 * R2-B — права маршрутов SLA экспертов:
 *   GET   /api/giga-admin/expert-sla        clients.review; скоуп сотрудника;
 *   PATCH /api/giga-admin/expert-sla/:id    clients.review + users.sensitive; только видимая задача;
 *   GET   /api/expert/sla-tasks             эксперт — только свои и своих клиентов;
 *   GET   /api/v1/expert-sla                клиент — только свои; обещание «48 часов» лишь при задаче в очереди.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { slaDeadlines } from '@/lib/expert-sla/policy'
import { slaDb, type Row } from './_fake'

const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const SE = 'aaaaaaaa-0000-4000-8000-000000000002'
const E1 = 'eeeeeeee-0000-4000-8000-000000000001'
const E2 = 'eeeeeeee-0000-4000-8000-000000000002'
const C1 = 'cccccccc-0000-4000-8000-000000000001'
const C2 = 'cccccccc-0000-4000-8000-000000000002'
const C3 = 'cccccccc-0000-4000-8000-000000000003'
const T = (n: number) => `77777777-0000-4000-8000-00000000000${n}`
const T0 = new Date(Date.now() - 2 * 3_600_000)

const s = vi.hoisted(() => ({
  role: 'admin' as string,
  actorId: '',
  scope: { scope: 'all' as 'all' | 'assigned', clientIds: [] as string[] },
  world: null as null | ReturnType<typeof import('./_fake').slaDb>,
  serverUser: null as null | { id: string },
  expertViewer: null as null | { id: string; role: string },
  expertClients: [] as string[],
  assigned: [] as Array<[string, string | null]>,
  audits: [] as Array<Record<string, unknown>>,
  notifiedAssigned: [] as string[],
  setting: { enabled: true, reaction_hours: 24, answer_hours: 48, auto_assign: true },
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: s.actorId, kind: 'session', role: s.role as StaffRole, email: 'x@x.io' })) }
})
vi.mock('@/lib/admin/actor-scope', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/actor-scope')>()),
  actorClientScope: async () => s.scope,
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => s.world!.sb }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: s.serverUser } }) }, from: (t: string) => s.world!.sb.from(t) }),
}))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => s.setting }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async (_a: unknown, e: Record<string, unknown>) => { s.audits.push(e); return true } }))
vi.mock('@/lib/admin/client-actions', () => ({
  setClientAssignment: async (a: { userId: string; assigneeId: string | null }) => { s.assigned.push([a.userId, a.assigneeId]); return { ok: true } },
}))
vi.mock('@/lib/expert-sla/notify', async (orig) => ({
  ...(await orig<typeof import('@/lib/expert-sla/notify')>()),
  createDefaultNotifier: () => ({ assigned: async (t: { id: string }) => { s.notifiedAssigned.push(t.id) }, queued: async () => {}, threshold: async () => {} }),
}))
vi.mock('@/lib/expert-auth', async () => {
  const { NextResponse } = await import('next/server')
  return {
    resolveExpert: async () => (s.expertViewer ? { ok: true, viewer: { ...s.expertViewer, email: null } } : { ok: false, block: 'forbidden' }),
    expertBlockResponse: () => NextResponse.json({ ok: false }, { status: 403 }),
  }
})
vi.mock('@/lib/access/actor', () => ({ visibleClientIds: async () => ({ ids: s.expertClients }) }))

function task(n: number, client: string, over: Row = {}): Row {
  return {
    id: T(n), source: 'case', source_id: `k${n}`, client_id: client, company_id: null, title: `Задача ${n}`, assignee_id: null,
    assigned_at: null, assigned_via: null, received_at: T0.toISOString(), ...slaDeadlines(T0), first_response_at: null, closed_at: null,
    close_reason: null, escalated_at: null, breached_at: null, created_at: T0.toISOString(), ...over,
  }
}

beforeEach(() => {
  s.role = 'admin'
  s.actorId = ADMIN
  s.scope = { scope: 'all', clientIds: [] }
  s.serverUser = null
  s.expertViewer = null
  s.expertClients = []
  s.assigned = []
  s.audits = []
  s.notifiedAssigned = []
  s.setting = { enabled: true, reaction_hours: 24, answer_hours: 48, auto_assign: true }
  s.world = slaDb({
    profiles: [
      { id: E1, role: 'expert', status: 'approved', full_name: 'Эксперт 1' },
      { id: E2, role: 'expert', status: 'approved', full_name: 'Эксперт 2' },
      { id: SE, role: 'client', status: 'approved' },
      { id: 'crm', role: 'client', status: 'approved' },
    ],
    staff_roles: [{ user_id: SE, role: 'super_expert' }, { user_id: 'crm', role: 'crm_manager' }],
    expert_sla_tasks: [
      task(1, C1, { assignee_id: E1 }),
      task(2, C2, { assignee_id: E2 }),
      task(3, C3),
      task(4, C2, { assignee_id: E1, source: 'report_review' }),
      task(5, C1, { closed_at: new Date().toISOString(), assignee_id: E1 }),
      task(6, C3, { source: 'plan_review' }),
    ],
  })
})

const req = (url: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json', origin: 'http://localhost' } } : {}),
  })

describe('GET /api/giga-admin/expert-sla', () => {
  it('needs clients.review: a CRM manager or support is refused', async () => {
    const { GET } = await import('@/app/api/giga-admin/expert-sla/route')
    for (const role of ['crm_manager', 'support', 'analyst']) {
      s.role = role
      expect((await GET(req('/api/giga-admin/expert-sla'))).status).toBe(403)
    }
  })

  it('admin sees every open task; a SuperExpert with «only assigned» sees his clients\' tasks only', async () => {
    const { GET } = await import('@/app/api/giga-admin/expert-sla/route')
    const all = await (await GET(req('/api/giga-admin/expert-sla?view=open'))).json()
    expect(all.data.map((t: { id: string }) => t.id).sort()).toEqual([T(1), T(2), T(3), T(4), T(6)])
    expect(all.summary).toMatchObject({ open: 5, queue: 1 })

    s.role = 'super_expert'
    s.actorId = SE
    s.scope = { scope: 'assigned', clientIds: [C3] }
    // п. 1–2: a task still «assigned» to him of a client taken from him is not shown (145 showed it).
    s.world!.db.expert_sla_tasks.push(task(7, C1, { assignee_id: SE }))
    const mine = await (await GET(req('/api/giga-admin/expert-sla?view=open'))).json()
    expect(mine.data.map((t: { id: string }) => t.id).sort()).toEqual([T(3), T(6)])
    expect(mine.scope).toBe('assigned')
  })

  it('views: the common queue holds expert work without an assignee (not plan approval); a bad view is 400', async () => {
    const { GET } = await import('@/app/api/giga-admin/expert-sla/route')
    const q = await (await GET(req('/api/giga-admin/expert-sla?view=queue'))).json()
    expect(q.data.map((t: { id: string }) => t.id)).toEqual([T(3)])
    expect((await GET(req('/api/giga-admin/expert-sla?view=everything'))).status).toBe(400)
  })
})

describe('PATCH /api/giga-admin/expert-sla/:id', () => {
  it('admin hands the client to an expert: assignment, audit; the announcement goes through the outbox', async () => {
    const { PATCH } = await import('@/app/api/giga-admin/expert-sla/[id]/route')
    const res = await PATCH(req(`/api/giga-admin/expert-sla/${T(3)}`, { method: 'PATCH', body: { assigneeId: E2 } }), { params: { id: T(3) } })
    expect(res.status).toBe(200)
    expect(s.assigned).toEqual([[C3, E2]])
    expect(s.world!.db.expert_sla_tasks.find((t) => t.id === T(3))).toMatchObject({ assignee_id: E2, assigned_via: 'manual', assign_notified_at: null })
    expect(s.world!.db.expert_sla_tasks.find((t) => t.id === T(6))!.assignee_id).toBeNull() // plan approval stays with admins
    expect(s.audits).toEqual([expect.objectContaining({ action: 'expert_sla.reassigned', entityId: T(3), targetUserId: C3 })])
    expect(s.notifiedAssigned).toEqual([]) // the SLA pass announces it (outbox, п. 6)
  })

  it('п. 1: «Взять себе» needs the CLIENT in the actor\'s scope — being the task\'s assignee is not enough', async () => {
    const { PATCH } = await import('@/app/api/giga-admin/expert-sla/[id]/route')
    s.role = 'super_expert'
    s.actorId = SE
    s.scope = { scope: 'assigned', clientIds: [] } // the client was taken from him
    s.world!.db.expert_sla_tasks.push(task(8, C3, { assignee_id: SE, assigned_via: 'client' }))
    const res = await PATCH(req(`/api/giga-admin/expert-sla/${T(8)}`, { method: 'PATCH', body: { assigneeId: SE } }), { params: { id: T(8) } })
    expect(res.status).toBe(403)
    expect(s.assigned).toEqual([])
    // Nor may he hand that client to anyone else.
    const other = await PATCH(req(`/api/giga-admin/expert-sla/${T(8)}`, { method: 'PATCH', body: { assigneeId: E1 } }), { params: { id: T(8) } })
    expect(other.status).toBe(403)
    expect(s.assigned).toEqual([])
  })

  it('refuses: a task outside the SuperExpert\'s scope (403), a non-worker target (400), roles without the rights (403)', async () => {
    const { PATCH } = await import('@/app/api/giga-admin/expert-sla/[id]/route')
    s.role = 'super_expert'
    s.actorId = SE
    s.scope = { scope: 'assigned', clientIds: [C3] }
    expect((await PATCH(req(`/api/giga-admin/expert-sla/${T(1)}`, { method: 'PATCH', body: { assigneeId: SE } }), { params: { id: T(1) } })).status).toBe(403)
    expect(s.assigned).toEqual([])

    s.role = 'admin'
    s.scope = { scope: 'all', clientIds: [] }
    const crm = await PATCH(req(`/api/giga-admin/expert-sla/${T(3)}`, { method: 'PATCH', body: { assigneeId: '00000000-0000-4000-8000-0000000000cc' } }), { params: { id: T(3) } })
    expect(crm.status).toBe(400)

    for (const role of ['crm_manager', 'support']) {
      s.role = role
      expect((await PATCH(req(`/api/giga-admin/expert-sla/${T(3)}`, { method: 'PATCH', body: { assigneeId: E1 } }), { params: { id: T(3) } })).status).toBe(403)
    }
    expect(s.assigned).toEqual([])
  })
})

describe('GET /api/expert/sla-tasks', () => {
  it('an expert sees tasks of his clients only — a task left «assigned» to him after the client moved is gone', async () => {
    const { GET } = await import('@/app/api/expert/sla-tasks/route')
    s.expertViewer = { id: E1, role: 'expert' }
    s.expertClients = [C1]
    const body = await (await GET()).json()
    expect(body.data.map((t: { id: string }) => t.id).sort()).toEqual([T(1)]) // T4 (client C2, assignee E1) — not his client
    expect(body.data[0].timer).toMatch(/^осталось \d+ ч$/)

    s.expertViewer = { id: E2, role: 'expert' }
    s.expertClients = [C2]
    expect((await (await GET()).json()).data.map((t: { id: string }) => t.id).sort()).toEqual([T(2), T(4)])
    s.expertClients = []
    expect((await (await GET()).json()).data).toEqual([])
    // A staff Admin in the expert cabinet: the tasks he holds.
    s.expertViewer = { id: E1, role: 'admin' }
    expect((await (await GET()).json()).data.map((t: { id: string }) => t.id).sort()).toEqual([T(1), T(4)])
  })

  it('not an expert → refused', async () => {
    const { GET } = await import('@/app/api/expert/sla-tasks/route')
    expect((await GET()).status).toBe(403)
  })
})

describe('GET /api/v1/expert-sla (client)', () => {
  it('a client gets only his own open tasks and the honest promise; nobody\'s assignee', async () => {
    const { GET } = await import('@/app/api/v1/expert-sla/route')
    s.serverUser = { id: C2 }
    const body = await (await GET()).json()
    expect(body.data.map((t: { id: string }) => t.id).sort()).toEqual([T(2), T(4)])
    expect(body.promise).toBe('Эксперт ответит в течение 48 часов.')
    expect(JSON.stringify(body)).not.toContain(E2)

    s.serverUser = { id: 'dddddddd-0000-4000-8000-000000000009' }
    expect(await (await GET()).json()).toMatchObject({ data: [], promise: null })
  })

  it('п. 10: no promise for plan approval only (Admin decides) or for an overdue task', async () => {
    const { GET } = await import('@/app/api/v1/expert-sla/route')
    s.serverUser = { id: C3 } // T3 open expert work, T6 plan approval
    expect((await (await GET()).json()).promise).toBe('Эксперт ответит в течение 48 часов.')
    s.world!.db.expert_sla_tasks = s.world!.db.expert_sla_tasks.filter((t) => t.id !== T(3))
    expect((await (await GET()).json())).toMatchObject({ promise: null, data: [{ id: T(6) }] })
    const past = new Date(Date.now() - 60 * 3_600_000)
    s.world!.db.expert_sla_tasks.push(task(9, C3, { received_at: past.toISOString(), ...slaDeadlines(past) }))
    const overdue = await (await GET()).json()
    expect(overdue.promise).toBeNull()
    expect(overdue.data.find((t: { id: string }) => t.id === T(9)).overdue).toBe(true)
  })

  it('п. 10: the SLA ledger missing (migration not applied / rolled back) → no promise', async () => {
    const { GET } = await import('@/app/api/v1/expert-sla/route')
    s.serverUser = { id: C2 }
    s.world!.failing.add('expert_sla_tasks')
    expect(await (await GET()).json()).toMatchObject({ data: [], promise: null, unavailable: true })
  })

  it('SLA switched off → no promise; signed out → 401', async () => {
    const { GET } = await import('@/app/api/v1/expert-sla/route')
    s.serverUser = { id: C2 }
    s.setting = { ...s.setting, enabled: false }
    expect(await (await GET()).json()).toMatchObject({ data: [], promise: null })
    s.serverUser = null
    expect((await GET()).status).toBe(401)
  })
})
