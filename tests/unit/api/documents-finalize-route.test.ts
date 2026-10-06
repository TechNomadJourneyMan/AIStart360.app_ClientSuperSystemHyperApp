/**
 * HTTP contract of document finalize:
 *   POST /api/v1/documents              ({ storage_path, … })
 *   POST /api/v1/onboarding/documents   (legacy { file_url, … } and { storage_path, … })
 * Session, tenancy, rows and events are stubbed; storage is the injectable
 * in-memory backend; the finalize rules themselves are real.
 */
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setDocumentStorage, StorageError, type StorageLocation } from '@/lib/documents/storage'

const USER = '11111111-1111-4111-8111-111111111111'

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  tenant: { ok: true, tenant: { userId: '', companyId: 'company-a', role: 'owner', canManage: true, legacy: false } } as Record<string, unknown>,
  rows: [] as Array<Record<string, unknown>>,
  emitted: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], get: () => undefined, set: vi.fn() }) }))
vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/lib/tenancy', () => ({
  resolveTenant: vi.fn(async () => state.tenant),
  tenantErrorMessage: () => 'Нет доступа к компании',
}))
vi.mock('@/lib/rate-limit', () => ({ isRateLimitedKey: vi.fn(async () => false) }))
vi.mock('@/lib/notifications', () => ({ notifyAdmins: vi.fn() }))
vi.mock('@/lib/events/track', () => ({ trackEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: (e: Record<string, unknown>) => { state.emitted.push(e) } }))
vi.mock('@/lib/documents/repository', async (orig) => ({
  ...(await orig<typeof import('@/lib/documents/repository')>()),
  findDuplicate: vi.fn(async ({ sha256 }: { sha256: string }) => state.rows.find((r) => r.sha256 === sha256) ?? null),
  insertDocument: vi.fn(async (d: Record<string, unknown>) => {
    const row = {
      id: `doc-${state.rows.length + 1}`, company_id: d.companyId, doc_type: d.docType, sha256: d.sha256, file_name: d.fileName,
      file_url: d.fileUrl, storage_bucket: d.storageBucket, storage_path: d.storagePath, parse_status: d.parseStatus,
      processing_stage: d.processingStage, security_status: d.securityStatus, security_reason: d.securityReason,
      sniffed_mime: d.sniffedMime, size_bytes: d.sizeBytes,
    }
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
  async remove(loc: StorageLocation) {
    objects.delete(`${loc.bucket}/${loc.path}`)
  },
  async signedUrl() {
    return null
  },
})
afterAll(() => setDocumentStorage(null))

const CSV = Buffer.from('Показатель;Значение\nВыручка;100\n')

async function post(route: 'new' | 'legacy', body: unknown) {
  const mod = route === 'new'
    ? await import('@/app/api/v1/documents/route')
    : await import('@/app/api/v1/onboarding/documents/route')
  const req = new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  const res = await mod.POST(req)
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  state.user = { id: USER }
  state.tenant = { ok: true, tenant: { userId: USER, companyId: 'company-a', role: 'owner', canManage: true, legacy: false } }
  state.rows = []
  state.emitted = []
  objects.clear()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
})

describe('POST /api/v1/documents (storage_path contract)', () => {
  it('201 with the registered document and FILE_UPLOADED', async () => {
    objects.set(`client-documents/${USER}/u1.csv`, CSV)
    const res = await post('new', { storage_path: `${USER}/u1.csv`, file_name: 'Продажи.csv', doc_type: 'sales_report', period: { quarter: 'Q2', year: 2025 } })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ ok: true, duplicate: false, data: { storage_path: `${USER}/u1.csv`, parse_status: 'queued', processing_stage: 'validated', security_status: 'clean' } })
    expect(state.emitted).toEqual([expect.objectContaining({ name: 'FILE_UPLOADED', companyId: 'company-a' })])
  })

  it('200 duplicate for the same bytes', async () => {
    objects.set(`client-documents/${USER}/u1.csv`, CSV)
    objects.set(`client-documents/${USER}/u2.csv`, CSV)
    await post('new', { storage_path: `${USER}/u1.csv`, file_name: 'a.csv', doc_type: 'other' })
    const res = await post('new', { storage_path: `${USER}/u2.csv`, file_name: 'b.csv', doc_type: 'other' })
    expect(res).toMatchObject({ status: 200, body: { ok: true, duplicate: true, data: { id: 'doc-1' } } })
    expect(objects.has(`client-documents/${USER}/u2.csv`)).toBe(false)
  })

  it('422 for a rejected file, with the row and a Russian reason', async () => {
    objects.set(`client-documents/${USER}/x.pdf`, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]))
    const res = await post('new', { storage_path: `${USER}/x.pdf`, file_name: 'x.pdf', doc_type: 'other' })
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ ok: false, rejected: true, code: 'EXECUTABLE', data: { parse_status: 'rejected' } })
    expect(res.body.error).toMatch(/исполняемый/)
  })

  it('400 / 401 / 403 / 404 / 409 error shapes', async () => {
    expect((await post('new', { storage_path: `${USER}/a.csv`, file_name: 'a.csv', doc_type: 'nope' })).status).toBe(400)
    expect((await post('new', { storage_path: `${USER}/a.csv`, file_name: 'a.csv', doc_type: 'other', bucket: 'documents' })).status).toBe(403)
    expect((await post('new', { storage_path: 'someone-else/a.csv', file_name: 'a.csv', doc_type: 'other' })).status).toBe(403)
    expect((await post('new', { storage_path: `${USER}/missing.csv`, file_name: 'a.csv', doc_type: 'other' })).status).toBe(404)
    state.tenant = { ok: false, status: 404, error: 'no_company' }
    expect((await post('new', { storage_path: `${USER}/a.csv`, file_name: 'a.csv', doc_type: 'other' })).status).toBe(409)
    state.tenant = { ok: true, tenant: { userId: USER, companyId: 'company-a', role: 'viewer', canManage: false, legacy: false } }
    expect((await post('new', { storage_path: `${USER}/a.csv`, file_name: 'a.csv', doc_type: 'other' })).status).toBe(403)
    state.user = null
    expect((await post('new', { storage_path: `${USER}/a.csv`, file_name: 'a.csv', doc_type: 'other' })).status).toBe(401)
  })
})

