/**
 * Полное удаление пользователя (POST /api/giga-admin/users/:id/purge):
 * только Super Admin, подтверждение email, запись в журнал ДО удаления,
 * файлы Storage стираются после успешной транзакции.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const UID = '11111111-2222-3333-4444-555555555555'
const ME = '99999999-8888-4777-8666-555555555555'

const state = vi.hoisted(() => ({
  role: 'super_admin' as string,
  target: { staffRole: null as string | null, profileRole: 'client' as string | null, status: 'approved', email: 'Client@X.io' },
  calls: [] as string[],
  auditFails: false,
  rpcError: null as null | { message: string },
  removed: [] as Array<{ bucket: string; names: string[] }>,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: ME, kind: 'session', role: state.role as StaffRole })),
    staffRoleOfUser: async () => state.target,
  }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, e: { action: string }) => {
    if (state.auditFails) throw new Error('Audit log unavailable — action refused')
    state.calls.push(`audit:${e.action}`)
    return true
  },
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    rpc: async (_fn: string, args: { p_dry_run: boolean }) => {
      state.calls.push(args.p_dry_run ? 'rpc:preview' : 'rpc:purge')
      if (state.rpcError && !args.p_dry_run) return { data: null, error: state.rpcError }
      return {
        data: {
          found: true,
          counts: { companies: 1, documents: 2, files: 2 },
          storage: [{ bucket: 'client-documents', name: `${UID}/a.pdf` }, { bucket: 'documents', name: `${UID}/b.xlsx` }],
        },
        error: null,
      }
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: 'Клиент' } }) }) }) }),
    storage: {
      from: (bucket: string) => ({
        remove: async (names: string[]) => { state.calls.push(`storage:${bucket}`); state.removed.push({ bucket, names }); return { error: null } },
      }),
    },
  }),
}))

const route = await import('@/app/api/giga-admin/users/[id]/purge/route')
const post = (body: unknown, id = UID) =>
  route.POST(new NextRequest(`http://localhost/api/giga-admin/users/${id}/purge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: { id } })

beforeEach(() => {
  state.role = 'super_admin'
  state.target = { staffRole: null, profileRole: 'client', status: 'approved', email: 'Client@X.io' }
  state.calls = []
  state.auditFails = false
  state.rpcError = null
  state.removed = []
})

describe('purge user', () => {
  it('удаляет: журнал → транзакция → файлы', async () => {
    const res = await post({ confirmEmail: 'client@x.io', reason: 'просьба клиента' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, filesFailed: 0 })
    expect(state.calls).toEqual(['rpc:preview', 'audit:user.purged', 'rpc:purge', 'storage:client-documents', 'storage:documents'])
  })

  it('отказывает, если email не совпал', async () => {
    const res = await post({ confirmEmail: 'other@x.io', reason: 'просьба клиента' })
    expect(res.status).toBe(400)
    expect(state.calls).toEqual([])
  })

  it('не удаляет Super Admin и самого себя', async () => {
    state.target = { ...state.target, profileRole: 'super_admin' }
    expect((await post({ confirmEmail: 'client@x.io', reason: 'тест' })).status).toBe(403)
    state.target = { ...state.target, profileRole: 'client', staffRole: 'super_admin' }
    expect((await post({ confirmEmail: 'client@x.io', reason: 'тест' })).status).toBe(403)
    expect((await post({ confirmEmail: 'client@x.io', reason: 'тест' }, ME)).status).toBe(400)
    expect(state.calls).toEqual([])
  })

  it('без записи в журнал удаления нет', async () => {
    state.auditFails = true
    await expect(post({ confirmEmail: 'client@x.io', reason: 'тест' })).rejects.toThrow(/Audit/)
    expect(state.calls).toEqual(['rpc:preview'])
  })

  it('ошибка транзакции — файлы не трогаем', async () => {
    state.rpcError = { message: 'boom' }
    const res = await post({ confirmEmail: 'client@x.io', reason: 'тест' })
    expect(res.status).toBe(500)
    expect(state.removed).toEqual([])
    // Compensating journal entry: the append-only log must not claim a purge that failed.
    expect(state.calls).toContain('audit:user.purge_failed')
  })

  it('Admin (не Super Admin) удалять не может', async () => {
    state.role = 'admin'
    expect((await post({ confirmEmail: 'client@x.io', reason: 'тест' })).status).toBe(403)
    expect(state.calls).toEqual([])
  })
})
