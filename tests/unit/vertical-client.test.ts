import { afterEach, describe, expect, it, vi } from 'vitest'
import { persistSelectedVertical } from '@/lib/vertical-client'

describe('persistSelectedVertical', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists the exact selected business type through the authenticated endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, vertical: 'ecommerce' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await persistSelectedVertical('ecommerce')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/organizations/set-vertical', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertical: 'ecommerce' }),
    })
  })

  it('does not silently continue when the profile vertical was not saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'failed to update' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )))

    await expect(persistSelectedVertical('medical')).rejects.toThrow('failed to update')
  })
})
