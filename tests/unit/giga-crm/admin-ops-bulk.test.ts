/**
 * Массовые действия над пользователями (F-014): право на действие проверяется
 * до чтения данных, ранг — по каждому человеку, частичный успех виден в отчёте,
 * каждый успешный пункт — в журнале.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const s = vi.hoisted(() => ({
  role: 'admin' as string,
  actorId: '00000000-0000-4000-8000-00000000000a',
  profiles: [] as Array<{ id: string; role: string; status: string; tier: string | null }>,
  staff: [] as Array<{ user_id: string; role: string }>,
  failUpdate: new Set<string>(),
  updates: [] as Array<{ table: string; id: string; patch: Record<string, unknown> }>,
  bans: [] as string[],
  audits: [] as Array<Record<string, unknown>>,
  approvals: [] as Array<Record<string, unknown>>,
  dbTouched: 0,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: s.actorId, kind: 'session', role: s.role as StaffRole, email: 'staff@x.io' })) }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, e: Record<string, unknown>) => { s.audits.push(e); return true },
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/users/approval', () => ({
  applyApprovalDecision: async (input: Record<string, unknown>) => { s.approvals.push(input); return { affected: 1, profile: null, emailSent: false } },
}))
vi.mock('@/lib/admin/survey-reminders', () => ({
  remindSurveyBatch: async (ids: string[]) => ids.map((userId) => ({ userId, outcome: 'sent', message: 'отправлено' })),
}))

/** Цепочка запроса Supabase: фильтры копятся, результат — по await. */
function query(table: string) {
  const st: { op: string; patch?: Record<string, unknown>; eq: Record<string, unknown>; in: Record<string, unknown[]> } = { op: 'select', eq: {}, in: {} }
  const resolve = () => {
    if (st.op === 'update') {
      const id = String(st.eq.id ?? st.eq.user_id ?? st.eq.target_user_id ?? '')
      s.updates.push({ table, id, patch: st.patch ?? {} })
      if (s.failUpdate.has(id)) return { data: [], error: null }
      return { data: [{ id }], error: null }
    }
    if (st.op === 'upsert') return { data: null, error: null }
    if (table === 'profiles') return { data: s.profiles.filter((p) => !st.in.id || st.in.id.includes(p.id)), error: null }
    if (table === 'staff_roles') return { data: s.staff.filter((r) => !st.in.user_id || st.in.user_id.includes(r.user_id)), error: null }
    return { data: [], error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    update: (patch: Record<string, unknown>) => { st.op = 'update'; st.patch = patch; return q },
    upsert: () => { st.op = 'upsert'; return q },
    eq: (c: string, v: unknown) => { st.eq[c] = v; return q },
    is: () => q,
    in: (c: string, v: unknown[]) => { st.in[c] = v; return q },
    maybeSingle: async () => {
      if (table === 'staff_roles') return { data: s.staff.find((r) => r.user_id === st.eq.user_id) ?? null, error: null }
      return { data: null, error: null }
    },
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, bad),
  }
  return q
}
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    s.dbTouched++
    return {
      from: (t: string) => query(t),
      auth: { admin: { updateUserById: async (id: string) => { s.bans.push(id); return { error: null } } } },
    }
  },
}))

const bulk = await import('@/app/api/giga-admin/users/bulk/route')

const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const EXPERT = '33333333-3333-4333-8333-333333333333'
const ADMIN2 = '44444444-4444-4444-8444-444444444444'
const MISSING = '55555555-5555-4555-8555-555555555555'

const post = (body: unknown) =>
  bulk.POST(new NextRequest('http://localhost/api/giga-admin/users/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  s.role = 'admin'
  s.profiles = [
    { id: C1, role: 'client', status: 'pending_approval', tier: 'free' },
    { id: C2, role: 'client', status: 'approved', tier: 'free' },
    { id: EXPERT, role: 'client', status: 'approved', tier: null },
    { id: ADMIN2, role: 'admin', status: 'approved', tier: null },
  ]
  s.staff = [{ user_id: EXPERT, role: 'super_expert' }, { user_id: ADMIN2, role: 'admin' }]
  s.failUpdate = new Set()
  s.updates = []
  s.bans = []
  s.audits = []
  s.approvals = []
  s.dbTouched = 0
})