describe('POST /api/v1/onboarding/documents (legacy file_url)', () => {
  it('translates a signed Storage URL to the object and never stores the URL', async () => {
    objects.set(`client-documents/${USER}/1700000000_отчёт.csv`, CSV)
    const res = await post('legacy', {
      user_id: 'ignored',
      file_name: 'отчёт.csv',
      file_url: `https://proj.supabase.co/storage/v1/object/sign/client-documents/${USER}/1700000000_%D0%BE%D1%82%D1%87%D1%91%D1%82.csv?token=abc`,
      doc_type: 'pl_report',
      period_quarter: null,
      period_year: 2025,
      mime_type: 'application/octet-stream',
    })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ storage_bucket: 'client-documents', storage_path: `${USER}/1700000000_отчёт.csv`, file_url: `${USER}/1700000000_отчёт.csv`, sniffed_mime: 'text/csv' })
  })

  it('refuses URLs outside our Storage or outside the caller folder', async () => {
    expect((await post('legacy', { file_name: 'a', file_url: 'http://169.254.169.254/latest', doc_type: 'other' })).status).toBe(400)
    const res = await post('legacy', { file_name: 'a', file_url: 'https://proj.supabase.co/storage/v1/object/public/documents/other-user/a.csv', doc_type: 'other' })
    expect(res.status).toBe(403)
  })

  it('also accepts the storage_path body', async () => {
    objects.set(`documents/${USER}/legacy.csv`, CSV)
    const res = await post('legacy', { storage_path: `${USER}/legacy.csv`, bucket: 'documents', file_name: 'legacy.csv', doc_type: 'other' })
    expect(res.status).toBe(201)
  })
})
