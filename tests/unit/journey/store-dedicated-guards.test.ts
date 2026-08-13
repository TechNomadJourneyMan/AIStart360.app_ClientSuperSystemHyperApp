import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JourneyAuthenticationError } from '@/lib/journey/http'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  bootstrap: vi.fn(),
  orchestrate: vi.fn(),
  save: vi.fn(),
}))

vi.mock('@/lib/journey/store-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/store-context')>(
    '@/lib/journey/store-context',
  )
  return { ...actual, resolveStoreJourneyContext: mocks.context }
})

vi.mock('@/lib/journey/auth-bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/auth-bootstrap')>(
    '@/lib/journey/auth-bootstrap',
  )
  return { ...actual, resolveNamedOwnedJourneyState: mocks.bootstrap }
})

vi.mock('@/lib/journey/orchestrator', () => ({ orchestrateJourneyTurn: mocks.orchestrate }))
vi.mock('@/lib/journey/persistence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/persistence')>(
    '@/lib/journey/persistence',
  )
  return { ...actual, saveJourneyState: mocks.save }
})

import { GET, PATCH } from '@/app/api/v1/journey/store/route'
import { POST as CHAT } from '@/app/api/v1/journey/store/chat/route'

describe('dedicated Store Journey guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context.mockRejectedValue(new JourneyAuthenticationError('Store session required'))
  })

  it.each([
    ['GET', () => GET(new Request('https://example.test/api/v1/journey/store'))],
    ['PATCH', () => PATCH(new Request('https://example.test/api/v1/journey/store', {
      method: 'PATCH',
      body: '{not parsed',
    }))],
    ['CHAT', () => CHAT(new Request('https://example.test/api/v1/journey/store/chat', {
      method: 'POST',
      body: '{not parsed',
    }))],
  ])('%s fails before workspace bootstrap, body parsing or mutation', async (_label, execute) => {
    const response = await execute()
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.bootstrap).not.toHaveBeenCalled()
    expect(mocks.orchestrate).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
