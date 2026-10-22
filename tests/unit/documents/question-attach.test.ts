/**
 * Files attached to a questionnaire question from the answer editor
 * (documents.question_key, migration 131): the browser upload passes the key,
 * the finalize route links the registered row, the attachments API lists /
 * detaches — all scoped to the owner and tolerant of a database without 131.
 */
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadClientDocument, type UploadSupabaseLike } from '@/lib/documents/client-upload'
import { linkDocumentToQuestion, listQuestionDocuments, unlinkDocumentFromQuestion } from '@/lib/documents/question-link'
import { setDocumentStorage, StorageError, type StorageLocation } from '@/lib/documents/storage'
import { memoryClient } from '../data-layer/memory-client'

const USER = '11111111-1111-4111-8111-111111111111'
const KEY = 's2n_goal_12m_what'

// ─── a recording Supabase double for documents updates ──────────────────────
type Call = { table: string; patch: unknown; filters: Array<[string, string, unknown]> }
function recorder(result: { error: unknown } = { error: null }) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, patch: null, filters: [] }
      calls.push(call)
      const b: Record<string, unknown> = {
        update: (p: unknown) => { call.patch = p; return b },
        eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return b },
        is: (c: string, v: unknown) => { call.filters.push(['is', c, v]); return b },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej),
      }
      return b
    },
  }
  return { client: client as never, calls }
}

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  rows: [] as Array<Record<string, unknown>>,
  service: null as unknown,
}))

vi.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], get: () => undefined, set: vi.fn() }) }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.service }))
vi.mock('@/lib/tenancy', () => ({
  resolveTenant: vi.fn(async () => ({ ok: true, tenant: { userId: USER, companyId: 'company-a', role: 'owner', canManage: true, legacy: false } })),
  tenantErrorMessage: () => 'Нет доступа к компании',
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: vi.fn(async () => false) }))
vi.mock('@/lib/notifications', () => ({ notifyAdmins: vi.fn() }))
vi.mock('@/lib/events/track', () => ({ trackEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: vi.fn() }))
vi.mock('@/lib/documents/repository', async (orig) => ({
  ...(await orig<typeof import('@/lib/documents/repository')>()),
  findDuplicate: vi.fn(async ({ sha256 }: { sha256: string }) => state.rows.find((r) => r.sha256 === sha256) ?? null),
  insertDocument: vi.fn(async (d: Record<string, unknown>) => {
    const row = { id: `doc-${state.rows.length + 1}`, company_id: d.companyId, doc_type: d.docType, sha256: d.sha256, file_name: d.fileName, storage_path: d.storagePath, parse_status: d.parseStatus }
    state.rows.push(row)
    return row
  }),
}))

const objects = new Map<string, Buffer>()
setDocumentStorage({
  async download(loc: StorageLocation) {
    const b = objects.get(`${loc.bucket}/${loc.path}`)
    if (!b) throw new StorageError('NOT_FOUND', 'missing')
    return b
  },
  async remove(loc: StorageLocation) { objects.delete(`${loc.bucket}/${loc.path}`) },
  async signedUrl() { return null },
})
afterAll(() => setDocumentStorage(null))

const CSV = Buffer.from('Показатель;Значение\nВыручка;100\n')

async function finalize(body: unknown) {
  const mod = await import('@/app/api/v1/documents/route')
  const res = await mod.POST(new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  state.user = { id: USER }
  state.rows = []
  objects.clear()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
})

describe('browser upload: question_key passthrough', () => {
  const sb: UploadSupabaseLike = {
    auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
    storage: { from: () => ({ upload: async (path: string) => ({ data: { path }, error: null }), remove: async () => ({ data: null, error: null }), createSignedUrl: async () => ({ data: null, error: null }) }) },
  }
  const file = new File([new Uint8Array(10)], 'Цели.pdf', { type: 'application/pdf' })

  it('sends question_key with the finalize body', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, duplicate: false, data: { id: 'doc-1', file_name: 'Цели.pdf', doc_type: 'other' } }), { status: 201 }))
    await uploadClientDocument(file, { docType: 'other', companyId: 'company-a', questionKey: KEY }, { supabase: sb, fetch: f as never, uuid: () => 'u1' })
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(String(init.body))).toMatchObject({ doc_type: 'other', company_id: 'company-a', question_key: KEY })
  })

  it('no question → no key in the body', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, duplicate: false, data: { id: 'doc-1', file_name: 'x', doc_type: 'other' } }), { status: 201 }))
    await uploadClientDocument(file, { docType: 'other' }, { supabase: sb, fetch: f as never, uuid: () => 'u1' })
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(String(init.body))).not.toHaveProperty('question_key')
  })
})

