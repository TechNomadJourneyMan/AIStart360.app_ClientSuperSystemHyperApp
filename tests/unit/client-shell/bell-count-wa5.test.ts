/**
 * WA-5: the bell polls on every cabinet page — it asks for the NUMBER only
 * (GET /api/v1/notifications?count=1: one head count, no rows with titles,
 * texts and links); the feed page keeps the full list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  user: { id: 'u-1' } as null | { id: string },
  calls: [] as Array<{ op: string; args: unknown[] }>,
  count: 4 as number | null,
  countError: null as null | { message: string },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: s.user } }) },
    from: (table: string) => {
      s.calls.push({ op: 'from', args: [table] })
      let head = false
      const b: Record<string, unknown> = {}
      const rec = (op: string) => (...args: unknown[]) => { s.calls.push({ op, args }); return b }
      Object.assign(b, {
        select: (...args: unknown[]) => { s.calls.push({ op: 'select', args }); head = (args[1] as { head?: boolean } | undefined)?.head === true; return b },
        eq: rec('eq'),
        order: rec('order'),
        limit: rec('limit'),
        is: rec('is'),
        then: (resolve: (v: unknown) => void) =>
          resolve(head ? { count: s.count, error: s.countError } : { data: [{ id: 'n-1', title: 'Доступ открыт', body: 'текст', link: '/client/home' }], error: null }),
      })
      return b
    },
  }),
}))

const { GET } = await import('@/app/api/v1/notifications/route')
const { UNREAD_COUNT_URL, fetchUnreadCount } = await import('@/components/notifications/NotificationsBellSync')

const get = (qs = '') => GET(new Request(`http://localhost/api/v1/notifications${qs}`))

beforeEach(() => {
  s.user = { id: 'u-1' }
  s.calls = []
  s.count = 4
  s.countError = null
})

describe('WA-5: GET /api/v1/notifications?count=1 — the number only', () => {
  it('one head count of the own unread, archived excluded; no rows in the answer', async () => {
    const res = await get('?count=1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, unread: 4 })
    expect(s.calls.filter((c) => c.op === 'from')).toHaveLength(1)
    const select = s.calls.find((c) => c.op === 'select')!
    expect(select.args).toEqual(['id', { count: 'exact', head: true }])
    expect(s.calls.some((c) => c.op === 'limit')).toBe(false)
    expect(s.calls.filter((c) => c.op === 'eq').map((c) => c.args)).toEqual([['user_id', 'u-1'], ['is_read', false]])
    expect(s.calls.find((c) => c.op === 'is')?.args).toEqual(['archived_at', null])
  })

  it('the feed itself still gets the list and the count', async () => {
    const body = await (await get('?filter=all')).json()
    expect(body.data).toHaveLength(1)
    expect(body.unread).toBe(4)
  })

  it('no session → 401; a failed count → 500, not a false «0»', async () => {
    s.user = null
    expect((await get('?count=1')).status).toBe(401)
    s.user = { id: 'u-1' }
    s.countError = { message: 'timeout' }
    expect((await get('?count=1')).status).toBe(500)
  })
})

describe('WA-5: the bell asks for the count, not the feed', () => {
  it('uses ?count=1 and reads the number', async () => {
    expect(UNREAD_COUNT_URL).toBe('/api/v1/notifications?count=1')
    const urls: string[] = []
    const ok = (async (url: string) => { urls.push(url); return { json: async () => ({ ok: true, unread: 7 }) } }) as unknown as typeof fetch
    expect(await fetchUnreadCount(ok)).toBe(7)
    expect(urls).toEqual(['/api/v1/notifications?count=1'])
  })

  it('a refused or broken answer leaves the badge alone (null)', async () => {
    expect(await fetchUnreadCount((async () => ({ json: async () => ({ ok: false }) })) as unknown as typeof fetch)).toBeNull()
    expect(await fetchUnreadCount((async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBeNull()
  })
})
