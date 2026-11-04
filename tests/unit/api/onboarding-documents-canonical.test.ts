import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const supabase = vi.hoisted(() => {
  const remove = vi.fn()
  return {
    client: {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
      storage: {
        from: vi.fn(() => ({ remove })),
      },
    },
    create: vi.fn(),
    remove,
  }
})
const identity = vi.hoisted(() => ({ getSessionUser: vi.fn() }))
const repository = vi.hoisted(() => ({
  ensureOwnedCompany: vi.fn(),
  deleteDocumentAndRetractPointA: vi.fn(),
}))
const notifications = vi.hoisted(() => ({ notifyAdmins: vi.fn() }))
const inngest = vi.hoisted(() => ({ send: vi.fn() }))
const uploadUrl = vi.hoisted(() => ({ isSupabaseStorageUrl: vi.fn() }))
const prisma = vi.hoisted(() => ({ deleteMany: vi.fn() }))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: supabase.create,
}))
vi.mock('@/lib/api-identity', () => ({
  getSessionUser: identity.getSessionUser,
}))
vi.mock('@/lib/point-a/model/repository', () => ({
  ensureOwnedCompany: repository.ensureOwnedCompany,
  deleteDocumentAndRetractPointA: repository.deleteDocumentAndRetractPointA,
  pointARepositoryError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}))
vi.mock('@/lib/notifications', () => ({
  notifyAdmins: notifications.notifyAdmins,
}))
vi.mock('@/lib/inngest', () => ({
  inngest,
}))
vi.mock('@/lib/upload-url', () => ({
  isSupabaseStorageUrl: uploadUrl.isSupabaseStorageUrl,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    documentSummary: {
      deleteMany: prisma.deleteMany,
    },
  },
}))

import { POST } from '@/app/api/v1/onboarding/documents/route'
import { DELETE } from '@/app/api/v1/onboarding/documents/[id]/route'

const CONTENT_HASH = 'a'.repeat(64)
const FILE_URL =
  'https://project.supabase.co/storage/v1/object/public/documents/user-1/report.pdf'

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    company_id: 'company-requested',
    file_name: 'report.pdf',
    file_url: FILE_URL,
    file_size: 1_024,
    mime_type: 'application/pdf',
    doc_type: 'pl_report',
    period_quarter: 'Q4',
    period_year: 2025,
    content_hash: CONTENT_HASH,
    ...overrides,
  }
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/onboarding/documents',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

function duplicateLookup(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return chain
}

function insertDocument(result: { data: unknown; error: unknown }) {
  const chain = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
  }
  chain.insert.mockReturnValue(chain)
  chain.select.mockReturnValue(chain)
  return chain
}

function documentLookup(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return chain
}

