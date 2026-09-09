import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    auth: { getUser: getUserMock },
  }),
}))

import { POST } from '@/app/api/v1/organizations/set-vertical/route'

const endpoint = 'http://localhost/api/v1/organizations/set-vertical'

function request(vertical: unknown): NextRequest {
  return new NextRequest(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical }),
  })
}

describe('set-vertical route', () => {
  beforeEach(() => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('accepts ecommerce and verifies the exact profile row returned by PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify([{ id: 'user-1', vertical: 'ecommerce' }]),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(request('ecommerce'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, vertical: 'ecommerce' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ vertical: 'ecommerce' })
  })

  it('fails when PostgREST updated no profile row', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify([]),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    const response = await POST(request('medical'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'failed to update' })
  })

  it.each(['constructor', '__proto__', 'store', null])(
    'rejects invalid vertical %j before PATCH',
    async (vertical) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const response = await POST(request(vertical))

      expect(response.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('rejects a JSON null body instead of throwing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const nullRequest = new NextRequest(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    })

    const response = await POST(nullRequest)

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(request('ecommerce'))

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
