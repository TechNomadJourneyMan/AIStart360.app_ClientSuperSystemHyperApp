import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dependencies = vi.hoisted(() => ({
  getUser: vi.fn(),
  load: vi.fn(),
  client: { marker: 'session-client' },
  access: vi.fn(),
  mfa: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    ...dependencies.client,
    auth: { getUser: dependencies.getUser },
  }),
}))

vi.mock('@/lib/store/loader', () => ({
  loadStoreOverview: dependencies.load,
}))

vi.mock('@/lib/store/access', () => ({
  resolveStoreAccess: dependencies.access,
  hasStoreMfaStepUp: dependencies.mfa,
}))

import { GET } from '@/app/api/v1/store/overview/route'

const request = () => new NextRequest('https://portal.example.kz/api/v1/store/overview')

describe('GET /api/v1/store/overview', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    dependencies.load.mockResolvedValue({ source: 'empty', confidence: 'empty' })
    dependencies.access.mockResolvedValue('allowed')
    dependencies.mfa.mockReturnValue(true)
  })

  it('rejects an unauthenticated request', async () => {
    dependencies.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' })
    expect(dependencies.load).not.toHaveBeenCalled()
  })

  it('rejects a session without Store role/status access', async () => {
    dependencies.access.mockResolvedValue('forbidden')
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, error: 'forbidden' })
    expect(dependencies.load).not.toHaveBeenCalled()
  })

  it('requires MFA step-up before access and data queries', async () => {
    dependencies.mfa.mockReturnValue(false)
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, error: 'mfa_step_up_required' })
    expect(dependencies.access).not.toHaveBeenCalled()
    expect(dependencies.load).not.toHaveBeenCalled()
  })

  it('binds the overview to the session user and disables caching', async () => {
    dependencies.load.mockResolvedValueOnce({
      source: 'empty',
      confidence: 'empty',
      analytics: { schemaVersion: 2, timezone: 'Asia/Almaty' },
    })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(dependencies.load).toHaveBeenCalledOnce()
    expect(dependencies.load).toHaveBeenCalledWith(
      expect.objectContaining({ marker: 'session-client' }),
      'user-1',
    )
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        source: 'empty',
        confidence: 'empty',
        analytics: { schemaVersion: 2, timezone: 'Asia/Almaty' },
      },
    })
  })

  it('sanitizes an internal data error', async () => {
    dependencies.load.mockRejectedValue(new Error('database secret detail'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'store_overview_unavailable',
    })
    consoleError.mockRestore()
  })
})