describe('POST /api/giga-admin/users/bulk — права на действие', () => {
  it('право проверяется до чтения данных', async () => {
    const cases: Array<[string, string]> = [
      ['analyst', 'approve'], ['support', 'block'], ['crm_manager', 'archive'], ['super_expert', 'set_tier'], ['content_manager', 'assign'],
    ]
    for (const [role, action] of cases) {
      s.role = role
      const res = await post({ action, ids: [C1], reason: 'проверка', tier: 'pro', assigneeId: null })
      expect(res.status, `${role} → ${action}`).toBe(403)
    }
    expect(s.dbTouched).toBe(0)
    expect(s.audits).toHaveLength(0)
  })

  it('не больше 200 за раз', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`)
    expect((await post({ action: 'set_tier', tier: 'pro', ids })).status).toBe(400)
  })

  it('архивация требует причину', async () => {
    expect((await post({ action: 'archive', ids: [C2] })).status).toBe(400)
  })
})

describe('POST /api/giga-admin/users/bulk — ранг и частичный успех', () => {
  it('блокировка: клиенты — да, сотрудник того же ранга — нет, отчёт по каждому', async () => {
    const res = await post({ action: 'block', ids: [C2, ADMIN2, MISSING] })
    expect(res.status).toBe(200)
    const body = await res.json()
    const byId = new Map(body.results.map((r: { id: string }) => [r.id, r]))
    expect(byId.get(C2)).toMatchObject({ ok: true })
    expect(byId.get(ADMIN2)).toMatchObject({ ok: false })
    expect((byId.get(ADMIN2) as { error: string }).error).toMatch(/прав/)
    expect(byId.get(MISSING)).toMatchObject({ ok: false, error: 'Пользователь не найден' })
    expect(body.done).toBe(1)
    expect(body.failed).toBe(2)
    expect(s.bans).toEqual([C2])
    expect(s.updates.some((u) => u.id === ADMIN2)).toBe(false)
  })

  it('crm_manager не трогает SuperExpert-а, но меняет тариф клиенту', async () => {
    s.role = 'crm_manager'
    const body = await (await post({ action: 'set_tier', tier: 'pro', ids: [C1, EXPERT] })).json()
    expect(body.results.find((r: { id: string }) => r.id === C1).ok).toBe(true)
    expect(body.results.find((r: { id: string }) => r.id === EXPERT).ok).toBe(false)
  })

  it('сбой записи у одного не мешает остальным', async () => {
    s.failUpdate = new Set([C1])
    const body = await (await post({ action: 'set_tier', tier: 'pro', ids: [C1, C2] })).json()
    expect(body.results.find((r: { id: string }) => r.id === C1)).toMatchObject({ ok: false, error: 'Тариф не изменён' })
    expect(body.results.find((r: { id: string }) => r.id === C2)).toMatchObject({ ok: true })
  })

  it('одобрение идёт через applyApprovalDecision и только для ожидающих', async () => {
    const body = await (await post({ action: 'approve', ids: [C1, C2] })).json()
    expect(s.approvals).toHaveLength(1)
    expect(s.approvals[0]).toMatchObject({ userId: C1, status: 'approved', approvedBy: s.actorId })
    // C2 уже одобрен — пропуск без ошибки.
    expect(body.results.find((r: { id: string }) => r.id === C2)).toMatchObject({ ok: true, skipped: true })
  })

  it('каждый успешный пункт — отдельная запись журнала + итог пачки', async () => {
    await post({ action: 'block', ids: [C1, C2] })
    const perItem = s.audits.filter((a) => a.action === 'user.blocked')
    expect(perItem.map((a) => a.targetUserId).sort()).toEqual([C1, C2].sort())
    expect(perItem.every((a) => (a.metadata as { bulk?: boolean }).bulk === true)).toBe(true)
    expect(s.audits.some((a) => a.action === 'user.bulk_action')).toBe(true)
  })

  it('нельзя заблокировать себя', async () => {
    s.profiles.push({ id: s.actorId, role: 'client', status: 'approved', tier: null })
    const body = await (await post({ action: 'block', ids: [s.actorId] })).json()
    expect(body.results[0]).toMatchObject({ ok: false })
    expect(s.bans).toHaveLength(0)
  })

  it('назначить можно только сотрудника', async () => {
    const res = await post({ action: 'assign', ids: [C1], assigneeId: C2 })
    expect(res.status).toBe(400)
    const ok = await (await post({ action: 'assign', ids: [C1], assigneeId: EXPERT })).json()
    expect(ok.results[0]).toMatchObject({ ok: true })
    expect(s.audits.some((a) => a.action === 'user.assigned' && a.targetUserId === C1)).toBe(true)
  })
})
