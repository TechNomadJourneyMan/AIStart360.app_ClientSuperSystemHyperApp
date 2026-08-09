import { describe, expect, it, vi } from 'vitest'
import {
  journeyFetch,
  JourneyRequestError,
} from '@/components/journey/api'

describe('Journey client request deadline', () => {
  it('turns a stalled request into a fail-closed 503 error', async () => {
    const fetchImpl = vi.fn((
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'))
      })
    }))

    await expect(journeyFetch(
      '/api/v1/journey',
      {},
      5,
      fetchImpl as typeof fetch,
    )).rejects.toMatchObject({
      name: 'JourneyRequestError',
      status: 503,
    } satisfies Partial<JourneyRequestError>)
  })

  it('clears the deadline after a successful response', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const response = await journeyFetch(
      '/api/v1/journey',
      {},
      100,
      fetchImpl as typeof fetch,
    )
    expect(response.status).toBe(200)
  })
})
