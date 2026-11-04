/**
 * Переименование пользователя (PATCH /api/giga-admin/users/:id/profile):
 * право users.manage, ранг цели, фильтр контента (422), журнал ДО изменения,
 * contact_name компании меняется только если там стояло старое имя.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const UID = '11111111-2222-4333-8444-555555555555'
const ME = '99999999-8888-4777-8666-555555555555'

const s = vi.hoisted(() => ({
  role: 'admin' as string,
  targetForbidden: false,
  profile: { id: '', full_name: 'Иван Петров' as string | null, email: 'ivan@x.io' } as { id: string; full_name: string | null; email: string } | null,
  seq: [] as string[],
  audits: [] as Array<Record<string, unknown>>,
  auditFails: false,
  updateFails: false,
  metadata: [] as Array<Record<string, unknown>>,
  companyFilter: null as null | Record<string, unknown>,
  touched: 0,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: ME, kind: 'session', role: s.role as StaffRole, email: 'staff@x.io' })),
    staffRoleOfUser: async () => ({ staffRole: null, profileRole: 'client', status: 'approved', email: 'ivan@x.io' }),
    forbidTarget: async () => s.targetForbidden
      ? NextResponse.json({ ok: false, error: 'Недостаточно прав для действий с этим сотрудником' }, { status: 403 })
      : null,
  }
})
vi.mock('@/lib/admin/client-scope', () => ({ guardClientAccess: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: async () => false }))
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, e: Record<string, unknown>, _req: unknown, opts?: { required?: boolean }) => {
    if (s.auditFails && opts?.required) throw new Error('Audit log unavailable — action refused')
    s.audits.push(e)
    s.seq.push(`audit:${e.action}`)
    return true
  },
}))
// Фильтр контента — настоящий; вокруг него только настройки и фоновые задачи.
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => true }))
vi.mock('@/lib/background', () => ({ runInBackground: async () => undefined }))

function table(name: string) {
  const st: { op: string; patch?: Record<string, unknown>; eq: Record<string, unknown> } = { op: 'select', eq: {} }
  const resolve = () => {
    if (name === 'content_filter_terms') return { data: [], error: null }
    if (st.op === 'update' && name === 'profiles') {
      s.seq.push('update:profiles')
      if (s.updateFails) return { data: [], error: null }
      return { data: [{ id: st.eq.id }], error: null }
    }
    if (st.op === 'update' && name === 'companies') {
      s.seq.push('update:companies')
      s.companyFilter = { ...st.eq, patch: st.patch }
      return { data: null, error: null }
    }
    return { data: [], error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    update: (patch: Record<string, unknown>) => { st.op = 'update'; st.patch = patch; return q },
    eq: (c: string, v: unknown) => { st.eq[c] = v; return q },
    limit: () => q,
    maybeSingle: async () => ({ data: name === 'profiles' ? s.profile : null, error: null }),
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, bad),
  }
  return q
}
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    s.touched++
    return {
      from: (t: string) => table(t),
      auth: { admin: { updateUserById: async (_id: string, attrs: { user_metadata?: Record<string, unknown> }) => { s.seq.push('auth:metadata'); s.metadata.push(attrs.user_metadata ?? {}); return { error: null } } } },
    }
  },
}))

const route = await import('@/app/api/giga-admin/users/[id]/profile/route')
const patch = (body: unknown, id = UID) =>
  route.PATCH(new NextRequest(`http://localhost/api/giga-admin/users/${id}/profile`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: { id } })

beforeEach(() => {
  s.role = 'admin'
  s.targetForbidden = false
  s.profile = { id: UID, full_name: 'Иван Петров', email: 'ivan@x.io' }
  s.seq = []
  s.audits = []
  s.auditFails = false
  s.updateFails = false
  s.metadata = []
  s.companyFilter = null
  s.touched = 0
})

describe('PATCH /api/giga-admin/users/:id/profile — переименование', () => {
  it('меняет имя: журнал → профиль → Auth → контакт компании (только со старым именем)', async () => {
    const res = await patch({ full_name: '  Иван   Сидоров ', reason: 'опечатка' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, full_name: 'Иван Сидоров' })
    expect(s.seq).toEqual(['audit:user.renamed', 'update:profiles', 'auth:metadata', 'update:companies'])
    expect(s.audits[0]).toMatchObject({
      action: 'user.renamed', targetUserId: UID,
      oldValue: { full_name: 'Иван Петров' }, newValue: { full_name: 'Иван Сидоров' }, metadata: { reason: 'опечатка' },
    })
    expect(s.metadata[0]).toEqual({ full_name: 'Иван Сидоров' })
    expect(s.companyFilter).toMatchObject({ user_id: UID, contact_name: 'Иван Петров', patch: { contact_name: 'Иван Сидоров' } })
  })

  it('мат в имени — 422, ничего не записано', async () => {
    const res = await patch({ full_name: 'Иван Хуйня' })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ ok: false, code: 'CONTENT_REJECTED' })
    expect(s.audits).toHaveLength(0)
    expect(s.seq.filter((x) => x.startsWith('update:'))).toEqual([])
  })

  it('без права users.manage — 403 до чтения данных', async () => {
    for (const role of ['super_expert', 'content_manager', 'analyst', 'support']) {
      s.role = role
      expect((await patch({ full_name: 'Новое Имя' })).status, role).toBe(403)
    }
    expect(s.touched).toBe(0)
    expect(s.audits).toHaveLength(0)
  })

  it('CRM-менеджер может, но не переименует старшего сотрудника', async () => {
    s.role = 'crm_manager'
    expect((await patch({ full_name: 'Новое Имя' })).status).toBe(200)
    s.targetForbidden = true
    s.seq = []
    expect((await patch({ full_name: 'Другое Имя' })).status).toBe(403)
    expect(s.seq).toEqual([])
  })

  it('без записи в журнал имя не меняется (503)', async () => {
    s.auditFails = true
    expect((await patch({ full_name: 'Новое Имя' })).status).toBe(503)
    expect(s.seq).toEqual([])
  })

  it('слишком короткое имя — 400; то же имя — без изменений и без журнала', async () => {
    expect((await patch({ full_name: ' я ' })).status).toBe(400)
    const same = await patch({ full_name: 'Иван  Петров' })
    expect(await same.json()).toMatchObject({ ok: true, unchanged: true })
    expect(s.audits).toHaveLength(0)
  })

  it('сбой записи профиля — 409 и компенсирующая запись в журнале', async () => {
    s.updateFails = true
    expect((await patch({ full_name: 'Новое Имя' })).status).toBe(409)
    expect(s.seq).toEqual(['audit:user.renamed', 'update:profiles', 'audit:user.rename_failed'])
  })

  it('пустое старое имя — контакт компании не трогаем', async () => {
    s.profile = { id: UID, full_name: null, email: 'ivan@x.io' }
    expect((await patch({ full_name: 'Новое Имя' })).status).toBe(200)
    expect(s.seq).not.toContain('update:companies')
  })
})
