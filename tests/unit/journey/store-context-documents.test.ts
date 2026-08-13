import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveStore: vi.fn(),
  formData: vi.fn(),
}))

vi.mock('@/lib/journey/store-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/store-context')>(
    '@/lib/journey/store-context',
  )
  return { ...actual, resolveStoreJourneyContext: mocks.resolveStore }
})

vi.mock('@/lib/journey/http', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/http')>(
    '@/lib/journey/http',
  )
  return { ...actual, resolveJourneyActor: vi.fn() }
})

import { POST } from '@/app/api/v1/journey/store/documents/route'

describe('POST /api/v1/journey/documents Store context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveStore.mockResolvedValue({
      userId: 'store-owner',
      overview: { source: 'empty' },
    })
  })

  it('authenticates first, then rejects Store document mutation without parsing multipart', async () => {
    const request = new Request('https://example.test/api/v1/journey/documents', {
      method: 'POST',
      headers: { 'x-journey-context': 'store' },
    })
    Object.defineProperty(request, 'formData', { value: mocks.formData })

    const response = await POST(request)

    expect(mocks.resolveStore).toHaveBeenCalledOnce()
    expect(mocks.resolveStore).toHaveBeenCalledWith(request)
    expect(mocks.formData).not.toHaveBeenCalled()
    expect(response.status).toBe(405)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      error: {
        code: 'STORE_JOURNEY_DOCUMENTS_DISABLED',
        message: 'Загрузка файлов в Store Journey отключена. Используйте публикацию Store Control Center.',
      },
    })
  })
})
