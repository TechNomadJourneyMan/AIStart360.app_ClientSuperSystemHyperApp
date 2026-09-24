/**
 * Блокировка / архивация пользователя (F-003):
 *  - журнал пишется ДО изменения, с ролью и email сотрудника (recordAdminAction);
 *  - если статус не записался — компенсирующая запись *_failed и понятный текст;
 *  - блокировка требует причину.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const UID = '11111111-2222-3333-4444-555555555555'
const ME = '99999999-8888-4777-8666-555555555555'

const state = vi.hoisted(() => ({
  calls: [] as string[],
  audits: [] as Array<{ actor: { role?: string; email?: string }; action: string; metadata?: Record<string, unknown> }>,
  auditFails: false,
  updateError: null as null | { message: string },
  updateRows: 1,
  profile: { id: '', role: 'client', status: 'approved' } as { id: string; role: string; status: string },
  target: { staffRole: null as string | null, profileRole: 'client' as string | null, status: 'approved', email: 'c@x.io' },
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: ME, kind: 'session', role: 'super_admin' as StaffRole, email: 'boss@x.io' })),
    forbidTarget: async () => null,
    staffRoleOfUser: async () => state.target,
  }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (actor: { role?: string; email?: string }, e: { action: string; metadata?: Record<string, unknown> }, _req: unknown, opts?: { required?: boolean }) => {
    if (state.auditFails && opts?.required) throw new Error('Audit log unavailable — action refused')
    state.calls.push(`audit:${e.action}`)
    state.audits.push({ actor, action: e.action, metadata: e.metadata })
    return true
  },
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.profile }) }) }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => {
          const res = async () => {
            state.calls.push(`update:${table}:${String(patch.status ?? patch.end_reason ?? '')}`)
            if (table !== 'profiles') return { data: null, error: null }
            return state.updateError
              ? { data: null, error: state.updateError }
              : { data: Array.from({ length: state.updateRows }, () => ({ id: UID })), error: null }
          }
          return { select: res, is: res }
        },
      }),
    }),
    auth: { admin: { updateUserById: async (_id: string, a: { ban_duration: string }) => { state.calls.push(`ban:${a.ban_duration}`); return { error: null } } } },
  }),
}))

const block = await import('@/app/api/giga-admin/users/[id]/block/route')
const unblock = await import('@/app/api/giga-admin/users/[id]/unblock/route')
const archive = await import('@/app/api/giga-admin/users/[id]/archive/route')

const req = (path: string, body: unknown) =>
  new NextRequest(`http://localhost/api/giga-admin/users/${UID}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  state.calls = []
  state.audits = []
  state.auditFails = false
  state.updateError = null
  state.updateRows = 1
  state.profile = { id: UID, role: 'client', status: 'approved' }
  state.target = { staffRole: null, profileRole: 'client', status: 'approved', email: 'c@x.io' }
})

describe('block', () => {
  it('требует причину', async () => {
    const res = await block.POST(req('block', {}), { params: { id: UID } })
    expect(res.status).toBe(400)
    expect(state.calls).toEqual([])
  })

  it('журнал (с ролью и email сотрудника) → статус → бан', async () => {
    const res = await block.POST(req('block', { reason: 'спам в чатах' }), { params: { id: UID } })
    expect(res.status).toBe(200)
    expect(state.calls).toEqual(['audit:user.blocked', 'update:profiles:blocked', 'ban:87600h'])
    expect(state.audits[0].actor).toMatchObject({ role: 'super_admin', email: 'boss@x.io' })
    expect(state.audits[0].metadata).toMatchObject({ reason: 'спам в чатах' })
  })

  it('без журнала не блокирует', async () => {
    state.auditFails = true
    const res = await block.POST(req('block', { reason: 'спам в чатах' }), { params: { id: UID } })
    expect(res.status).toBe(503)
    expect(state.calls).toEqual([])
  })

  it('статус не записался → user.block_failed и понятный текст', async () => {
    state.updateError = { message: 'violates check constraint "profiles_status_check"' }
    const res = await block.POST(req('block', { reason: 'спам в чатах' }), { params: { id: UID } })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).not.toMatch(/миграц/i)
    expect(json.error).toMatch(/Не удалось изменить статус/)
    expect(state.calls).toEqual(['audit:user.blocked', 'update:profiles:blocked', 'audit:user.block_failed'])
  })

  it('super_admin не блокируется', async () => {
    state.profile = { id: UID, role: 'super_admin', status: 'approved' }
    const res = await block.POST(req('block', { reason: 'спам в чатах' }), { params: { id: UID } })
    expect(res.status).toBe(403)
    expect(state.calls).toEqual([])
  })
})

describe('unblock', () => {
  it('пишет журнал через recordAdminAction и снимает бан', async () => {
    state.profile = { id: UID, role: 'client', status: 'blocked' }
    const res = await unblock.POST(req('unblock', {}), { params: { id: UID } })
    expect(res.status).toBe(200)
    expect(state.calls).toEqual(['audit:user.unblocked', 'update:profiles:approved', 'ban:none'])
    expect(state.audits[0].actor).toMatchObject({ role: 'super_admin', email: 'boss@x.io' })
  })

  it('статус не записался → user.unblock_failed', async () => {
    state.profile = { id: UID, role: 'client', status: 'blocked' }
    state.updateRows = 0
    const res = await unblock.POST(req('unblock', {}), { params: { id: UID } })
    expect(res.status).toBe(409)
    expect(state.calls).toContain('audit:user.unblock_failed')
    expect(state.calls).not.toContain('ban:none')
  })
})

describe('archive', () => {
  it('архивирует: журнал → статус → бан → завершение имперсонаций', async () => {
    const res = await archive.POST(req('archive', { action: 'archive', reason: 'просьба клиента' }), { params: { id: UID } })
    expect(res.status).toBe(200)
    expect(state.calls).toEqual(['audit:user.archived', 'update:profiles:archived', 'ban:87600h', 'update:impersonation_sessions:user_archived'])
  })

  it('статус не записался → user.archive_failed, бан не ставится', async () => {
    state.updateError = { message: 'violates check constraint' }
    const res = await archive.POST(req('archive', { action: 'archive', reason: 'просьба клиента' }), { params: { id: UID } })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Не удалось изменить статус/)
    expect(state.calls).toEqual(['audit:user.archived', 'update:profiles:archived', 'audit:user.archive_failed'])
  })

  it('восстановление не записалось → user.restore_failed', async () => {
    state.target = { ...state.target, status: 'archived' }
    state.updateRows = 0
    const res = await archive.POST(req('archive', { action: 'restore', reason: 'ошибка оператора' }), { params: { id: UID } })
    expect(res.status).toBe(500)
    expect(state.calls).toEqual(['audit:user.restored', 'update:profiles:approved', 'audit:user.restore_failed'])
  })
})
