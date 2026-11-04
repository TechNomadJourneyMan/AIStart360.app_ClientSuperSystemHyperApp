/**
 * API страницы «Фильтр контента» (/api/giga-admin/content-filter/**):
 * валидация словаря, сброс кеша словаря, аудит, понятное сообщение, когда
 * миграция 120 не применена, и «Проверка текста» со свежим словарём.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const s = vi.hoisted(() => ({
  missing: false,
  insertError: null as { code: string; message: string } | null,
  inserted: [] as unknown[],
  updated: [] as unknown[],
  audits: [] as Array<{ action: string }>,
  terms: [] as Array<{ term: string; kind: string }>,
  event: { id: 'e1', status: 'open', user_id: null, source: 'profile', field: 'full_name' } as Record<string, unknown> | null,
}))

const MISSING = { code: 'PGRST205', message: "Could not find the table 'public.content_moderation_events'" }

function chain(table: string) {
  const c: Record<string, unknown> = {}
  const self = () => c
  let op: 'read' | 'insert' | 'update' | 'delete' = 'read'
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'contains', 'range']) c[m] = self
  c.insert = (p: unknown) => { op = 'insert'; s.inserted.push(p); return c }
  c.update = (p: unknown) => { op = 'update'; s.updated.push(p); return c }
  c.delete = () => { op = 'delete'; return c }
  const result = () => {
    if (s.missing) return { data: null, error: MISSING, count: null }
    if (op === 'insert' && s.insertError) return { data: null, error: s.insertError }
    if (table === 'content_filter_terms') return { data: op === 'read' ? s.terms : [{ id: 't1', term: 'x', kind: 'block' }], error: null }
    if (table === 'content_moderation_events') return { data: op === 'update' ? [{ id: 'e1' }] : [], error: null, count: 0 }
    return { data: [], error: null }
  }
  c.single = () => Promise.resolve({ ...result(), data: s.missing || (op === 'insert' && s.insertError) ? null : { id: 't1', term: 'казино', kind: 'block' } })
  c.maybeSingle = () => Promise.resolve(s.missing ? result() : { data: s.event, error: null })
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej)
  return c
}

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => ({ id: '99999999-8888-4777-8666-555555555555', kind: 'session', role: 'content_manager' })) }
})
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: (t: string) => chain(t) }) }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async (_a: unknown, e: { action: string }) => { s.audits.push(e); return true } }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => true }))

const guard = await import('@/lib/moderation/guard')
const invalidate = vi.spyOn(guard, 'invalidateFilterDictionary')
const list = await import('@/app/api/giga-admin/content-filter/route')
const events = await import('@/app/api/giga-admin/content-filter/events/[id]/route')
const terms = await import('@/app/api/giga-admin/content-filter/terms/route')
const test = await import('@/app/api/giga-admin/content-filter/test/route')

const EID = '11111111-2222-4333-8444-555555555555'
const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

beforeEach(() => {
  s.missing = false
  s.insertError = null
  s.inserted = []
  s.updated = []
  s.audits = []
  s.terms = []
  s.event = { id: EID, status: 'open', user_id: null, source: 'profile', field: 'full_name' }
  invalidate.mockClear()
  guard.invalidateFilterDictionary()
})

describe('content-filter terms', () => {
  it('rejects a 1-char or 61-char term', async () => {
    expect((await terms.POST(req('/api/giga-admin/content-filter/terms', 'POST', { term: 'х', kind: 'block' }))).status).toBe(400)
    expect((await terms.POST(req('/api/giga-admin/content-filter/terms', 'POST', { term: 'а'.repeat(61), kind: 'block' }))).status).toBe(400)
    expect((await terms.POST(req('/api/giga-admin/content-filter/terms', 'POST', { term: 'казино', kind: 'maybe' }))).status).toBe(400)
    expect(s.inserted).toHaveLength(0)
  })

  it('adds a term normalized (lower case, ё → е), resets the dictionary cache, audits', async () => {
    const res = await terms.POST(req('/api/giga-admin/content-filter/terms', 'POST', { term: '  КазинЁ ', kind: 'block', note: 'спам' }))
    expect(res.status).toBe(201)
    expect(s.inserted[0]).toMatchObject({ term: 'казине', kind: 'block', note: 'спам' })
    expect(invalidate).toHaveBeenCalled()
    expect(s.audits.map((a) => a.action)).toEqual(['moderation.term_added'])
  })

  it('duplicate term → 409 with a clear message', async () => {
    s.insertError = { code: '23505', message: 'duplicate key' }
    const res = await terms.POST(req('/api/giga-admin/content-filter/terms', 'POST', { term: 'казино', kind: 'allow' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/уже в исключениях/)
    expect(s.audits).toHaveLength(0)
  })

  it('delete resets the cache and audits', async () => {
    const res = await terms.DELETE(req('/api/giga-admin/content-filter/terms', 'DELETE', { id: EID }))
    expect(res.status).toBe(200)
    expect(invalidate).toHaveBeenCalled()
    expect(s.audits.map((a) => a.action)).toEqual(['moderation.term_removed'])
  })
})

describe('migration 120 not applied', () => {
  it('journal, dictionary and review answer 503 «миграция 120 не применена»', async () => {
    s.missing = true
    for (const res of [
      await list.GET(req('/api/giga-admin/content-filter?status=all', 'GET')),
      await terms.GET(req('/api/giga-admin/content-filter/terms', 'GET')),
      await events.PATCH(req(`/api/giga-admin/content-filter/events/${EID}`, 'PATCH', { status: 'reviewed' }), { params: { id: EID } }),
    ]) {
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.code).toBe('MIGRATION_MISSING')
      expect(body.error).toMatch(/миграция 120/)
    }
    expect(s.audits).toHaveLength(0)
  })
})

describe('events review', () => {
  it('marks an event reviewed with reviewer + time, audits', async () => {
    const res = await events.PATCH(req(`/api/giga-admin/content-filter/events/${EID}`, 'PATCH', { status: 'false_positive' }), { params: { id: EID } })
    expect(res.status).toBe(200)
    expect(s.updated[0]).toMatchObject({ status: 'false_positive', reviewed_by: '99999999-8888-4777-8666-555555555555' })
    expect(s.audits.map((a) => a.action)).toEqual(['moderation.event_reviewed'])
  })

  it('rejects an unknown status', async () => {
    const res = await events.PATCH(req(`/api/giga-admin/content-filter/events/${EID}`, 'PATCH', { status: 'deleted' }), { params: { id: EID } })
    expect(res.status).toBe(400)
  })
})

describe('text check', () => {
  it('uses the fresh dictionary: block and allow words apply', async () => {
    s.terms = [{ term: 'казино', kind: 'block' }]
    let body = await (await test.POST(req('/api/giga-admin/content-filter/test', 'POST', { text: 'Онлайн казино' }))).json()
    expect(body.data.clean).toBe(false)
    expect(body.data.matches[0]).toMatchObject({ category: 'custom' })

    body = await (await test.POST(req('/api/giga-admin/content-filter/test', 'POST', { text: 'Нормальный текст про продажи' }))).json()
    expect(body.data.clean).toBe(true)

    body = await (await test.POST(req('/api/giga-admin/content-filter/test', 'POST', { text: 'ТОО site.kz', kind: 'name' }))).json()
    expect(body.data.clean).toBe(true)
    body = await (await test.POST(req('/api/giga-admin/content-filter/test', 'POST', { text: 'ТОО www.site.kz', kind: 'name' }))).json()
    expect(body.data.categories).toEqual(['spam'])
  })
})
