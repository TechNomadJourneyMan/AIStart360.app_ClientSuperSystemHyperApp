/**
 * GET /api/v1/action-plan lazily builds the 90-day plan from the GRI assessment when the client has none.
 * Tasks written by a Point B plan (source 'point_b', Ф5) are not that plan: they must not block it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { pbDb } from './_pbdb'

const USER = 'cccccccc-0000-4000-8000-000000000001'

const s = vi.hoisted(() => ({ h: null as ReturnType<typeof import('./_pbdb').pbDb> | null }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => s.h!.sb }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: USER } } }) }, from: (t: string) => s.h!.sb.from(t) }),
}))

const route = await import('@/app/api/v1/action-plan/route')

const get = async () => {
  const r = await route.GET(new NextRequest('http://t/api/v1/action-plan'))
  return (await r.json()) as { ok: boolean; data: Array<{ title: string; source: string }> }
}

beforeEach(() => {
  s.h = pbDb({
    gri_assessments: [{ id: 'gri-1', user_id: USER, is_current: true, action_plan_90d: { '1-30': ['Первая'], '31-60': ['Вторая'] }, top_5_limits: [] }],
  })
})

describe('GET /api/v1/action-plan', () => {
  it('generates the GRI plan when the client has only Point B tasks', async () => {
    s.h!.db.action_items.push({ id: 'pb-1', user_id: USER, title: 'Задача плана', status: 'open', source: 'point_b', pb_task_key: 'task-00000001', priority: 2, created_at: '2026-10-01T00:00:00Z' })
    const r = await get()
    expect(r.data.map((x) => [x.title, x.source]).sort()).toEqual([['Вторая', 'plan'], ['Задача плана', 'point_b'], ['Первая', 'plan']])
  })

  it('does not generate twice: once the client has his own plan it is left alone', async () => {
    await get()
    s.h!.db.action_items.push({ id: 'pb-1', user_id: USER, title: 'Задача плана', status: 'open', source: 'point_b', pb_task_key: 'task-00000001', priority: 2, created_at: '2026-10-01T00:00:00Z' })
    const r = await get()
    expect(r.data).toHaveLength(3)
  })

  it('a client with no tasks at all still gets the generated plan', async () => {
    expect((await get()).data).toHaveLength(2)
  })
})
