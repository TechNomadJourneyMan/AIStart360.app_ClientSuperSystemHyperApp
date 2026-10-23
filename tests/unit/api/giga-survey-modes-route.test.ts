/**
 * GET /api/giga-admin/surveys/modes (survey Ф5): survey.view only; the funnel
 * from user_events (paged, two ranges merged), the lists cut to the scope of
 * the staff member, emails only with users.sensitive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'

const s = vi.hoisted(() => ({
  role: 'admin' as StaffRole,
  scope: null as string[] | null,
  rpcError: false,
  events: [] as Array<Record<string, unknown>>,
  ranges: [] as Array<[number, number]>,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: 'session', role: s.role })) }
})
vi.mock('@/lib/admin/client-scope', () => ({ scopedClientIds: async () => s.scope }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    rpc: async () => (s.rpcError ? { data: null, error: { message: 'missing' } } : { data: [{ user_id: 'C', completed_at: new Date(Date.now() - 86_400_000).toISOString() }], error: null }),
    from(table: string) {
      const filters: Array<(r: Record<string, unknown>) => boolean> = []
      let range: [number, number] | null = null
      const rows = () => {
        const all: Array<Record<string, unknown>> = table === 'user_events' ? s.events
          : table === 'profiles' ? [{ id: 'B', full_name: null, email: 'b@x.kz', organization: null }, { id: 'D', full_name: 'Дина', email: 'd@x.kz', organization: null }]
          : table === 'companies' ? [{ user_id: 'B', name: 'ТОО Бета' }] : []
        const out = all.filter((r) => filters.every((f) => f(r)))
        if (range) { s.ranges.push(range); return out.slice(range[0], range[1] + 1) }
        return out
      }
      const b = {
        select: () => b,
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
        gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b },
        order: () => b,
        range: (a: number, z: number) => { range = [a, z]; return b },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res),
      }
      return b
    },
  }),
}))

const route = await import('@/app/api/giga-admin/surveys/modes/route')
const get = async (q = '') => {
  const res = await route.GET(new NextRequest(`http://x/api/giga-admin/surveys/modes${q}`))
  return { status: res.status, body: await res.json() }
}
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()

beforeEach(() => {
  s.role = 'admin'
  s.scope = null
  s.rpcError = false
  s.ranges = []
  let id = 0
  const e = (user: string, name: string, daysAgo: number, metadata: Record<string, unknown> = {}, source = 'web') => ({ id: ++id, user_id: user, event_name: name, created_at: iso(daysAgo), metadata, source })
  s.events = [
    e('B', 'SURVEY_MODE_CHOSEN', 10, { mode: 'express', from: 'chooser' }),
    e('B', 'SURVEY_EXPRESS_STARTED', 10),
    e('B', 'SURVEY_EXPRESS_COMPLETED', 10, { answered: 26, unknown: 0, skipped: 0, minutes: 9 }, 'server'),
    e('C', 'SURVEY_MODE_CHOSEN', 5, { mode: 'full', from: 'chooser' }),
    e('D', 'SURVEY_MODE_CHOSEN', 3, { mode: 'chat', from: 'chooser' }),
    e('Z', 'SURVEY_MODE_CHOSEN', 60, { mode: 'express', from: 'chooser' }), // before a 30-day period
    e('Z', 'SURVEY_EXPRESS_COMPLETED', 60, {}, 'server'),
  ]
})

describe('GET /api/giga-admin/surveys/modes', () => {
  it('403 without survey.view', async () => {
    s.role = 'content_manager'
    expect((await get()).status).toBe(403)
  })

  it('the funnel of the period; stuck clients of all time; names without emails for non-sensitive staff', async () => {
    s.role = 'analyst'
    const { status, body } = await get('?days=30')
    expect(status).toBe(200)
    const d = body.data
    expect(d.days).toBe(30)
    expect(d.cohort).toBe(3)
    expect(d.steps.map((x: { users: number }) => x.users)).toEqual([3, 1, 1, 0, 0, 0, 1])
    expect(d.stuck.map((x: { userId: string }) => x.userId).sort()).toEqual(['B', 'Z'])
    expect(d.pending.map((x: { userId: string }) => x.userId)).toEqual(['D'])
    expect(d.people.B).toEqual({ name: 'Пользователь B', company: 'ТОО Бета' })
    expect(d.people.D.name).toBe('Дина')
    expect(d.submissionsSource).toBe('completions')
  })

  it('sensitive staff see the email when there is no name; days are clamped', async () => {
    const { body } = await get('?days=3')
    expect(body.data.days).toBe(7)
    expect(body.data.people.B.name).toBe('b@x.kz')
  })

  it('a scoped expert gets only his clients in the lists', async () => {
    s.scope = ['D']
    const { body } = await get()
    expect(body.data.stuck).toEqual([])
    expect(body.data.pending.map((x: { userId: string }) => x.userId)).toEqual(['D'])
    expect(body.data.cohort).toBe(3)
  })

  it('events are read page by page; RPC down → QUESTIONNAIRE_COMPLETED', async () => {
    s.rpcError = true
    s.events = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1, user_id: `U${i}`, event_name: 'SURVEY_MODE_CHOSEN', created_at: iso(2), metadata: { mode: 'express' }, source: 'web' }))
    const { body } = await get()
    expect(body.data.cohort).toBe(1500)
    expect(body.data.submissionsSource).toBe('events')
    expect(s.ranges).toContainEqual([1000, 1999])
  })
})