describe('POST /api/v1/onboarding/documents canonical registration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    supabase.create.mockReturnValue(supabase.client)
    supabase.client.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    uploadUrl.isSupabaseStorageUrl.mockReturnValue(true)
    repository.ensureOwnedCompany.mockResolvedValue('company-owned')
    notifications.notifyAdmins.mockResolvedValue(undefined)
    inngest.send.mockResolvedValue({ ids: ['event-1'] })
  })

  it.each([
    [{ file_name: '', file_url: FILE_URL, doc_type: 'pl_report' }, 'Missing required fields'],
    [validBody({ file_name: 'report.exe' }), 'Неподдерживаемый формат файла'],
    [validBody({ doc_type: 'secret_report' }), 'Некорректный тип документа'],
    [validBody({ file_size: 0 }), 'Размер файла должен быть от 1 байта до 20 MB'],
    [validBody({ file_size: 20 * 1024 * 1024 + 1 }), 'Размер файла должен быть от 1 байта до 20 MB'],
    [validBody({ content_hash: 'not-a-sha256' }), 'Некорректный content_hash'],
  ])('rejects invalid registration payload %#', async (body, error) => {
    const response = await POST(postRequest(body))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error })
    expect(repository.ensureOwnedCompany).not.toHaveBeenCalled()
    expect(supabase.client.from).not.toHaveBeenCalled()
  })

  it('rejects a non-Supabase URL before auth and database work', async () => {
    uploadUrl.isSupabaseStorageUrl.mockReturnValue(false)

    const response = await POST(postRequest(validBody()))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'file_url must be a Supabase Storage URL',
    })
    expect(supabase.client.auth.getUser).not.toHaveBeenCalled()
    expect(repository.ensureOwnedCompany).not.toHaveBeenCalled()
  })

  it('requires an authenticated user for a valid payload', async () => {
    supabase.client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const response = await POST(postRequest(validBody()))

    expect(response.status).toBe(401)
    expect(repository.ensureOwnedCompany).not.toHaveBeenCalled()
    expect(supabase.client.from).not.toHaveBeenCalled()
  })

  it('rejects a missing or foreign company before dedup and insert', async () => {
    repository.ensureOwnedCompany.mockRejectedValue(
      new Error('Компания пользователя не найдена'),
    )

    const response = await POST(
      postRequest(validBody({ company_id: 'foreign-company' })),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Компания пользователя не найдена',
    })
    expect(repository.ensureOwnedCompany).toHaveBeenCalledWith(
      supabase.client,
      'user-1',
      'foreign-company',
    )
    expect(supabase.client.from).not.toHaveBeenCalled()
  })

  it('returns the owned existing document when content_hash is already registered', async () => {
    const existing = {
      id: 'document-existing',
      user_id: 'user-1',
      company_id: 'company-owned',
      content_hash: CONTENT_HASH,
    }
    const dedup = duplicateLookup({ data: existing, error: null })
    supabase.client.from.mockReturnValue(dedup)

    const response = await POST(postRequest(validBody()))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      data: existing,
      deduplicated: true,
    })
    expect(dedup.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(dedup.eq).toHaveBeenCalledWith('content_hash', CONTENT_HASH)
    expect(notifications.notifyAdmins).not.toHaveBeenCalled()
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it('persists the verified company and content_hash, ignoring the body user identity', async () => {
    const dedup = duplicateLookup({ data: null, error: null })
    const inserted = {
      id: 'document-new',
      user_id: 'user-1',
      company_id: 'company-owned',
      content_hash: CONTENT_HASH,
    }
    const insert = insertDocument({ data: inserted, error: null })
    supabase.client.from
      .mockReturnValueOnce(dedup)
      .mockReturnValueOnce(insert)

    const response = await POST(
      postRequest(validBody({ user_id: 'attacker-controlled' })),
    )

    expect(response.status).toBe(200)
    expect(insert.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      company_id: 'company-owned',
      file_name: 'report.pdf',
      file_url: FILE_URL,
      file_size: 1_024,
      mime_type: 'application/pdf',
      doc_type: 'pl_report',
      period_quarter: 'Q4',
      period_year: 2025,
      content_hash: CONTENT_HASH,
      parse_status: 'queued',
    })
    expect(await response.json()).toEqual({
      ok: true,
      data: inserted,
    })
    expect(notifications.notifyAdmins).toHaveBeenCalledTimes(1)
    expect(inngest.send).toHaveBeenCalledWith({
      name: 'document/parse',
      data: {
        document_id: 'document-new',
        file_url: FILE_URL,
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        doc_type: 'pl_report',
        user_id: 'user-1',
      },
    })
  })

  it('recovers a content_hash uniqueness race as a deduplicated success', async () => {
    const preflight = duplicateLookup({ data: null, error: null })
    const insert = insertDocument({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    })
    const winner = {
      id: 'document-race-winner',
      user_id: 'user-1',
      content_hash: CONTENT_HASH,
    }
    const raceLookup = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: winner, error: null }),
    }
    raceLookup.select.mockReturnValue(raceLookup)
    raceLookup.eq.mockReturnValue(raceLookup)
    supabase.client.from
      .mockReturnValueOnce(preflight)
      .mockReturnValueOnce(insert)
      .mockReturnValueOnce(raceLookup)

    const response = await POST(postRequest(validBody()))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      data: winner,
      deduplicated: true,
    })
    expect(raceLookup.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(raceLookup.eq).toHaveBeenCalledWith(
      'content_hash',
      CONTENT_HASH,
    )
  })
})

