/**
 * Клиент видит только опубликованное:
 *  - GET /api/v1/expert-review — только status='published', только свои, без email;
 *  - RLS миграции 087: client_read_own и owner-read Точки Б с фильтрами;
 *  - экспертная Точка Б сохраняется неодобренной, одобряет только Admin/Super Admin.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { makeFakeDb, type FakeDb } from './_fake-db'

const UID = '11111111-2222-4333-8444-555555555555'
const OTHER = '22222222-2222-4333-8444-555555555555'
const ME = '99999999-8888-4777-8666-555555555555'
const DIAG = 'dddddddd-0000-4000-8000-000000000001'

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  role: 'super_expert' as string,
  db: null as unknown as FakeDb,
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.db }))
vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: ME, kind: 'session', role: state.role as StaffRole })),
    forbidTarget: async () => null,
  }
})
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => true }))

const clientApi = await import('@/app/api/v1/expert-review/route')
const pointB = await import('@/app/api/giga-admin/users/[id]/review/point-b/route')
const approve = await import('@/app/api/giga-admin/users/[id]/review/point-b/approve/route')

const c = (id: string, over: Record<string, unknown>) => ({
  id, client_id: UID, author_id: ME, author_title: null, block_key: null, text: id, status: 'published',
  review_id: null, published_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', ...over,
})

beforeEach(() => {
  state.user = { id: UID }
  state.role = 'super_expert'
  state.db = makeFakeDb({
    profiles: [{ id: ME, full_name: 'expert@staff.io' }],
    expert_reviews: [
      { id: 'r-pub', user_id: UID, author_id: ME, status: 'published', title: 'Разбор', summary: null, published_at: '2026-09-02T00:00:00Z' },
      { id: 'r-draft', user_id: UID, author_id: ME, status: 'draft', title: 'Секрет', summary: null, published_at: null },
    ],
    expert_comments: [
      c('pub-gri', { block_key: 'gri:team', review_id: 'r-pub' }),
      c('pub-general', {}),
      c('draft-1', { status: 'draft', published_at: null }),
      c('foreign', { client_id: OTHER }),
    ],
    diagnostics: [{ id: DIAG, user_id: UID, is_current: true }],
    point_b_versions: [],
  })
})

describe('GET /api/v1/expert-review', () => {
  it('отдаёт только опубликованное и только своё', async () => {
    const res = await clientApi.GET()
    expect(res.status).toBe(200)
    const { data } = await res.json()
    const ids = data.blocks.flatMap((b: { comments: Array<{ id: string }> }) => b.comments.map((x) => x.id))
    expect(ids.sort()).toEqual(['pub-general', 'pub-gri'])
    expect(data.reviews.map((r: { id: string }) => r.id)).toEqual(['r-pub'])
    expect(data.reviews[0].comments_count).toBe(1)
    // Блоки подписаны по-русски, «Общее» — первым.
    expect(data.blocks.map((b: { label: string }) => b.label)).toEqual(['Общее', 'GRI · Команда'])
    // Email автора клиенту не показывается.
    expect(JSON.stringify(data)).not.toContain('@')
    expect(data.blocks[0].comments[0].author_name).toBe('Эксперт AIStart360')
    // Запрос к БД фильтрует статус явно.
    expect(state.db.log.find((l) => l.table === 'expert_comments')!.filters).toContain('status=published')
  })

  it('без сессии — 401', async () => {
    state.user = null
    expect((await clientApi.GET()).status).toBe(401)
  })
})

describe('migration 087 RLS', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/087_expert_review_drafts.sql'), 'utf8')
  it('клиент читает только опубликованные комментарии', () => {
    expect(sql).toMatch(/CREATE POLICY "client_read_own" ON public\.expert_comments\s+FOR SELECT USING \(client_id = auth\.uid\(\) AND status = 'published'\)/)
  })
  it('клиент видит только одобренные версии Точки Б; по умолчанию не одобрена', () => {
    expect(sql).toMatch(/point_b_versions ALTER COLUMN is_approved SET DEFAULT false/)
    expect(sql).toMatch(/CREATE POLICY point_b_versions_owner_read[\s\S]*point_b_versions\.is_approved/)
  })
  it('шаблоны — только service_role', () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.expert_templates FROM anon, authenticated/)
  })
})

describe('экспертная Точка Б', () => {
  const req = (path: string, body: unknown) =>
    new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('сохраняется неодобренной, автор — отображаемое имя', async () => {
    const res = await pointB.POST(req(`/api/giga-admin/users/${UID}/review/point-b`, { expert_notes: 'Сместить фокус на удержание' }), { params: { id: UID } })
    expect(res.status).toBe(200)
    const row = state.db.tables.point_b_versions[0] as Record<string, unknown>
    expect(row).toMatchObject({ is_approved: false, diagnostic_id: DIAG, author_name: 'Эксперт AIStart360' })
  })

  it('SuperExpert одобрить не может, Admin — может', async () => {
    await pointB.POST(req(`/api/giga-admin/users/${UID}/review/point-b`, { expert_notes: 'Заметки' }), { params: { id: UID } })
    const versionId = (state.db.tables.point_b_versions[0] as { id: string }).id
    const call = () => approve.POST(req(`/api/giga-admin/users/${UID}/review/point-b/approve`, { versionId }), { params: { id: UID } })

    expect((await call()).status).toBe(403)
    expect((state.db.tables.point_b_versions[0] as Record<string, unknown>).is_approved).toBe(false)

    state.role = 'admin'
    expect((await call()).status).toBe(200)
    expect(state.db.tables.point_b_versions[0]).toMatchObject({ is_approved: true, approved_by: ME })
  })

  it('версию чужого клиента одобрить нельзя', async () => {
    state.role = 'super_admin'
    state.db.tables.diagnostics.push({ id: 'd-other', user_id: OTHER, is_current: true })
    state.db.tables.point_b_versions.push({ id: 'aaaaaaaa-0000-4000-8000-00000000000f', diagnostic_id: 'd-other', is_approved: false })
    const res = await approve.POST(req(`/api/giga-admin/users/${UID}/review/point-b/approve`, { versionId: 'aaaaaaaa-0000-4000-8000-00000000000f' }), { params: { id: UID } })
    expect(res.status).toBe(404)
  })
})
