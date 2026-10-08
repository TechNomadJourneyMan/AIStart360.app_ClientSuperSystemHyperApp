/**
 * Лента клиента (F-015) и «Мои задачи» (F-013): порядок слияния, курсор без
 * потерь на стыке страниц, группировка правок анкеты; секции и фильтры сроков.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { fromSurveyHistory, fromTasks, mergeTimeline, type TimelineEntry } from '@/lib/admin/timeline'
import { dueBucket, dueRange, startOfLocalDay } from '@/lib/admin/tasks-due'

const e = (kind: TimelineEntry['kind'], id: string, at: string): TimelineEntry => ({ id, kind, at, title: id })

describe('mergeTimeline', () => {
  it('сливает источники по времени, новые сверху', () => {
    const { items, nextCursor } = mergeTimeline([
      [e('event', 'a', '2026-09-01T10:00:00Z'), e('event', 'b', '2026-09-03T10:00:00Z')],
      [e('note', 'c', '2026-09-02T10:00:00Z')],
      [e('audit', 'd', '2026-09-04T10:00:00Z')],
    ], { limit: 10 })
    expect(items.map((i) => i.id)).toEqual(['d', 'b', 'c', 'a'])
    expect(nextCursor).toBeNull()
  })

  it('режет страницу и отдаёт курсор; следующая страница продолжает без дублей', () => {
    const src = [
      [e('event', '1', '2026-09-05T00:00:00Z'), e('event', '2', '2026-09-04T00:00:00Z'), e('event', '3', '2026-09-03T00:00:00Z')],
      [e('email', '4', '2026-09-02T00:00:00Z'), e('email', '5', '2026-09-01T00:00:00Z')],
    ]
    const p1 = mergeTimeline(src, { limit: 2 })
    expect(p1.items.map((i) => i.id)).toEqual(['1', '2'])
    expect(p1.nextCursor).toBe('2026-09-04T00:00:00Z')
    const p2 = mergeTimeline(src, { limit: 2, cursor: p1.nextCursor })
    expect(p2.items.map((i) => i.id)).toEqual(['3', '4'])
    const p3 = mergeTimeline(src, { limit: 2, cursor: p2.nextCursor })
    expect(p3.items.map((i) => i.id)).toEqual(['5'])
    expect(p3.nextCursor).toBeNull()
  })

  it('события с одинаковым временем на стыке не теряются', () => {
    const t = '2026-09-02T00:00:00Z'
    const src = [[e('event', 'x', '2026-09-03T00:00:00Z'), e('event', 'y', t)], [e('audit', 'z', t)], [e('note', 'w', '2026-09-01T00:00:00Z')]]
    const p1 = mergeTimeline(src, { limit: 2 })
    expect(p1.items.map((i) => i.id).sort()).toEqual(['x', 'y', 'z'])
    const p2 = mergeTimeline(src, { limit: 2, cursor: p1.nextCursor })
    expect(p2.items.map((i) => i.id)).toEqual(['w'])
  })

  it('убирает дубликаты одного вида и id', () => {
    const { items } = mergeTimeline([[e('task', 't1', '2026-09-01T00:00:00Z')], [e('task', 't1', '2026-09-01T00:00:00Z')]], { limit: 10 })
    expect(items).toHaveLength(1)
  })
})

describe('нормализаторы ленты', () => {
  it('правки анкеты за день — одним пунктом с числом разных вопросов', () => {
    const items = fromSurveyHistory([
      { id: 1, question_key: 's1_a', source: 'user', created_at: '2026-09-01T08:00:00Z' },
      { id: 2, question_key: 's1_a', source: 'user', created_at: '2026-09-01T09:00:00Z' },
      { id: 3, question_key: 's2_b', source: 'admin', created_at: '2026-09-01T10:00:00Z' },
      { id: 4, question_key: 's3_c', source: 'user', created_at: '2026-09-02T10:00:00Z' },
    ])
    expect(items).toHaveLength(2)
    const d1 = items.find((i) => i.id === 'survey:2026-09-01')!
    expect(d1.title).toContain('2')
    expect(d1.at).toBe('2026-09-01T10:00:00Z')
    expect(d1.body).toContain('персоналом')
  })

  it('задача даёт «создана» и, если выполнена, «выполнена»', () => {
    const items = fromTasks([
      { id: 't', title: 'Позвонить', status: 'done', created_at: '2026-09-01T00:00:00Z', done_at: '2026-09-02T00:00:00Z' },
      { id: 'u', title: 'Письмо', status: 'open', created_at: '2026-09-01T00:00:00Z' },
    ])
    expect(items.map((i) => i.id)).toEqual(['t:created', 't:done', 'u:created'])
  })
})

describe('сроки задач', () => {
  const now = new Date('2026-09-24T10:00:00Z')

  it('секции: просрочено / сегодня / неделя / позже / без срока', () => {
    expect(dueBucket('2026-09-24T09:00:00Z', now)).toBe('overdue')
    expect(dueBucket('2026-09-24T20:00:00Z', now)).toBe('today')
    expect(dueBucket('2026-09-27T12:00:00Z', now)).toBe('week')
    expect(dueBucket('2026-10-20T12:00:00Z', now)).toBe('later')
    expect(dueBucket(null, now)).toBe('none')
  })

  it('«сегодня» считается в поясе сотрудника (Алматы, UTC+5)', () => {
    // 22:00 UTC 24-го — это уже 25-е в Алматы: не «сегодня», а «на неделе».
    expect(dueBucket('2026-09-24T22:00:00Z', now, -300)).toBe('week')
    expect(startOfLocalDay(now, -300).toISOString()).toBe('2026-09-23T19:00:00.000Z')
  })

  it('диапазоны фильтра API', () => {
    expect(dueRange('overdue', now)).toEqual({ from: null, to: now.toISOString() })
    expect(dueRange('today', now)).toEqual({ from: now.toISOString(), to: '2026-09-25T00:00:00.000Z' })
    expect(dueRange('week', now)).toEqual({ from: now.toISOString(), to: '2026-10-01T00:00:00.000Z' })
    expect(dueRange('none', now)).toBe('none')
  })
})

// ─── GET /api/giga-admin/tasks ─────────────────────────────────────────────
const t = vi.hoisted(() => ({ role: 'super_expert' as string, filters: [] as Array<[string, string, unknown]>, rows: [] as unknown[] }))
const ME = '00000000-0000-4000-8000-0000000000aa'
const OTHER = '00000000-0000-4000-8000-0000000000bb'

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: ME, kind: 'session', role: t.role as StaffRole })) }
})
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'is', 'gte', 'lt', 'in', 'order', 'limit']) {
        q[op] = (c?: string, v?: unknown) => { if (table === 'staff_tasks' && op !== 'select' && op !== 'order' && op !== 'limit') t.filters.push([op, String(c), v]); return q }
      }
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: table === 'staff_tasks' ? t.rows : [], error: null }).then(ok)
      return q
    },
  }),
}))

const tasksRoute = await import('@/app/api/giga-admin/tasks/route')
const get = (qs: string) => tasksRoute.GET(new NextRequest(`http://localhost/api/giga-admin/tasks?${qs}`))

describe('GET /api/giga-admin/tasks', () => {
  beforeEach(() => { t.role = 'super_expert'; t.filters = []; t.rows = [] })

  it('по умолчанию — мои открытые задачи', async () => {
    const res = await get('')
    expect(res.status).toBe(200)
    expect(t.filters).toContainEqual(['eq', 'assignee_id', ME])
    expect(t.filters).toContainEqual(['eq', 'status', 'open'])
  })

  it('фильтр срока превращается в границы due_at', async () => {
    await get('due=overdue')
    expect(t.filters.some(([op, c]) => op === 'lt' && c === 'due_at')).toBe(true)
    t.filters = []
    await get('due=none')
    expect(t.filters).toContainEqual(['is', 'due_at', null])
  })

  it('чужие задачи — только с правом experts.manage', async () => {
    expect((await get(`assignee=${OTHER}`)).status).toBe(403)
    t.role = 'admin'
    expect((await get(`assignee=${OTHER}`)).status).toBe(200)
    expect(t.filters).toContainEqual(['eq', 'assignee_id', OTHER])
  })

  it('неверные параметры — 400; роль без доступа к личным данным — 403', async () => {
    expect((await get('due=yesterday')).status).toBe(400)
    expect((await get('status=archived')).status).toBe(400)
    t.role = 'analyst'
    expect((await get('')).status).toBe(403)
  })
})
