/**
 * GIGA «База знаний бота» routes (/api/giga-admin/comm/kb*): inbox.manage
 * only, profanity → 400 with the field, embedding on publish (and the keyword
 * fallback without a provider), text edits clear the embedding, file upload →
 * draft article. No network, no real database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { StaffRole } from '@/lib/admin/rbac'
import { commDb } from './_db'

const STAFF = '33333333-3333-4333-8333-333333333333'
const ART = '99999999-9999-4999-8999-999999999999'

const h = vi.hoisted(() => ({
  actor: null as null | { id: string; kind: string; role?: StaffRole },
  db: null as unknown as ReturnType<typeof import('./_db').commDb>,
  audit: vi.fn(async (..._a: unknown[]) => true),
  vector: null as number[] | null,
}))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return { requireGiga: makeRequireGiga(() => h.actor), staffRoleOfUser: vi.fn() }
})
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => h.db.sb }))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: h.audit }))
vi.mock('@/lib/ai/openrouter', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/openrouter')>()),
  embedWithOpenRouter: vi.fn(async () => (h.vector ? [h.vector] : null)),
}))

import { GET as listGET, POST as createPOST } from '@/app/api/giga-admin/comm/kb/route'
import { DELETE as oneDELETE, GET as oneGET, PATCH as onePATCH } from '@/app/api/giga-admin/comm/kb/[id]/route'
import { POST as uploadPOST } from '@/app/api/giga-admin/comm/kb/upload/route'

function req(url: string, method = 'GET', body?: unknown): NextRequest {
  const init: RequestInit = { method, headers: { origin: 'http://localhost' } }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'content-type': 'application/json', origin: 'http://localhost' }
  }
  const r = new Request(`http://localhost${url}`, init) as unknown as NextRequest & { nextUrl: URL }
  Object.defineProperty(r, 'nextUrl', { value: new URL(`http://localhost${url}`) })
  return r
}
const P = { params: { id: ART } }
const VEC = Array.from({ length: 1536 }, (_, i) => (i % 7) / 10)

beforeEach(() => {
  vi.clearAllMocks()
  h.actor = { id: STAFF, kind: 'session', role: 'admin' }
  h.vector = null
  h.db = commDb({
    kb_articles: [
      { id: ART, title: 'Тарифы', body: 'Free и Pro', tags: ['тарифы'], source: 'manual', status: 'published', embedding: '[0.1]', updated_by: null, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' },
      { id: 'a-2', title: 'Черновик', body: 'текст', tags: [], source: 'manual', status: 'draft', embedding: null, updated_by: null, created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z' },
    ],
  })
})

describe('permissions', () => {
  it('only inbox.manage: support (inbox.view) and analyst get 403 everywhere', async () => {
    for (const role of ['support', 'analyst', 'super_expert'] as StaffRole[]) {
      h.actor = { id: STAFF, kind: 'session', role }
      expect((await listGET(req('/api/giga-admin/comm/kb'))).status, role).toBe(403)
      expect((await createPOST(req('/api/giga-admin/comm/kb', 'POST', { title: 'x', body: 'y' }))).status, role).toBe(403)
      expect((await oneGET(req(`/api/giga-admin/comm/kb/${ART}`), P)).status, role).toBe(403)
      expect((await onePATCH(req(`/api/giga-admin/comm/kb/${ART}`, 'PATCH', { status: 'draft' }), P)).status, role).toBe(403)
      expect((await oneDELETE(req(`/api/giga-admin/comm/kb/${ART}`, 'DELETE'), P)).status, role).toBe(403)
      expect((await uploadPOST(req('/api/giga-admin/comm/kb/upload', 'POST', new FormData()))).status, role).toBe(403)
    }
    expect(h.db.db.kb_articles).toHaveLength(2)
  })

  it('crm_manager (inbox.manage) lists articles with the «semantic» flag', async () => {
    h.actor = { id: STAFF, kind: 'session', role: 'crm_manager' }
    const res = await listGET(req('/api/giga-admin/comm/kb'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.map((a: { id: string; semantic: boolean }) => [a.id, a.semantic])).toEqual([['a-2', false], [ART, true]])
    expect(json.data[0]).not.toHaveProperty('body')
  })
})

describe('create / edit / delete', () => {
  it('profanity in the title or text → 400 with the field, nothing saved', async () => {
    let res = await createPOST(req('/api/giga-admin/comm/kb', 'POST', { title: 'Тарифы, бля', body: 'ok' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ ok: false, field: 'title' })
    res = await createPOST(req('/api/giga-admin/comm/kb', 'POST', { title: 'Тарифы', body: 'нахуй это' }))
    expect((await res.json()).field).toBe('body')
    res = await onePATCH(req(`/api/giga-admin/comm/kb/${ART}`, 'PATCH', { body: 'пиздец' }), P)
    expect(res.status).toBe(400)
    expect((await res.json()).field).toBe('body')
    expect(h.db.db.kb_articles).toHaveLength(2)
    expect(h.db.db.kb_articles[0].body).toBe('Free и Pro')
  })

  it('publishing computes the embedding; without a provider it is saved for keyword search', async () => {
    let res = await createPOST(req('/api/giga-admin/comm/kb', 'POST', { title: 'Анкета', body: '12 шагов', tags: ['Анкета', 'анкета '], status: 'published' }))
    expect(res.status).toBe(200)
    let json = await res.json()
    expect(json.embedded).toBe(false)
    expect(json.data).toMatchObject({ title: 'Анкета', status: 'published', tags: ['анкета'], semantic: false })

    h.vector = VEC
    res = await createPOST(req('/api/giga-admin/comm/kb', 'POST', { title: 'GRI', body: 'Индекс готовности', status: 'published' }))
    json = await res.json()
    expect(json.embedded).toBe(true)
    const row = h.db.db.kb_articles.find((a) => a.title === 'GRI')!
    expect(String(row.embedding).startsWith('[0.000000,0.100000')).toBe(true)
    expect(row.updated_by).toBe(STAFF)
    expect(h.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'comm.kb.created' }), expect.anything())

    // A draft is not embedded.
    res = await createPOST(req('/api/giga-admin/comm/kb', 'POST', { title: 'Черновик 2', body: 'x' }))
    expect((await res.json()).embedded).toBe(false)
  })

  it('editing the text clears the embedding and re-embeds a published article; unpublish is audited', async () => {
    h.vector = VEC
    let res = await onePATCH(req(`/api/giga-admin/comm/kb/${ART}`, 'PATCH', { body: 'Free, Pro и Business' }), P)
    expect(res.status).toBe(200)
    expect((await res.json()).embedded).toBe(true)
    expect(String(h.db.db.kb_articles[0].embedding).length).toBeGreaterThan(100)

    h.vector = null
    res = await onePATCH(req(`/api/giga-admin/comm/kb/${ART}`, 'PATCH', { title: 'Тарифы 2026' }), P)
    expect((await res.json()).embedded).toBe(false)
    expect(h.db.db.kb_articles[0].embedding).toBeNull()

    res = await onePATCH(req(`/api/giga-admin/comm/kb/${ART}`, 'PATCH', { status: 'draft' }), P)
    expect((await res.json()).data.status).toBe('draft')
    expect(h.audit).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ action: 'comm.kb.unpublished' }), expect.anything())
  })

  it('GET one with the text; 404 / 400 for unknown / bad ids; DELETE removes it', async () => {
    const res = await oneGET(req(`/api/giga-admin/comm/kb/${ART}`), P)
    expect((await res.json()).data).toMatchObject({ id: ART, body: 'Free и Pro', semantic: true })
    expect((await oneGET(req('/api/giga-admin/comm/kb/x'), { params: { id: 'x' } })).status).toBe(400)
    const missing = '12345678-1234-4234-8234-123456789012'
    expect((await oneGET(req(`/api/giga-admin/comm/kb/${missing}`), { params: { id: missing } })).status).toBe(404)
    expect((await oneDELETE(req(`/api/giga-admin/comm/kb/${ART}`, 'DELETE'), P)).status).toBe(200)
    expect(h.db.db.kb_articles.map((a) => a.id)).toEqual(['a-2'])
  })
})

describe('upload', () => {
  function form(name: string, text: string, type = 'text/plain'): FormData {
    const f = new FormData()
    f.append('file', new File([text], name, { type }))
    return f
  }

  it('a .md / .txt file becomes a draft article titled by the file name', async () => {
    const res = await uploadPOST(req('/api/giga-admin/comm/kb/upload', 'POST', form('Частые_вопросы.md', '# FAQ\n\nАнкета — 12 шагов.')))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toMatchObject({ title: 'Частые вопросы', status: 'draft', source: 'file', body: '# FAQ\n\nАнкета — 12 шагов.' })
  })

  it('unsupported type, empty file, profanity → 400', async () => {
    expect((await uploadPOST(req('/api/giga-admin/comm/kb/upload', 'POST', form('price.xlsx', 'x')))).status).toBe(400)
    expect((await uploadPOST(req('/api/giga-admin/comm/kb/upload', 'POST', form('empty.txt', '   ')))).status).toBe(400)
    expect((await uploadPOST(req('/api/giga-admin/comm/kb/upload', 'POST', new FormData()))).status).toBe(400)
    const dirty = await uploadPOST(req('/api/giga-admin/comm/kb/upload', 'POST', form('faq.txt', 'нахуй')))
    expect(dirty.status).toBe(400)
    expect((await dirty.json()).field).toBe('body')
    expect(h.db.db.kb_articles).toHaveLength(2)
  })
})
