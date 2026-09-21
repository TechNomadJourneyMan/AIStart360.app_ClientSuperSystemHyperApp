/**
 * Правка данных компании клиента: право, подпись в журнале и создание
 * компании там, где её ещё не было.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const s = vi.hoisted(() => ({
  role: 'super_expert' as string,
  company: null as Record<string, unknown> | null,
  audits: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: 'se-1', kind: 'session', role: s.role as StaffRole, email: 'se@aistart360.app' })),
    staffRoleOfUser: async () => ({ staffRole: null, profileRole: 'client', status: 'approved', email: 'c@x.io' }),
  }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, e: Record<string, unknown>) => { s.audits.push(e); return true },
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === 'companies' ? s.company : { full_name: 'Иван' }, error: null }) }),
      }),
      update: (patch: Record<string, unknown>) => {
        s.updates.push({ table, patch })
        return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { ...s.company, ...patch }, error: null }) }) }) }
      },
      insert: (row: Record<string, unknown>) => {
        s.inserts.push({ table, row })
        return { select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }
      },
    }),
  }),
}))

const { PATCH } = await import('@/app/api/giga-admin/users/[id]/company/route')

const UID = '11111111-2222-3333-4444-555555555555'
const patch = (body: unknown) => PATCH(
  new NextRequest(`http://localhost/api/giga-admin/users/${UID}/company`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }),
  { params: { id: UID } },
)

beforeEach(() => {
  s.role = 'super_expert'
  s.company = { id: 'c-1', name: 'Старое имя', industry: null, regions: [] }
  s.audits = []
  s.updates = []
  s.inserts = []
})

describe('PATCH /api/giga-admin/users/:id/company', () => {
  it('SuperExpert сохраняет данные компании', async () => {
    const res = await patch({ company: { name: 'ТОО «Береке»', industry: 'Телеком', employee_count: 25 } })
    expect(res.status).toBe(200)
    const upd = s.updates.find((u) => u.table === 'companies')
    expect(upd?.patch).toMatchObject({ name: 'ТОО «Береке»', industry: 'Телеком', employee_count: 25 })
  })

  it('каждая правка подписана в журнале и хранит «было»', async () => {
    await patch({ company: { industry: 'Ритейл' }, reason: 'Уточнили на созвоне' })
    expect(s.audits).toHaveLength(1)
    expect(s.audits[0].action).toBe('user.company_edited')
    expect(s.audits[0].targetUserId).toBe(UID)
    expect((s.audits[0].oldValue as { company: { name: string } }).company.name).toBe('Старое имя')
    expect((s.audits[0].metadata as { reason: string }).reason).toBe('Уточнили на созвоне')
  })

  it('создаёт компанию, если её ещё не было', async () => {
    s.company = null
    const res = await patch({ company: { name: 'Новая компания', industry: 'Услуги' } })
    expect(res.status).toBe(200)
    expect(s.inserts[0].row).toMatchObject({ name: 'Новая компания', user_id: UID })
  })

  it('не создаёт компанию без названия', async () => {
    s.company = null
    const res = await patch({ company: { industry: 'Услуги' } })
    expect(res.status).toBe(400)
    expect(s.inserts).toHaveLength(0)
  })

  it('пустая строка очищает поле, а не пишет пустоту', async () => {
    await patch({ company: { industry: '   ' } })
    expect(s.updates.find((u) => u.table === 'companies')?.patch.industry).toBeNull()
  })

  it('пустой запрос отклоняется', async () => {
    expect((await patch({})).status).toBe(400)
    expect(s.audits).toHaveLength(0)
  })

  it('требует право на данные компании', async () => {
    for (const role of ['analyst', 'support', 'content_manager']) {
      s.role = role
      expect((await patch({ company: { name: 'x' } })).status, role).toBe(403)
    }
    expect(s.updates).toHaveLength(0)
    expect(s.audits).toHaveLength(0)
  })
})
