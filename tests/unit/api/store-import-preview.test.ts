import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const dependencies = vi.hoisted(() => ({
  getUser: vi.fn(),
  parse: vi.fn(),
  rateLimited: vi.fn(),
  access: vi.fn(),
  mfa: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: dependencies.getUser },
  }),
}))

vi.mock('@/lib/store/import/parser', () => ({
  parseStoreImport: dependencies.parse,
  StoreImportError: class StoreImportError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'StoreImportError'
    }
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: dependencies.rateLimited,
}))

vi.mock('@/lib/store/access', () => ({
  resolveStoreAccess: dependencies.access,
  hasStoreMfaStepUp: dependencies.mfa,
}))

import { POST } from '@/app/api/v1/store/imports/preview/route'

const endpoint = 'https://portal.example.kz/api/v1/store/imports/preview'

function multipartRequest(file?: File): NextRequest {
  const form = new FormData()
  if (file) form.set('file', file)
  return new NextRequest(endpoint, { method: 'POST', body: form })
}

describe('POST /api/v1/store/imports/preview', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    dependencies.rateLimited.mockResolvedValue(false)
    dependencies.access.mockResolvedValue('allowed')
    dependencies.mfa.mockReturnValue(true)
    dependencies.parse.mockReturnValue({
      file: {
        fileName: 'prices.xlsx',
        format: 'xlsx',
        sizeBytes: 100,
        sha256: 'a'.repeat(64),
      },
      detectedKinds: ['prices'],
      data: {
        prices: [{
          sku: 'A',
          name: 'HONOR A',
          purchasePrice: 80,
          retailPrice: 100,
          consignmentPrice: null,
          wholesale25Price: null,
          wholesale30Price: null,
        }],
        inventory: [],
        sales: [],
      },
      quarantine: [],
      issues: [],
      sheets: [{
        sheetName: 'Прайс',
        detectedKind: 'prices',
        headerRows: [1],
        columnCount: 7,
        candidateRows: 1,
        acceptedRows: 1,
        quarantinedRows: 0,
        skippedRows: 0,
      }],
      summary: { acceptedRows: 1, quarantinedRows: 0, skippedRows: 0 },
    })
  })

  it('authenticates inside the route before reading the upload', async () => {
    dependencies.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await POST(new NextRequest(endpoint, { method: 'POST' }))
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('unauthorized')
    expect(dependencies.parse).not.toHaveBeenCalled()
  })

  it('denies roles and approval states that cannot open /store', async () => {
    dependencies.access.mockResolvedValue('forbidden')
    const response = await POST(multipartRequest(
      new File(['sku,price\nA,100'], 'prices.csv', { type: 'text/csv' }),
    ))
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('forbidden')
    expect(dependencies.rateLimited).not.toHaveBeenCalled()
    expect(dependencies.parse).not.toHaveBeenCalled()
  })

  it('requires MFA step-up before access checks and upload parsing', async () => {
    dependencies.mfa.mockReturnValue(false)
    const response = await POST(multipartRequest(
      new File(['sku,price\nA,100'], 'prices.csv', { type: 'text/csv' }),
    ))
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('mfa_step_up_required')
    expect(dependencies.access).not.toHaveBeenCalled()
    expect(dependencies.parse).not.toHaveBeenCalled()
  })

  it('requires multipart and a supported spreadsheet extension', async () => {
    const jsonRequest = new NextRequest(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect((await POST(jsonRequest)).status).toBe(415)

    const unsupported = await POST(multipartRequest(
      new File(['secret'], 'bank.pdf', { type: 'application/pdf' }),
    ))
    expect(unsupported.status).toBe(415)
    expect(dependencies.parse).not.toHaveBeenCalled()
  })

  it('rejects oversized requests before materializing multipart data', async () => {
    const response = await POST(new NextRequest(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=test',
        'content-length': String(12 * 1024 * 1024),
      },
      body: '--test--',
    }))
    expect(response.status).toBe(413)
    expect((await response.json()).error.code).toBe('file_too_large')
    expect(dependencies.parse).not.toHaveBeenCalled()
  })

  it('rate-limits CPU-heavy previews per authenticated user', async () => {
    dependencies.rateLimited.mockResolvedValue(true)
    const response = await POST(multipartRequest(
      new File(['sku,price\nA,100'], 'prices.csv', { type: 'text/csv' }),
    ))
    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(dependencies.rateLimited).toHaveBeenCalledWith(
      'user-1',
      'store:import-preview',
      { max: 8, windowMs: 600_000 },
    )
  })

  it('returns a read-only preview without accepting identity from the request', async () => {
    const file = new File(['sku,price\nA,100'], 'prices.csv', { type: 'text/csv' })
    const response = await POST(multipartRequest(file))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { ready: true, kind: 'prices', acceptedRows: 1 },
    })
    expect(dependencies.parse).toHaveBeenCalledOnce()
    expect(dependencies.parse).toHaveBeenCalledWith(expect.any(Buffer), 'prices.csv')
  })

  it('sanitizes parser errors and never echoes sheet contents', async () => {
    dependencies.parse.mockImplementation(() => {
      throw new Error('cell B12 contains account KZ123 and #REF!')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await POST(multipartRequest(
      new File(['danger'], 'sales.xlsx'),
    ))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({
      ok: false,
      error: {
        code: 'store_import_preview_unavailable',
        message: 'Не удалось проверить файл. Данные не сохранены',
      },
    })
    expect(JSON.stringify(body)).not.toContain('KZ123')
    consoleError.mockRestore()
  })

  it('maps known parser limits without exposing parser details', async () => {
    const { StoreImportError } = await import('@/lib/store/import/parser')
    dependencies.parse.mockImplementation(() => {
      throw new StoreImportError('row_limit_exceeded', 'secret row 10001 content')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await POST(multipartRequest(
      new File(['large'], 'inventory.csv', { type: 'text/csv' }),
    ))
    expect(response.status).toBe(413)
    const body = await response.json()
    expect(body.error.code).toBe('spreadsheet_limit_exceeded')
    expect(JSON.stringify(body)).not.toContain('secret row')
    consoleError.mockRestore()
  })
})
