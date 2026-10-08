/**
 * Публикация разбора эксперта (POST /api/giga-admin/users/:id/review/publish):
 * все черновики клиента → опубликованы одним действием, ровно ОДНО письмо,
 * ОДНО уведомление и одна запись в журнале.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { makeFakeDb, type FakeDb } from './_fake-db'

const UID = '11111111-2222-4333-8444-555555555555'
const OTHER = '22222222-2222-4333-8444-555555555555'
const ME = '99999999-8888-4777-8666-555555555555'
const REVIEW = 'aaaaaaaa-0000-4000-8000-000000000001'

const state = vi.hoisted(() => ({
  role: 'super_expert' as string,
  db: null as unknown as FakeDb,
  emails: [] as Array<{ to: string; input: Record<string, unknown> }>,
  notifications: [] as Array<Record<string, unknown>>,
  audit: [] as Array<{ action: string; metadata?: Record<string, unknown> }>,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: ME, kind: 'session', role: state.role as StaffRole })),
    forbidTarget: async () => null,
  }
})
vi.mock('@/lib/admin/audit', () => ({
  recordAdminAction: async (_a: unknown, e: { action: string; metadata?: Record<string, unknown> }) => {
    state.audit.push(e)
    return true
  },
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.db }))
vi.mock('@/lib/email/notify', () => ({
  sendExpertReviewPublishedEmail: async (to: string, input: Record<string, unknown>) => {
    state.emails.push({ to, input })
    return { ok: true }
  },
}))
vi.mock('@/lib/notifications/create', () => ({
  createNotification: async (n: Record<string, unknown>) => { state.notifications.push(n) },
}))

const route = await import('@/app/api/giga-admin/users/[id]/review/publish/route')
const publish = (body: unknown = {}) =>
  route.POST(
    new NextRequest(`http://localhost/api/giga-admin/users/${UID}/review/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    { params: { id: UID } },
  )

const comment = (id: string, over: Record<string, unknown> = {}) => ({
  id, client_id: UID, author_id: ME, author_title: null, block_key: 'gri:team', text: `Текст ${id}`,
  status: 'draft', source: 'expert', ai_flags: null, review_id: REVIEW, published_at: null,
  created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z', ...over,
})

beforeEach(() => {
  state.role = 'super_expert'
  state.emails = []
  state.notifications = []
  state.audit = []
  state.db = makeFakeDb({
    profiles: [
      { id: ME, full_name: 'Анна Эксперт', email: 'anna@staff.io' },
      { id: UID, full_name: 'Иван Клиент', email: 'client@x.io' },
    ],
    expert_reviews: [{ id: REVIEW, user_id: UID, author_id: ME, status: 'draft', title: 'Разбор сентября', summary: null, published_at: null }],
    expert_comments: [
      comment('c1'),
      comment('c2', { block_key: null }),
      comment('c3', { block_key: 'point-a', source: 'ai', ai_flags: [{ category: 'hallucination', severity: 'warning', note: 'x' }] }),
      comment('old', { status: 'published', published_at: '2026-01-01T00:00:00Z', review_id: null }),
      comment('foreign', { client_id: OTHER }),
    ],
  })
})

const rows = () => state.db.tables.expert_comments as Array<Record<string, unknown>>

describe('publish expert review', () => {
  it('черновики → опубликованы, одно письмо, одно уведомление, аудит', async () => {
    const res = await publish({ expectedCount: 3 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ reviewId: REVIEW, published: 3 })

    for (const id of ['c1', 'c2', 'c3']) {
      const r = rows().find((c) => c.id === id)!
      expect(r.status).toBe('published')
      expect(r.review_id).toBe(REVIEW)
      expect(r.published_at).toBeTruthy()
    }
    // Чужой черновик не тронут.
    expect(rows().find((c) => c.id === 'foreign')!.status).toBe('draft')
    expect((state.db.tables.expert_reviews[0] as Record<string, unknown>).status).toBe('published')

    expect(state.emails).toHaveLength(1)
    expect(state.emails[0].to).toBe('client@x.io')
    expect(state.emails[0].input).toMatchObject({ commentsCount: 3, reviewId: REVIEW, expertName: 'Анна Эксперт' })
    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0]).toMatchObject({ userId: UID, title: 'Эксперт подготовил разбор', link: '/client/home#expert' })
    expect(state.audit.map((a) => a.action)).toEqual(['expert.review_published'])
    expect(state.audit[0].metadata).toMatchObject({ comments: 3, aiComments: 1 })
  })

  it('повторная публикация ничего не шлёт', async () => {
    await publish()
    const again = await publish()
    expect(again.status).toBe(400)
    expect(state.emails).toHaveLength(1)
    expect(state.notifications).toHaveLength(1)
  })

  it('черновик изменился после подтверждения → 409, ничего не опубликовано', async () => {
    const res = await publish({ expectedCount: 2 })
    expect(res.status).toBe(409)
    expect(rows().filter((c) => c.status === 'draft')).toHaveLength(4)
    expect(state.emails).toHaveLength(0)
    expect(state.notifications).toHaveLength(0)
  })

  it('ИИ-комментарий с ошибкой проверки блокирует публикацию', async () => {
    rows().find((c) => c.id === 'c3')!.ai_flags = [{ category: 'unsafe_recommendation', severity: 'error', note: 'Гарантия' }]
    const res = await publish()
    expect(res.status).toBe(409)
    expect(state.emails).toHaveLength(0)
  })

  it('пустой черновик не публикуется', async () => {
    state.db.tables.expert_comments = []
    expect((await publish()).status).toBe(400)
    expect(state.emails).toHaveLength(0)
  })

  it('имя эксперта в письме — не email', async () => {
    ;(state.db.tables.profiles[0] as Record<string, unknown>).full_name = 'anna@staff.io'
    await publish()
    expect(state.emails[0].input.expertName).toBe('Эксперт AIStart360')
  })

  it('Поддержка (support) публиковать не может', async () => {
    state.role = 'support'
    expect((await publish()).status).toBe(403)
    expect(rows().filter((c) => c.status === 'draft')).toHaveLength(4)
  })
})
