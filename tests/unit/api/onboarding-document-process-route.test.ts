import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const supabase = vi.hoisted(() => ({
  create: vi.fn(),
  from: vi.fn(),
}))

const identity = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getSessionRole: vi.fn(),
  isStaffRole: vi.fn(),
}))

const rateLimit = vi.hoisted(() => ({
  isRateLimitedKey: vi.fn(),
}))

const uploadUrl = vi.hoisted(() => ({
  isSupabaseStorageUrl: vi.fn(),
}))

const extraction = vi.hoisted(() => ({
  extractFromDocument: vi.fn(),
}))

const repository = vi.hoisted(() => ({
  ingestDocumentToPointA: vi.fn(),
  pointARepositoryError: vi.fn(),
}))

const vercel = vi.hoisted(() => ({
  waitUntil: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: supabase.create,
}))

vi.mock('@/lib/api-identity', () => ({
  getSessionUser: identity.getSessionUser,
  getSessionRole: identity.getSessionRole,
  isStaffRole: identity.isStaffRole,
}))

vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: rateLimit.isRateLimitedKey,
}))

vi.mock('@/lib/upload-url', () => ({
  isSupabaseStorageUrl: uploadUrl.isSupabaseStorageUrl,
}))

vi.mock('@/lib/documents/extract', () => ({
  extractFromDocument: extraction.extractFromDocument,
}))

vi.mock('@/lib/point-a/model/repository', () => ({
  ingestDocumentToPointA: repository.ingestDocumentToPointA,
  pointARepositoryError: repository.pointARepositoryError,
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: vercel.waitUntil,
}))

import { POST } from '@/app/api/v1/onboarding/documents/[id]/process/route'

const FILE_URL =
  'https://project.supabase.co/storage/v1/object/public/documents/user-1/report.pdf'
const FILE_BYTES = Buffer.from('canonical report bytes')
const FILE_HASH = createHash('sha256').update(FILE_BYTES).digest('hex')

interface DocumentRow {
  id: string
  user_id: string
  company_id: string | null
  file_url: string
  file_name: string
  file_size: number
  mime_type: string
  doc_type: string
  parse_status: string
  content_hash: string | null
  period_year: number | null
  period_quarter: string | null
}

interface UpdateCall {
  values: Record<string, unknown>
  id: string | null
}

function document(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 'document-1',
    user_id: 'user-1',
    company_id: 'company-1',
    file_url: FILE_URL,
    file_name: 'report.pdf',
    file_size: FILE_BYTES.byteLength,
    mime_type: 'application/pdf',
    doc_type: 'pl_report',
    parse_status: 'parsed',
    content_hash: FILE_HASH,
    period_year: 2025,
    period_quarter: 'Q4',
    ...overrides,
  }
}

function makeSupabase(
  doc: DocumentRow,
  options: { savedDocument?: { id: string } | null } = {},
) {
  const updates: UpdateCall[] = []

  const client = {
    from: vi.fn((table: string) => {
      expect(table).toBe('documents')
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: doc, error: null }),
          })),
        })),
        update: vi.fn((values: Record<string, unknown>) => {
          const call: UpdateCall = { values, id: null }
          updates.push(call)

          if (values.parse_status === 'processing') {
            const claim = {
              eq: vi.fn((_column: string, id: string) => {
                call.id = id
                return claim
              }),
              neq: vi.fn(() => claim),
              select: vi.fn(() => claim),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: doc.id },
                error: null,
              }),
            }
            return claim
          }

          const update = {
            eq: vi.fn((column: string, id: string) => {
              if (column === 'id') call.id = id
              return update
            }),
            select: vi.fn(() => update),
            maybeSingle: vi.fn().mockResolvedValue({
              data: options.savedDocument === undefined
                ? { id: doc.id }
                : options.savedDocument,
              error: null,
            }),
            then: (
              resolve: (value: { error: null }) => unknown,
            ) => Promise.resolve({ error: null }).then(resolve),
          }
          return update
        }),
      }
    }),
  }

  return { client, updates }
}

function request(force = false) {
  return new NextRequest(
    `http://localhost/api/v1/onboarding/documents/document-1/process${force ? '?force=true' : ''}`,
    { method: 'POST' },
  )
}