describe('POST /api/v1/documents with question_key', () => {
  it('a new file is linked to the question (owner-scoped update)', async () => {
    const rec = recorder()
    state.service = rec.client
    objects.set(`client-documents/${USER}/a.csv`, CSV)
    const res = await finalize({ storage_path: `${USER}/a.csv`, file_name: 'a.csv', doc_type: 'other', question_key: KEY })
    expect(res.status).toBe(201)
    expect(rec.calls).toEqual([{ table: 'documents', patch: { question_key: KEY }, filters: [['eq', 'id', 'doc-1'], ['eq', 'user_id', USER]] }])
  })

  it('a duplicate is linked only when it is not on another question', async () => {
    const rec = recorder()
    state.service = rec.client
    objects.set(`client-documents/${USER}/a.csv`, CSV)
    objects.set(`client-documents/${USER}/b.csv`, CSV)
    await finalize({ storage_path: `${USER}/a.csv`, file_name: 'a.csv', doc_type: 'other' })
    expect(rec.calls).toHaveLength(0)
    const res = await finalize({ storage_path: `${USER}/b.csv`, file_name: 'b.csv', doc_type: 'other', question_key: KEY })
    expect(res.body).toMatchObject({ ok: true, duplicate: true })
    expect(rec.calls[0].filters).toContainEqual(['is', 'question_key', null])
  })

  it('an invalid key is a 400; a link failure never fails the upload', async () => {
    objects.set(`client-documents/${USER}/a.csv`, CSV)
    expect((await finalize({ storage_path: `${USER}/a.csv`, file_name: 'a.csv', doc_type: 'other', question_key: 'Bad Key' })).status).toBe(400)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    state.service = recorder({ error: { code: 'PGRST204', message: "Could not find the 'question_key' column" } }).client
    expect((await finalize({ storage_path: `${USER}/a.csv`, file_name: 'a.csv', doc_type: 'other', question_key: KEY })).status).toBe(201)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('question-link helpers', () => {
  it('link / unlink are scoped to the owner and the question', async () => {
    const rec = recorder()
    expect(await linkDocumentToQuestion(rec.client, { documentId: 'd1', userId: USER, questionKey: KEY })).toBe('linked')
    expect(await unlinkDocumentFromQuestion(rec.client, { documentId: 'd1', userId: USER, questionKey: KEY })).toBe('linked')
    expect(rec.calls[1]).toEqual({ table: 'documents', patch: { question_key: null }, filters: [['eq', 'id', 'd1'], ['eq', 'user_id', USER], ['eq', 'question_key', KEY]] })
    expect(await linkDocumentToQuestion(rec.client, { documentId: 'd1', userId: USER, questionKey: '../x' })).toBe('skipped')
  })

  it('lists the owner\'s files of a question; before migration 131 → empty, unavailable', async () => {
    const m = memoryClient({ documents: [
      { id: 'd1', user_id: USER, question_key: KEY, file_name: 'a.pdf', uploaded_at: '2026-10-20', parsed_data: { raw_rows: [1, 2] } },
      { id: 'd2', user_id: USER, question_key: 'other_key', file_name: 'b.pdf', uploaded_at: '2026-10-21' },
      { id: 'd3', user_id: 'someone-else', question_key: KEY, file_name: 'c.pdf', uploaded_at: '2026-10-22' },
    ] })
    const res = await listQuestionDocuments(m.client, { userId: USER, questionKey: KEY })
    expect(res).toMatchObject({ ok: true, available: true })
    expect(res.ok && res.documents.map((d) => d.id)).toEqual(['d1'])
    // Row arrays are not shipped to the editor.
    expect(res.ok && res.documents[0].parsed_data).toEqual({ stats: { row_count: 2 } })

    const missing = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: '42703', message: 'column documents.question_key does not exist' } }) }) }) }) }) }) } as never
    expect(await listQuestionDocuments(missing, { userId: USER, questionKey: KEY })).toEqual({ ok: true, documents: [], available: false })
  })
})
