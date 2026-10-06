/**
 * Point A insights: provenance is the server's, not the client's.
 *   POST  — a non-staff caller's question is type 'client', has no author
 *           label and starts open; staff-only values are refused (403).
 *   PATCH — whenever the answer changes, «кто ответил» comes from the caller's
 *           real profile (role + name), ignoring the body.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  profile: { role: 'client', full_name: 'Айгерим' } as { role: string; full_name: string | null },
  inserted: null as Row | null,
  updated: null as Row | null,
}))

function fakeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    from(table: string) {
      let op = 'select'
      let payload: Row = {}
      const b: Record<string, unknown> = {
        select: () => b, eq: () => b, order: () => b, limit: () => b,
        insert: (p: Row) => { op = 'insert'; payload = p; return b },
        update: (p: Row) => { op = 'update'; payload = p; return b },
      }
      const result = () => {
        if (table === 'profiles') return { data: h.profile, error: null }
        if (table === 'companies') return { data: { id: 'co-1' }, error: null }
        if (op === 'insert') { h.inserted = payload; return { data: { id: 'i-1', ...payload }, error: null } }
        if (op === 'update') { h.updated = payload; return { data: { id: 'i-1', ...payload }, error: null } }
        return { data: { id: 'i-1', answer_text: null }, error: null }
      }
      b.maybeSingle = async () => result()
      b.single = async () => result()
      return b
    },
  }
}
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fakeClient() }))

const list = await import('@/app/api/v1/point-a/insights/route')
const item = await import('@/app/api/v1/point-a/insights/[id]/route')

const ID = '33333333-3333-4333-8333-333333333333'
const post = (body: Row) => list.POST(new NextRequest('http://x/api/v1/point-a/insights', { method: 'POST', body: JSON.stringify(body) }))
const patch = (body: Row) => item.PATCH(new NextRequest(`http://x/api/v1/point-a/insights/${ID}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: { id: ID } })
const Q = { question_text: 'Как считать маржу?', category: 'finance' }

beforeEach(() => {
  h.profile = { role: 'client', full_name: 'Айгерим' }
  h.inserted = null
  h.updated = null
})

describe('POST /api/v1/point-a/insights', () => {
  it('a client question: type client, no author label, the requested open status', async () => {
    const res = await post({ ...Q, type: 'client', status: 'pending_ai', author_name: 'Эксперт Иванов' })
    expect(res.status).toBe(201)
    expect(h.inserted).toMatchObject({ type: 'client', author_name: null, status: 'pending_ai', user_id: 'u-1' })
  })

  it.each([
    ['type expert', { type: 'expert' }],
    ['type ai', { type: 'ai' }],
    ['status pending_confirmation', { type: 'client', status: 'pending_confirmation' }],
  ])('a client cannot set %s (403, nothing stored)', async (_n, extra) => {
    const res = await post({ ...Q, ...extra })
    expect(res.status).toBe(403)
    expect(h.inserted).toBeNull()
  })

  it('staff may create an expert question with an author', async () => {
    h.profile = { role: 'expert', full_name: 'Иванов' }
    const res = await post({ ...Q, type: 'expert', author_name: 'Иванов', status: 'pending_confirmation' })
    expect(res.status).toBe(201)
    expect(h.inserted).toMatchObject({ type: 'expert', author_name: 'Иванов', status: 'pending_confirmation' })
  })
})

describe('PATCH /api/v1/point-a/insights/[id]', () => {
  it('a client answer is attributed to the client by profile, whatever the body says', async () => {
    const res = await patch({ answer_text: 'Так', answer_author_role: 'expert', answer_author_name: 'Эксперт Иванов' })
    expect(res.status).toBe(200)
    expect(h.updated).toMatchObject({ answer_text: 'Так', answer_author_role: 'client', answer_author_name: 'Айгерим' })
  })

  it('an expert answer gets role expert and the expert\'s real name', async () => {
    h.profile = { role: 'expert', full_name: 'Иванов' }
    await patch({ answer_text: 'Ответ', answer_author_role: 'client', answer_author_name: 'Кто-то' })
    expect(h.updated).toMatchObject({ answer_author_role: 'expert', answer_author_name: 'Иванов' })
  })

  it('a client cannot relabel the author without changing the answer', async () => {
    expect((await patch({ answer_author_name: 'Эксперт Иванов' })).status).toBe(403)
    expect((await patch({ answer_author_role: 'admin' })).status).toBe(403)
    expect(h.updated).toBeNull()
  })
})
