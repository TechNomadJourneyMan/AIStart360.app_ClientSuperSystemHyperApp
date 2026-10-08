/**
 * Очередь эскалаций с SLA (F-017) и видимость клиентов эксперта (F-016):
 * срок реакции, авто-назначение ответственного клиента с уведомлением,
 * пересчёт срока при смене приоритета, тумблер видимости только для
 * управляющих экспертами.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { canManageTarget, hasPermission, type StaffRole } from '@/lib/admin/rbac'
import { computeSlaDueAt, slaState, DEFAULT_SLA_HOURS } from '@/lib/admin/escalations'

const s = vi.hoisted(() => ({
  role: 'admin' as string,
  actorId: '00000000-0000-4000-8000-0000000000aa',
  targetStaffRole: 'super_expert' as string | null,
  single: {} as Record<string, unknown>,
  lists: {} as Record<string, unknown[]>,
  updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  audits: [] as Array<Record<string, unknown>>,
  notified: [] as Array<{ userId: string; type: string; data: Record<string, unknown> }>,
  inApp: [] as Array<Record<string, unknown>>,
  adminNotified: 0,
  dbTouched: 0,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  const { canManageTarget: cmt } = await import('@/lib/admin/rbac')
  const { NextResponse } = await import('next/server')
  return {
    requireGiga: makeRequireGiga(() => ({ id: s.actorId, kind: 'session', role: s.role as StaffRole, email: 'staff@x.io' })),
    forbidTarget: async (a: { role: StaffRole }) => (cmt(a.role, s.targetStaffRole as StaffRole | null) ? null : NextResponse.json({ ok: false }, { status: 403 })),
  }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, e: Record<string, unknown>) => { s.audits.push(e); return true },
}))
vi.mock('@/lib/settings/store', () => ({
  getSetting: async () => ({ critical: 1, high: 4, medium: 10, low: 72 }),
}))
vi.mock('@/lib/notifications', () => ({
  notifyUser: async (userId: string, type: string, data: Record<string, unknown>) => { s.notified.push({ userId, type, data }) },
  notifyAdmins: async () => { s.adminNotified++ },
}))
vi.mock('@/lib/notifications/create', () => ({
  createNotification: async (n: Record<string, unknown>) => { s.inApp.push(n) },
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    s.dbTouched++
    return {
      from: (table: string) => {
        let op = 'select'
        let patch: Record<string, unknown> = {}
        const q: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'in', 'is', 'lt', 'or', 'order', 'range', 'limit']) q[m] = () => q
        q.update = (p: Record<string, unknown>) => { op = 'update'; patch = p; return q }
        q.maybeSingle = async () => {
          if (op === 'update') {
            s.updates.push({ table, patch })
            return { data: { ...(s.single[table] as object), ...patch }, error: null }
          }
          return { data: s.single[table] ?? null, error: null }
        }
        q.then = (ok: (v: unknown) => unknown) => {
          if (op === 'update') s.updates.push({ table, patch })
          return Promise.resolve({ data: op === 'update' ? [{ user_id: 'x' }] : (s.lists[table] ?? []), error: null }).then(ok)
        }
        return q
      },
    }
  },
}))

const CLIENT = '11111111-1111-4111-8111-111111111111'
const EXPERT = '33333333-3333-4333-8333-333333333333'
const CASE = '99999999-9999-4999-8999-999999999999'

beforeEach(() => {
  s.role = 'admin'
  s.targetStaffRole = 'super_expert'
  s.single = {}
  s.lists = {}
  s.updates = []
  s.audits = []
  s.notified = []
  s.inApp = []
  s.adminNotified = 0
  s.dbTouched = 0
})

describe('SLA эскалаций', () => {
  it('срок = создание + часы приоритета', () => {
    const at = '2026-09-24T10:00:00.000Z'
    expect(computeSlaDueAt(at, 'high')).toBe('2026-09-24T14:00:00.000Z')
    expect(computeSlaDueAt(at, 'low', { ...DEFAULT_SLA_HOURS, low: 1 })).toBe('2026-09-24T11:00:00.000Z')
    // Неизвестный приоритет — как средний.
    expect(computeSlaDueAt(at, 'weird')).toBe(computeSlaDueAt(at, 'medium'))
  })

  it('состояние: просрочено / скоро / в норме / соблюдено', () => {
    const now = new Date('2026-09-24T12:00:00Z')
    const base = { created_at: '2026-09-24T00:00:00Z', first_response_at: null }
    expect(slaState({ ...base, status: 'new', sla_due_at: '2026-09-24T11:00:00Z' }, now)).toBe('overdue')
    expect(slaState({ ...base, status: 'new', sla_due_at: '2026-09-24T12:30:00Z' }, now)).toBe('due_soon')
    expect(slaState({ ...base, status: 'in_progress', sla_due_at: '2026-09-26T00:00:00Z' }, now)).toBe('ok')
    expect(slaState({ ...base, status: 'resolved', sla_due_at: '2026-09-24T11:00:00Z' }, now)).toBe('met')
    expect(slaState({ ...base, status: 'new', sla_due_at: '2026-09-24T11:00:00Z', first_response_at: '2026-09-24T10:00:00Z' }, now)).toBe('met')
    expect(slaState({ ...base, status: 'new', sla_due_at: null }, now)).toBe('none')
  })
})

describe('создание кейса ассистентом: SLA и авто-назначение', () => {
  const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  const realFetch = globalThis.fetch
  const posted: Array<Record<string, unknown>> = []
  afterAll(() => {
    globalThis.fetch = realFetch
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.key
  })

  const run = async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
    posted.length = 0
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      posted.push(JSON.parse(init.body))
      return new Response(JSON.stringify([{ id: CASE }]), { status: 201 })
    }) as unknown as typeof fetch
    const { InternalEscalationAdapter } = await import('@/lib/assistant/escalation/internal-adapter')
    const c = {
      id: 'tmp', userId: CLIENT, status: 'new', priority: 'high', triggerType: 'user_requested_help',
      title: 'Нужна помощь с финмоделью', userMessage: 'Помогите', detectedIssues: [],
    }
    const before = Date.now()
    await new InternalEscalationAdapter().notify(c as never)
    return { c, before }
  }

  it('кейс получает срок реакции по настройке и ответственного клиента', async () => {
    s.single = { user_assignments: { assignee_id: EXPERT }, profiles: { full_name: 'Иван', email: 'client@x.io', role: 'client' }, staff_roles: { role: 'super_expert' } }
    const { c, before } = await run()
    expect(posted).toHaveLength(1)
    expect(posted[0].assignee_id).toBe(EXPERT)
    expect(posted[0].assigned_to).toBe(EXPERT)
    const due = new Date(String(posted[0].sla_due_at)).getTime()
    // high = 4 ч по настройке.
    expect(due - before).toBeGreaterThanOrEqual(4 * 3_600_000 - 1000)
    expect(due - before).toBeLessThan(4 * 3_600_000 + 60_000)
    expect(c.id).toBe(CASE)
  })

  it('ответственный получает уведомление (письмо + лента), админы — как раньше', async () => {
    s.single = { user_assignments: { assignee_id: EXPERT }, profiles: { full_name: 'Иван', email: 'client@x.io', role: 'client' }, staff_roles: { role: 'super_expert' } }
    await run()
    expect(s.notified).toHaveLength(1)
    expect(s.notified[0].userId).toBe(EXPERT)
    // Имя в письме — клиента, а не получателя.
    expect(s.notified[0].data.userName).toContain('Иван')
    expect(s.inApp[0]).toMatchObject({ userId: EXPERT, link: `/super-expert/cases?case=${CASE}` })
    expect(s.adminNotified).toBe(1)
  })

  it('без ответственного — кейс без назначения и без личного уведомления', async () => {
    s.single = {}
    await run()
    expect(posted[0].assignee_id).toBeUndefined()
    expect(posted[0].sla_due_at).toBeTruthy()
    expect(s.notified).toHaveLength(0)
    expect(s.adminNotified).toBe(1)
  })
})

describe('PATCH /api/giga-admin/cases/:id', () => {
  const patch = async (body: unknown) => {
    const route = await import('@/app/api/giga-admin/cases/[id]/route')
    return route.PATCH(new NextRequest(`http://localhost/api/giga-admin/cases/${CASE}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: { id: CASE } })
  }
  const openCase = { id: CASE, user_id: CLIENT, status: 'new', priority: 'medium', title: 'Кейс', trigger_type: 'manual', user_message: null, assignee_id: null, sla_due_at: null, first_response_at: null, created_at: '2026-09-24T00:00:00.000Z' }

  it('смена приоритета пересчитывает срок от момента создания', async () => {
    s.single = { expert_cases: openCase }
    const res = await patch({ priority: 'critical' })
    expect(res.status).toBe(200)
    const upd = s.updates.find((u) => u.table === 'expert_cases')!
    expect(upd.patch.sla_due_at).toBe('2026-09-24T01:00:00.000Z')
    expect(s.audits[0]).toMatchObject({ action: 'case.updated', targetUserId: CLIENT })
  })

  it('взятие в работу фиксирует первую реакцию', async () => {
    s.single = { expert_cases: openCase }
    await patch({ status: 'in_progress' })
    const upd = s.updates.find((u) => u.table === 'expert_cases')!
    expect(upd.patch.first_response_at).toBeTruthy()
  })

  it('назначение уведомляет нового ответственного', async () => {
    s.single = { expert_cases: openCase, staff_roles: { user_id: EXPERT, role: 'super_expert' }, profiles: { full_name: 'Иван', email: 'client@x.io' } }
    await patch({ assigneeId: EXPERT })
    expect(s.audits[0].action).toBe('case.assigned')
    expect(s.notified.map((n) => n.userId)).toEqual([EXPERT])
  })

  it('эксперт со скоупом «только назначенные» не трогает чужого клиента', async () => {
    s.role = 'super_expert'
    s.single = { expert_cases: openCase, staff_roles: { client_scope: 'assigned' } }
    s.lists = { user_assignments: [] }
    const res = await patch({ status: 'in_progress' })
    expect(res.status).toBe(403)
    expect(s.updates).toHaveLength(0)
  })

  it('роль без доступа к личным данным — 403', async () => {
    s.role = 'analyst'
    expect((await patch({ status: 'closed' })).status).toBe(403)
  })
})

describe('PUT /api/giga-admin/staff/:userId/scope', () => {
  const put = async (body: unknown, userId = EXPERT) => {
    const route = await import('@/app/api/giga-admin/staff/[userId]/scope/route')
    return route.PUT(new NextRequest(`http://localhost/api/giga-admin/staff/${userId}/scope`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: { userId } })
  }

  it('experts.manage — только у Super Admin и Admin', () => {
    const holders = (['super_admin', 'admin', 'super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'] as StaffRole[]).filter((r) => hasPermission(r, 'experts.manage'))
    expect(holders).toEqual(['super_admin', 'admin'])
  })

  it('crm_manager получает 403 до обращения к базе', async () => {
    for (const role of ['crm_manager', 'super_expert', 'support']) {
      s.role = role
      expect((await put({ scope: 'assigned' })).status, role).toBe(403)
    }
    expect(s.dbTouched).toBe(0)
  })

  it('admin переключает видимость эксперта и это пишется в журнал', async () => {
    s.single = { staff_roles: { user_id: EXPERT, role: 'super_expert', client_scope: 'all' } }
    const res = await put({ scope: 'assigned' })
    expect(res.status).toBe(200)
    expect(s.updates[0]).toMatchObject({ table: 'staff_roles', patch: expect.objectContaining({ client_scope: 'assigned' }) })
    expect(s.audits[0]).toMatchObject({ action: 'staff.scope_changed', oldValue: { client_scope: 'all' }, newValue: { client_scope: 'assigned' } })
  })

  it('admin не меняет видимость равному или старшему', async () => {
    s.targetStaffRole = 'admin'
    expect(canManageTarget('admin', 'admin')).toBe(false)
    expect((await put({ scope: 'assigned' })).status).toBe(403)
    expect(s.updates).toHaveLength(0)
  })

  it('неверное значение — 400', async () => {
    expect((await put({ scope: 'some' })).status).toBe(400)
  })
})
