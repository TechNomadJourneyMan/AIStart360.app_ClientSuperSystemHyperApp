import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const dependencies = vi.hoisted(() => ({
  getUser: vi.fn(),
  companyLimit: vi.fn(),
  from: vi.fn(),
  rateLimited: vi.fn(),
  parse: vi.fn(),
  buildPayload: vi.fn(),
  previewDigest: vi.fn(),
  publish: vi.fn(),
  serviceClient: { marker: 'service-client' },
  access: vi.fn(),
  mfa: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: dependencies.getUser },
    from: dependencies.from,
  }),
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => dependencies.serviceClient,
}))

vi.mock('@/lib/rate-limit', () => ({
  isRateLimitedKey: dependencies.rateLimited,
}))

vi.mock('@/lib/store/access', () => ({
  resolveStoreAccess: dependencies.access,
  hasStoreMfaStepUp: dependencies.mfa,
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

vi.mock('@/lib/store/import/publication', () => ({
  STORE_IMPORT_SCHEMA_VERSION: 1,
  buildStorePreviewDigest: dependencies.previewDigest,
  buildStorePublishPayload: dependencies.buildPayload,
  StorePublishValidationError: class StorePublishValidationError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'StorePublishValidationError'
    }
  },
}))

vi.mock('@/lib/store/import/repository', () => ({
  publishStoreImport: dependencies.publish,
  StorePublishRepositoryError: class StorePublishRepositoryError extends Error {
    constructor(public readonly code: string) {
      super(code)
      this.name = 'StorePublishRepositoryError'
    }
  },
}))

import { POST } from '@/app/api/v1/store/imports/publish/route'

const endpoint = 'https://portal.example.kz/api/v1/store/imports/publish'
const idempotencyKey = '5e78b3d0-a4c3-4f47-8cd8-c48c4b7c3221'

function publishRequest(options: {
  origin?: string | null
  sha256?: string
  confirmWarnings?: boolean
  confirmVariants?: boolean
  effectiveDate?: string
  kind?: string
  acceptedRows?: number
  quarantinedRows?: number
} = {}): NextRequest {
  const form = new FormData()
  form.set('file', new File(['safe-spreadsheet'], 'inventory.xlsx'))
  form.set('expectedSha256', options.sha256 ?? 'a'.repeat(64))
  form.set('expectedNormalizedSha256', 'c'.repeat(64))
  form.set('expectedKind', options.kind ?? 'inventory')
  form.set('expectedAcceptedRows', String(options.acceptedRows ?? 1))
  form.set('expectedQuarantinedRows', String(options.quarantinedRows ?? 0))
  form.set('expectedSchemaVersion', '1')
  form.set('confirmWarnings', String(options.confirmWarnings ?? false))
  form.set('confirmVariants', String(options.confirmVariants ?? true))
  if (options.effectiveDate) form.set('effectiveDate', options.effectiveDate)
  const headers = new Headers({ 'idempotency-key': idempotencyKey })
  if (options.origin !== null) headers.set('origin', options.origin ?? 'https://portal.example.kz')
  return new NextRequest(endpoint, { method: 'POST', headers, body: form })
}

const parsedPreview = {
  file: {
    fileName: 'inventory.xlsx',
    format: 'xlsx',
    sizeBytes: 16,
    sha256: 'a'.repeat(64),
  },
  detectedKinds: ['inventory'],
  data: { prices: [], inventory: [{ sku: 'A', name: 'A L' }], sales: [] },
  quarantine: [],
  issues: [],
  sheets: [],
  summary: { acceptedRows: 1, quarantinedRows: 0, skippedRows: 0 },
}

describe('POST /api/v1/store/imports/publish', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    dependencies.companyLimit.mockResolvedValue({ data: [{ id: 'company-1' }], error: null })
    dependencies.from.mockReturnValue({
      select: () => ({
        eq: () => ({ limit: dependencies.companyLimit }),
      }),
    })
    dependencies.rateLimited.mockResolvedValue(false)
    dependencies.access.mockResolvedValue('allowed')
    dependencies.mfa.mockReturnValue(true)
    dependencies.parse.mockReturnValue(parsedPreview)
    dependencies.buildPayload.mockReturnValue({
      importKind: 'inventory',
      scopeKey: 'warehouse:astana',
      effectiveDate: '2026-07-31',
      periodStart: '2026-07-31',
      periodEnd: '2026-07-31',
      rowCount: 1,
      warningCount: 0,
      quarantinedCount: 0,
      rows: [{ variantKey: 'name-v1:test' }],
    })
    dependencies.previewDigest.mockReturnValue('c'.repeat(64))
    dependencies.publish.mockResolvedValue({
      outcome: 'published',
      importRunId: 'run-1',
      importKind: 'inventory',
      scopeKey: 'warehouse:astana',
      rowCount: 1,
      publishedAt: '2026-08-12T12:00:00Z',
      supersededRunId: null,
    })
  })

  it('authenticates before inspecting the state-changing request', async () => {
    dependencies.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await POST(new NextRequest(endpoint, { method: 'POST' }))
    expect(response.status).toBe(401)
    expect(dependencies.from).not.toHaveBeenCalled()
    expect(dependencies.parse).not.toHaveBeenCalled()
  })

  it('denies a valid session whose profile cannot open /store', async () => {
    dependencies.access.mockResolvedValue('forbidden')
    const response = await POST(publishRequest())
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('forbidden')
    expect(dependencies.from).not.toHaveBeenCalled()
    expect(dependencies.parse).not.toHaveBeenCalled()
    expect(dependencies.publish).not.toHaveBeenCalled()
  })

  it('requires MFA step-up before company lookup, parsing, and privileged writes', async () => {
    dependencies.mfa.mockReturnValue(false)
    const response = await POST(publishRequest())
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('mfa_step_up_required')
    expect(dependencies.access).not.toHaveBeenCalled()
    expect(dependencies.from).not.toHaveBeenCalled()
    expect(dependencies.parse).not.toHaveBeenCalled()
    expect(dependencies.publish).not.toHaveBeenCalled()
  })

  it('rejects cross-site requests before parsing or privileged writes', async () => {
    const response = await POST(publishRequest({ origin: 'https://evil.example' }))
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('invalid_origin')
    expect(dependencies.from).not.toHaveBeenCalled()
    expect(dependencies.parse).not.toHaveBeenCalled()
  })

  it('derives user and company on the server and reparses the original file', async () => {
    const response = await POST(publishRequest({ effectiveDate: '2026-07-31' }))
    expect(response.status).toBe(201)
    expect(dependencies.parse).toHaveBeenCalledWith(expect.any(Buffer), 'inventory.xlsx')
    expect(dependencies.buildPayload).toHaveBeenCalledWith(parsedPreview, '2026-07-31')
    expect(dependencies.publish).toHaveBeenCalledWith(
      dependencies.serviceClient,
      expect.objectContaining({
        userId: 'user-1',
        companyId: 'company-1',
        sourceSha256: 'a'.repeat(64),
        sourceFileName: 'store-import-aaaaaaaaaaaa.xlsx',
        idempotencyKey,
      }),
    )
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { outcome: 'published', changed: true, importRunId: 'run-1' },
    })
  })

  it('rejects a changed file or stale preview before calling the RPC', async () => {
    const response = await POST(publishRequest({ sha256: 'b'.repeat(64) }))
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('preview_stale')
    expect(dependencies.buildPayload).not.toHaveBeenCalled()
    expect(dependencies.publish).not.toHaveBeenCalled()
  })

  it('requires explicit warning and variant acknowledgements', async () => {
    dependencies.parse.mockReturnValue({
      ...parsedPreview,
      issues: [{ code: 'synthetic_sku_generated', severity: 'warning', message: 'warning' }],
    })
    const warningResponse = await POST(publishRequest())
    expect(warningResponse.status).toBe(422)
    expect((await warningResponse.json()).error.code).toBe('warnings_confirmation_required')

    dependencies.parse.mockReturnValue(parsedPreview)
    const variantResponse = await POST(publishRequest({ confirmVariants: false }))
    expect(variantResponse.status).toBe(422)
    expect((await variantResponse.json()).error.code).toBe('variants_confirmation_required')
    expect(dependencies.publish).not.toHaveBeenCalled()
  })

  it('returns an idempotent duplicate without claiming data changed', async () => {
    dependencies.publish.mockResolvedValue({
      outcome: 'duplicate',
      importRunId: 'run-1',
      importKind: 'inventory',
      scopeKey: 'warehouse:astana',
      rowCount: 1,
      publishedAt: '2026-08-12T12:00:00Z',
      supersededRunId: null,
    })
    const response = await POST(publishRequest({ effectiveDate: '2026-07-31' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { outcome: 'duplicate', changed: false, importRunId: 'run-1' },
    })
  })

  it('fails closed when the authenticated user has no unique company binding', async () => {
    dependencies.companyLimit.mockResolvedValue({ data: [], error: null })
    const response = await POST(publishRequest())
    expect(response.status).toBe(422)
    expect((await response.json()).error.code).toBe('company_required')
    expect(dependencies.parse).not.toHaveBeenCalled()
    expect(dependencies.publish).not.toHaveBeenCalled()
  })

  it('sanitizes repository errors', async () => {
    const { StorePublishRepositoryError } = await import('@/lib/store/import/repository')
    dependencies.publish.mockRejectedValue(new StorePublishRepositoryError('unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await POST(publishRequest({ effectiveDate: '2026-07-31' }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'store_publish_unavailable',
        message: 'Публикация не выполнена. Предыдущие данные не изменены.',
      },
    })
    consoleError.mockRestore()
  })
})