describe('POST /api/v1/onboarding/documents/[id]/process', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    identity.getSessionUser.mockResolvedValue({ id: 'user-1' })
    identity.getSessionRole.mockResolvedValue('client')
    identity.isStaffRole.mockReturnValue(false)
    rateLimit.isRateLimitedKey.mockResolvedValue(false)
    uploadUrl.isSupabaseStorageUrl.mockReturnValue(true)
    repository.pointARepositoryError.mockImplementation((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        FILE_BYTES.buffer.slice(
          FILE_BYTES.byteOffset,
          FILE_BYTES.byteOffset + FILE_BYTES.byteLength,
        ),
    }))
  })

  it('does not reprocess an already parsed document without force', async () => {
    const { client, updates } = makeSupabase(document())
    supabase.create.mockReturnValue(client)

    const response = await POST(request(), {
      params: { id: 'document-1' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      note: 'already_parsed',
    })
    expect(updates).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
    expect(extraction.extractFromDocument).not.toHaveBeenCalled()
    expect(repository.ingestDocumentToPointA).not.toHaveBeenCalled()
  })

  it('preserves saved parsed_data when a later Point A sync fails', async () => {
    const { client, updates } = makeSupabase(document())
    supabase.create.mockReturnValue(client)
    extraction.extractFromDocument.mockResolvedValue({
      extraction: {
        summary: 'Extracted report',
        fields: [{ key: 'revenue', label: 'Revenue', value: 42 }],
      },
      rawTextPreview: 'Revenue: 42',
      fullText: 'Revenue: 42',
      modelUsed: 'test-model',
      rawRows: [],
      clientRows: [],
      classification: null,
    })
    repository.ingestDocumentToPointA.mockRejectedValue(
      new Error('canonical database unavailable'),
    )
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await POST(request(true), {
      params: { id: 'document-1' },
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Point A sync failed: canonical database unavailable',
    })
    expect(updates).toHaveLength(3)
    expect(updates[1]).toMatchObject({
      id: 'document-1',
      values: {
        parse_status: 'parsed',
        parsed_data: {
          summary: 'Extracted report',
          fields: [{ key: 'revenue', label: 'Revenue', value: 42 }],
          raw_text_preview: 'Revenue: 42',
          model_used: 'test-model',
        },
        parse_error: null,
        processing_started_at: null,
      },
    })
    expect(updates[2]).toEqual({
      id: 'document-1',
      values: {
        parse_status: 'error',
        parse_error: 'Point A sync failed: canonical database unavailable',
        processing_started_at: null,
      },
    })
    expect(updates[2].values).not.toHaveProperty('parsed_data')

    consoleWarn.mockRestore()
    consoleError.mockRestore()
  })

  it('rejects a downloaded file whose content hash does not match', async () => {
    const { client, updates } = makeSupabase(
      document({ content_hash: 'f'.repeat(64), parse_status: 'pending' }),
    )
    supabase.create.mockReturnValue(client)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await POST(request(), {
      params: { id: 'document-1' },
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Контрольная сумма файла не совпадает с зарегистрированной',
    })
    expect(extraction.extractFromDocument).not.toHaveBeenCalled()
    expect(repository.ingestDocumentToPointA).not.toHaveBeenCalled()
    expect(updates).toHaveLength(2)
    expect(updates[1].values).toEqual({
      parse_status: 'error',
      parse_error: 'Контрольная сумма файла не совпадает с зарегистрированной',
      processing_started_at: null,
    })
    expect(updates[1].values).not.toHaveProperty('parsed_data')

    consoleError.mockRestore()
  })

  it('does not ingest Point A when the document disappears during processing', async () => {
    const { client, updates } = makeSupabase(document(), { savedDocument: null })
    supabase.create.mockReturnValue(client)
    extraction.extractFromDocument.mockResolvedValue({
      extraction: {
        summary: 'Extracted report',
        fields: [{ key: 'revenue', label: 'Revenue', value: 42 }],
      },
      rawTextPreview: 'Revenue: 42',
      fullText: 'Revenue: 42',
      modelUsed: 'test-model',
      rawRows: [],
      clientRows: [],
      classification: null,
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await POST(request(true), {
      params: { id: 'document-1' },
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Документ был удалён или обработка была отменена',
    })
    expect(repository.ingestDocumentToPointA).not.toHaveBeenCalled()
    expect(updates.at(-1)?.values).not.toHaveProperty('parsed_data')
    consoleError.mockRestore()
  })
})