describe('DELETE /api/v1/onboarding/documents/[id] canonical cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    supabase.create.mockReturnValue(supabase.client)
    identity.getSessionUser.mockResolvedValue({ id: 'user-1' })
    repository.deleteDocumentAndRetractPointA.mockResolvedValue({
      deleted: true,
      document_id: 'document-1',
      file_url: FILE_URL,
      retraction: { retracted: 2, groups: 1 },
    })
    prisma.deleteMany.mockResolvedValue({ count: 1 })
    supabase.remove.mockResolvedValue({ data: [], error: null })
  })

  it('returns 401 without reading or deleting documents when unauthenticated', async () => {
    identity.getSessionUser.mockResolvedValue(null)

    const response = await DELETE(
      new NextRequest('http://localhost/api/v1/onboarding/documents/document-1?force=true', {
        method: 'DELETE',
      }),
      { params: { id: 'document-1' } },
    )

    expect(response.status).toBe(401)
    expect(supabase.client.from).not.toHaveBeenCalled()
    expect(repository.deleteDocumentAndRetractPointA).not.toHaveBeenCalled()
  })

  it('returns 404 for an absent or foreign document under the ownership filter', async () => {
    const find = documentLookup({
      data: null,
      error: { message: 'not found' },
    })
    supabase.client.from.mockReturnValue(find)

    const response = await DELETE(
      new NextRequest('http://localhost/api/v1/onboarding/documents/foreign', {
        method: 'DELETE',
      }),
      { params: { id: 'foreign' } },
    )

    expect(response.status).toBe(404)
    expect(find.eq).toHaveBeenCalledWith('id', 'foreign')
    expect(find.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(repository.deleteDocumentAndRetractPointA).not.toHaveBeenCalled()
    expect(prisma.deleteMany).not.toHaveBeenCalled()
  })

  it('blocks deletion while the document is processing', async () => {
    const find = documentLookup({
      data: {
        id: 'document-1',
        user_id: 'user-1',
        company_id: 'company-1',
        file_url: FILE_URL,
        parse_status: 'processing',
      },
      error: null,
    })
    supabase.client.from.mockReturnValue(find)

    const response = await DELETE(
      new NextRequest('http://localhost/api/v1/onboarding/documents/document-1', {
        method: 'DELETE',
      }),
      { params: { id: 'document-1' } },
    )

    expect(response.status).toBe(409)
    expect(repository.deleteDocumentAndRetractPointA).not.toHaveBeenCalled()
  })

  it('requires explicit confirmation before retracting confirmed document values', async () => {
    const find = documentLookup({
      data: {
        id: 'document-1',
        user_id: 'user-1',
        company_id: 'company-1',
        file_url: FILE_URL,
        parse_status: 'parsed',
      },
      error: null,
    })
    const source = {
      select: vi.fn(),
      eq: vi.fn(),
      neq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'source-1' },
        error: null,
      }),
    }
    source.select.mockReturnValue(source)
    source.eq.mockReturnValue(source)
    source.neq.mockReturnValue(source)
    const confirmed = {
      select: vi.fn(),
      eq: vi.fn(),
    }
    confirmed.select.mockReturnValue(confirmed)
    confirmed.eq
      .mockReturnValueOnce(confirmed)
      .mockResolvedValueOnce({
        data: [{ field_key: 'finance.net_profit' }],
        error: null,
      })
    supabase.client.from
      .mockReturnValueOnce(find)
      .mockReturnValueOnce(source)
      .mockReturnValueOnce(confirmed)

    const response = await DELETE(
      new NextRequest('http://localhost/api/v1/onboarding/documents/document-1', {
        method: 'DELETE',
      }),
      { params: { id: 'document-1' } },
    )
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.requires_confirmation).toBe(true)
    expect(payload.confirmed_fields).toEqual(['finance.net_profit'])
    expect(repository.deleteDocumentAndRetractPointA).not.toHaveBeenCalled()
  })

  it('deletes the document and retracts its canonical source in one RPC', async () => {
    const find = documentLookup({
      data: {
        id: 'document-1',
        user_id: 'user-1',
        company_id: 'company-1',
        file_url: FILE_URL,
      },
      error: null,
    })
    supabase.client.from.mockReturnValueOnce(find)

    const response = await DELETE(
      new NextRequest('http://localhost/api/v1/onboarding/documents/document-1?force=true', {
        method: 'DELETE',
      }),
      { params: { id: 'document-1' } },
    )

    expect(response.status).toBe(200)
    expect(repository.deleteDocumentAndRetractPointA).toHaveBeenCalledWith(
      supabase.client,
      {
        userId: 'user-1',
        companyId: 'company-1',
        documentId: 'document-1',
        force: true,
      },
    )
    expect(prisma.deleteMany).toHaveBeenCalledWith({
      where: { sourceDocumentId: 'document-1' },
    })
    expect(supabase.client.storage.from).toHaveBeenCalledWith('documents')
    expect(supabase.remove).toHaveBeenCalledWith(['user-1/report.pdf'])
    expect(await response.json()).toEqual({
      ok: true,
      recalculated: true,
    })
  })

  it('stops before document deletion if canonical source retraction fails', async () => {
    const find = documentLookup({
      data: {
        id: 'document-1',
        user_id: 'user-1',
        company_id: 'company-1',
        file_url: FILE_URL,
      },
      error: null,
    })
    supabase.client.from.mockReturnValue(find)
    repository.deleteDocumentAndRetractPointA.mockRejectedValue(
      new Error('recompute failed'),
    )

    const response = await DELETE(
      new NextRequest('http://localhost/api/v1/onboarding/documents/document-1?force=true', {
        method: 'DELETE',
      }),
      { params: { id: 'document-1' } },
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'recompute failed',
    })
    expect(find).not.toHaveProperty('delete')
    expect(prisma.deleteMany).not.toHaveBeenCalled()
  })

  it('keeps deletion successful when RAG cleanup fails and still cleans storage', async () => {
    const find = documentLookup({
      data: {
        id: 'document-1',
        user_id: 'user-1',
        company_id: 'company-1',
        file_url: FILE_URL,
      },
      error: null,
    })
    supabase.client.from.mockReturnValueOnce(find)
    prisma.deleteMany.mockRejectedValue(new Error('Prisma unavailable'))
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const response = await DELETE(
      new NextRequest('http://localhost/api/v1/onboarding/documents/document-1?force=true', {
        method: 'DELETE',
      }),
      { params: { id: 'document-1' } },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      recalculated: true,
    })
    expect(consoleWarn).toHaveBeenCalledWith(
      '[documents/delete] RAG cleanup failed',
      expect.any(Error),
    )
    expect(supabase.remove).toHaveBeenCalledWith(['user-1/report.pdf'])
    consoleWarn.mockRestore()
  })
})
