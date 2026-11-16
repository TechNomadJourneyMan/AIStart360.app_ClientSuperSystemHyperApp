/**
 * R4 (решения PO 2026-11-16): бейджи меню ГИГА.
 *   N4B-1  «Заявки» — открытые заявки на оплату; красный, если хоть одна ждёт
 *          дольше срока ответа (4 ч);
 *   N4B-12 «Точка Б — на одобрении» — «Ждут план»: открытые задачи plan_prep в
 *          скоупе сотрудника.
 * GET /api/giga-admin/nav-badges отдаёт только счётчики, на которые у роли есть
 * право; сбой базы — счётчика нет, меню не падает.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const ME = '00000000-0000-4000-8000-0000000000aa'
const C1 = '00000000-0000-4000-8000-0000000000c1'
const C2 = '00000000-0000-4000-8000-0000000000c2'

const s = vi.hoisted(() => ({
  role: 'admin' as string,
  scope: { scope: 'all', clientIds: [] as string[] } as { scope: string; clientIds: string[] },
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  broken: new Set<string>(),
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: '00000000-0000-4000-8000-0000000000aa', kind: 'session', role: s.role as StaffRole })) }
})
vi.mock('@/lib/admin/actor-scope', () => ({ actorClientScope: async () => s.scope }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (k: string) => (k === 'request_sla_hours' ? 4 : undefined) }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from(table: string) {
      const filters: Array<(r: Record<string, unknown>) => boolean> = []
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q },
        is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q },
        then: (ok: (v: unknown) => unknown) => Promise.resolve(
          s.broken.has(table)
            ? { data: null, error: { message: `${table} down` } }
            : { data: (s.tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null },
        ).then(ok),
      })
      return q
    },
  }),
}))

const { GET } = await import('@/app/api/giga-admin/nav-badges/route')
const { workBadgeView } = await import('@/lib/admin/nav')

const H = 3_600_000
const ago = (h: number) => new Date(Date.now() - h * H).toISOString().replace('Z', '')
const call = async () => (await GET(new NextRequest('http://localhost/api/giga-admin/nav-badges'))).json()

beforeEach(() => {
  s.role = 'admin'
  s.scope = { scope: 'all', clientIds: [] }
  s.broken = new Set()
  s.tables = {
    admin_requests: [
      { id: 'r1', type: 'access', source: 'paywall', status: 'new', createdAt: ago(6), payload: { userId: C1 } },
      { id: 'r2', type: 'access', source: 'upgrade_modal', status: 'in_review', createdAt: ago(1), payload: { userId: C2 } },
      { id: 'r3', type: 'access', source: 'paywall', status: 'approved', createdAt: ago(50), payload: { userId: C2 } },
      { id: 'r4', type: 'registration', source: 'register', status: 'new', createdAt: ago(90), payload: { userId: C2 } },
    ],
    expert_sla_tasks: [
      { source: 'plan_prep', client_id: C1, assignee_id: null, answer_due_at: new Date(Date.now() - H).toISOString(), closed_at: null },
      { source: 'plan_prep', client_id: C2, assignee_id: ME, answer_due_at: new Date(Date.now() + 9 * H).toISOString(), closed_at: null },
      { source: 'plan_prep', client_id: C2, assignee_id: null, answer_due_at: new Date(Date.now() - H).toISOString(), closed_at: new Date().toISOString() },
      { source: 'case', client_id: C1, assignee_id: null, answer_due_at: new Date(Date.now() - H).toISOString(), closed_at: null },
    ],
  }
})

describe('GET /api/giga-admin/nav-badges', () => {
  it('Admin: open paid-access requests (registrations and closed ones aside), how many are past 4 h; clients waiting for a plan', async () => {
    expect(await call()).toEqual({
      ok: true,
      accessRequests: { open: 2, overdue: 1, slaHours: 4 },
      // R4 B3: requests for an invitation share the «Заявки» badge (none here: r4 is a registration).
      inviteRequests: { open: 0 },
      planWaiting: { open: 2, overdue: 1 },
    })
  })

  it('«Ждут план» follows the client scope of the actor («свои клиенты»)', async () => {
    s.scope = { scope: 'assigned', clientIds: [C2] }
    expect((await call()).planWaiting).toEqual({ open: 1, overdue: 0 })
  })

  it('a role without clients.review gets no plan badge; without users.view no requests badge', async () => {
    s.role = 'analyst' // users.view, no clients.review
    const a = await call()
    expect(a.accessRequests).toBeDefined()
    expect(a.planWaiting).toBeUndefined()
    s.role = 'content_manager' // neither
    const c = await call()
    expect(c).toEqual({ ok: true })
  })

  it('a database failure hides that badge only', async () => {
    s.broken.add('admin_requests')
    const body = await call()
    expect(body.accessRequests).toBeUndefined()
    expect(body.planWaiting).toEqual({ open: 2, overdue: 1 })
  })
})

describe('workBadgeView (GigaSidebar)', () => {
  it('requests: the count, red when one waits past the deadline, with a readable title', () => {
    expect(workBadgeView('accessRequests', { accessRequests: { open: 3, overdue: 1, slaHours: 4 } })).toEqual({ count: 3, urgent: true, title: 'Заявки на оплату: 3, ждут дольше 4 ч: 1' })
    expect(workBadgeView('accessRequests', { accessRequests: { open: 2, overdue: 0, slaHours: 4 } })).toEqual({ count: 2, urgent: false, title: 'Заявки на оплату: 2' })
    expect(workBadgeView('accessRequests', { accessRequests: { open: 0, overdue: 0, slaHours: 4 } })).toBeNull()
  })

  it('plan: «Ждут план Точки Б»; nothing without data; other badges are not work badges', () => {
    expect(workBadgeView('planWaiting', { planWaiting: { open: 1, overdue: 0 } })).toEqual({ count: 1, urgent: false, title: 'Ждут план Точки Б: 1' })
    expect(workBadgeView('planWaiting', null)).toBeNull()
    expect(workBadgeView('cases', { accessRequests: { open: 5, overdue: 5, slaHours: 4 } })).toBeNull()
  })
})
