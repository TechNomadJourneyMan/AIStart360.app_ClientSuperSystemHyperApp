/**
 * Фильтр мата в роутах GIGA-CRM: названия и тексты сотрудников с матом не
 * сохраняются (400 с понятной ошибкой и именем поля), чистые — сохраняются.
 * Ничего не пишется в базу при отказе.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { fakeClient, newFakeDb, type FakeDb } from '../giga-admin/_fake-supabase'

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  audits: [] as Array<Record<string, unknown>>,
  addNote: vi.fn(),
  createTask: vi.fn(),
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'session', role: 'super_admin' as StaffRole, email: 'a@x.io' })),
    staffRoleOfUser: async () => ({ staffRole: null, profileRole: 'client', status: 'approved', email: 'c@x.io' }),
  }
})
vi.mock('@/lib/admin/client-scope', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/client-scope')>()),
  guardClientAccess: async () => null,
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    const c = fakeClient(h.db) as unknown as { from: (t: string) => Record<string, unknown> }
    // cms insert(...).select(...).single()
    return {
      from: (t: string) => {
        const b = c.from(t)
        return Object.assign(b, { single: () => (b.maybeSingle as () => Promise<unknown>)() })
      },
    }
  },
}))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async (_a: unknown, e: Record<string, unknown>) => { h.audits.push(e); return true } }))
vi.mock('@/lib/admin/client-actions', () => ({ addClientNote: h.addNote, createClientTask: h.createTask }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: vi.fn() }))

const UID = '11111111-2222-4333-8444-555555555555'
const P = { params: { id: UID } }
const BAD = 'Это полная хуйня'
const req = (path: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const json = async (res: Response) => ({ status: res.status, body: await res.json() })

const company = await import('@/app/api/giga-admin/users/[id]/company/route')
const notes = await import('@/app/api/giga-admin/users/[id]/notes/route')
const tasks = await import('@/app/api/giga-admin/users/[id]/tasks/route')
const paComments = await import('@/app/api/giga-admin/users/[id]/point-a/v4/comments/route')
const cms = await import('@/app/api/giga-admin/content/pages/route')

beforeEach(() => {
  h.db = newFakeDb()
  h.db.tables = {
    companies: [{ id: 'co-1', user_id: UID, name: 'Старое имя' }],
    profiles: [{ id: UID, full_name: 'Иван' }, { id: 'aaaaaaaa-0000-4000-8000-000000000001', full_name: 'Анна Эксперт', email: 'a@x.io' }],
  }
  h.audits = []
  h.addNote.mockReset().mockResolvedValue({ ok: true, note: { id: 'n-1' } })
  h.createTask.mockReset().mockResolvedValue({ ok: true, task: { id: 't-1' } })
})

describe('PATCH /api/giga-admin/users/:id/company (имя, компания)', () => {
  it('мат в названии компании → 400, поле company.name, без записи и журнала', async () => {
    const { status, body } = await json(await company.PATCH(req(`/api/giga-admin/users/${UID}/company`, 'PATCH', { company: { name: BAD } }), P))
    expect(status).toBe(400)
    expect(body).toMatchObject({ ok: false, code: 'profanity', field: 'company.name', error: 'Уберите нецензурные слова — такой текст сохранить нельзя.' })
    expect(h.db.writes).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
  })

  it('мат в ФИО контакта → поле profile.full_name', async () => {
    const { status, body } = await json(await company.PATCH(req(`/api/giga-admin/users/${UID}/company`, 'PATCH', { profile: { full_name: 'Иван бля' } }), P))
    expect(status).toBe(400)
    expect(body.field).toBe('profile.full_name')
  })

  it('чистые данные сохраняются', async () => {
    const res = await company.PATCH(req(`/api/giga-admin/users/${UID}/company`, 'PATCH', { company: { name: 'ТОО «Береке»' }, profile: { full_name: 'Иван Петров' } }), P)
    expect(res.status).toBe(200)
    expect(h.db.writes.map((w) => w.table)).toEqual(['companies', 'profiles'])
  })
})

describe('POST /api/giga-admin/users/:id/notes (заметки CRM)', () => {
  it('мат → 400 body, заметка не создаётся', async () => {
    const { status, body } = await json(await notes.POST(req(`/api/giga-admin/users/${UID}/notes`, 'POST', { body: BAD }), P))
    expect(status).toBe(400)
    expect(body.field).toBe('body')
    expect(h.addNote).not.toHaveBeenCalled()
  })

  it('чистая заметка → 200', async () => {
    const res = await notes.POST(req(`/api/giga-admin/users/${UID}/notes`, 'POST', { body: 'Созвонились, ждём отчёт' }), P)
    expect(res.status).toBe(200)
    expect(h.addNote).toHaveBeenCalledOnce()
  })
})

describe('POST /api/giga-admin/users/:id/tasks (задачи CRM)', () => {
  it('мат в названии задачи → 400 title', async () => {
    const { status, body } = await json(await tasks.POST(req(`/api/giga-admin/users/${UID}/tasks`, 'POST', { title: `Позвонить, ${BAD}` }), P))
    expect(status).toBe(400)
    expect(body.field).toBe('title')
    expect(h.createTask).not.toHaveBeenCalled()
  })

  it('чистая задача → 200', async () => {
    expect((await tasks.POST(req(`/api/giga-admin/users/${UID}/tasks`, 'POST', { title: 'Позвонить клиенту' }), P)).status).toBe(200)
  })
})

describe('POST /api/giga-admin/users/:id/point-a/v4/comments (комментарии эксперта к Точке А)', () => {
  it('мат → 400 body, комментарий не пишется', async () => {
    const { status, body } = await json(await paComments.POST(req(`/api/giga-admin/users/${UID}/point-a/v4/comments`, 'POST', { targetKind: 'overall', body: BAD }), P))
    expect(status).toBe(400)
    expect(body.field).toBe('body')
    expect(h.db.writes.filter((w) => w.table === 'point_a_comments')).toHaveLength(0)
  })

  it('чистый комментарий → 200 и запись', async () => {
    const res = await paComments.POST(req(`/api/giga-admin/users/${UID}/point-a/v4/comments`, 'POST', { targetKind: 'overall', body: 'Хорошая динамика' }), P)
    expect(res.status).toBe(200)
    expect(h.db.writes.find((w) => w.table === 'point_a_comments')?.op).toBe('insert')
  })
})

describe('POST /api/giga-admin/content/pages (заголовок CMS)', () => {
  it('мат в заголовке → 400 title', async () => {
    const { status, body } = await json(await cms.POST(req('/api/giga-admin/content/pages', 'POST', { title: BAD })))
    expect(status).toBe(400)
    expect(body.field).toBe('title')
    expect(h.db.writes).toHaveLength(0)
  })

  it('чистый заголовок → 200', async () => {
    const res = await cms.POST(req('/api/giga-admin/content/pages', 'POST', { title: 'Как читать Точку А' }))
    expect(res.status).toBe(200)
    expect(h.db.writes.find((w) => w.table === 'cms_pages')?.op).toBe('insert')
  })
})
