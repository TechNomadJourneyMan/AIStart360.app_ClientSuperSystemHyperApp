/**
 * Medical routes (/api/medical/audit/run, /api/medical/intake/validate)
 * download the patient base with the SERVICE key. They used to join
 * documents.file_url straight into `/storage/v1/object/documents/<file_url>`,
 * so a row pointing at another user's object (or a `../` path) was read for
 * the caller. The object is now resolved with locationForDocument() and must
 * sit in the caller's own `<uid>/` folder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { setDocumentStorage, type StorageLocation } from '@/lib/documents/storage'

const ME = '11111111-1111-4111-8111-111111111111'
const VICTIM = '22222222-2222-4222-8222-222222222222'
const DOC_ID = '33333333-3333-4333-8333-333333333333'

const s = vi.hoisted(() => ({ row: null as null | Record<string, unknown> }))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: '11111111-1111-4111-8111-111111111111' } } }) } }),
}))
vi.mock('@/lib/supabase-service', () => ({ requireServiceRoleKey: () => 'service-key' }))

const storageFetches: string[] = []
const downloads: StorageLocation[] = []
const CSV = Buffer.from('phone,date,amount\n+77010000000,2026-01-01,1000\n')

const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input)
  if (url.includes('/storage/v1/object/')) {
    storageFetches.push(url)
    return new Response(CSV, { status: 200 })
  }
  if (url.includes('/rest/v1/documents?')) return new Response(JSON.stringify(s.row ? [s.row] : []), { status: 200 })
  return new Response('[]', { status: 200 })
})

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.example'
  storageFetches.length = 0
  downloads.length = 0
  vi.stubGlobal('fetch', fetchMock)
  setDocumentStorage({
    download: async (loc) => { downloads.push(loc); return CSV },
    remove: async () => {},
    signedUrl: async () => null,
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  setDocumentStorage(null)
})

const row = (fileUrl: string | null, extra: Record<string, unknown> = {}) => ({
  id: DOC_ID, user_id: ME, file_name: 'patients.csv', file_url: fileUrl, doc_type: 'patient_base', storage_bucket: null, storage_path: null, ...extra,
})

async function validate() {
  const { POST } = await import('@/app/api/medical/intake/validate/route')
  return POST(new NextRequest('http://localhost/api/medical/intake/validate', { method: 'POST', body: JSON.stringify({ documentId: DOC_ID }) }))
}
async function audit() {
  const { POST } = await import('@/app/api/medical/audit/run/route')
  return POST(new NextRequest('http://localhost/api/medical/audit/run', { method: 'POST', body: JSON.stringify({ documentId: DOC_ID }) }))
}

describe.each([['intake/validate', validate], ['audit/run', audit]])('/api/medical/%s — storage object ownership', (_name, call) => {
  it.each([
    [`${VICTIM}/medical/patients.csv`],
    [`${ME}/../${VICTIM}/medical/patients.csv`],
    [`https://sb.example/storage/v1/object/public/documents/${VICTIM}/medical/patients.csv`],
  ])('refuses an object outside the caller folder (%s) without downloading it', async (fileUrl) => {
    s.row = row(fileUrl)
    const res = await call()
    expect(res.status).toBe(403)
    expect(storageFetches).toEqual([])
    expect(downloads).toEqual([])
  })

  it('downloads the caller’s own object through the document storage backend', async () => {
    s.row = row(`${ME}/medical/patients.csv`)
    await call()
    expect(downloads).toEqual([{ bucket: 'documents', path: `${ME}/medical/patients.csv` }])
    expect(storageFetches).toEqual([])
  })

  it('new rows resolve from storage_bucket / storage_path', async () => {
    s.row = row(`${ME}/a.csv`, { storage_bucket: 'client-documents', storage_path: `${ME}/a.csv` })
    await call()
    expect(downloads).toEqual([{ bucket: 'client-documents', path: `${ME}/a.csv` }])
  })
})

describe('/api/medical/intake/validate — documentId', () => {
  it('refuses a non-UUID documentId before querying', async () => {
    const { POST } = await import('@/app/api/medical/intake/validate/route')
    const res = await POST(new NextRequest('http://localhost/api/medical/intake/validate', { method: 'POST', body: JSON.stringify({ documentId: 'x&user_id=eq.y' }) }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/rest/v1/documents?id=eq.x'), expect.anything())
  })
})
