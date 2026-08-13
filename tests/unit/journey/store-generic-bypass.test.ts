import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyJourneyState } from '@/lib/journey/demo'

const ACTOR = '5cd75337-ff7a-49df-80ef-7cb63d7fe8c4'
const STORE_WORKSPACE = `journey-store-user-${ACTOR}`

const mocks = vi.hoisted(() => ({ resolveActor: vi.fn() }))

vi.mock('@/lib/journey/http', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey/http')>(
    '@/lib/journey/http',
  )
  return { ...actual, resolveJourneyActor: mocks.resolveActor }
})

import { GET, PATCH } from '@/app/api/v1/journey/route'
import { POST as CHAT } from '@/app/api/v1/journey/chat/route'
import { POST as DOCUMENTS } from '@/app/api/v1/journey/documents/route'

describe('generic Journey Store workspace bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveActor.mockResolvedValue(ACTOR)
  })

  it('rejects the actor Store workspace even without a context header', async () => {
    const response = await GET(new Request('https://example.test/api/v1/journey', {
      headers: {
        'x-journey-workspace-id': STORE_WORKSPACE,
        'x-journey-access-token': 'valid-looking-token-with-enough-entropy',
      },
    }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: 'JOURNEY_FORBIDDEN',
        message: 'Используйте выделенный Store Journey endpoint.',
      },
    })
  })

  it('rejects every reserved Store workspace before anonymous device lookup', async () => {
    mocks.resolveActor.mockResolvedValue(null)
    const foreignWorkspace = 'journey-store-user-someone-else'
    const requests = [
      () => GET(genericRequest('GET', foreignWorkspace)),
      () => PATCH(genericRequest('PATCH', foreignWorkspace)),
      () => CHAT(genericRequest('CHAT', foreignWorkspace)),
      () => DOCUMENTS(genericRequest('DOCUMENTS', foreignWorkspace)),
    ]

    for (const invoke of requests) {
      const response = await invoke()
      expect(response.status).toBe(403)
      expect((await response.json()).error.code).toBe('JOURNEY_FORBIDDEN')
    }
  })
})

function genericRequest(
  kind: 'GET' | 'PATCH' | 'CHAT' | 'DOCUMENTS',
  workspaceId: string,
): Request {
  const headers = {
    'x-journey-workspace-id': workspaceId,
    'x-journey-access-token': 'valid-looking-token-with-enough-entropy',
  }
  if (kind === 'GET' || kind === 'DOCUMENTS') {
    return new Request(`https://example.test/api/v1/journey${kind === 'DOCUMENTS' ? '/documents' : ''}`, {
      method: kind === 'DOCUMENTS' ? 'POST' : 'GET',
      headers,
    })
  }
  const state = createEmptyJourneyState(workspaceId)
  return new Request(`https://example.test/api/v1/journey${kind === 'CHAT' ? '/chat' : ''}`, {
    method: kind === 'CHAT' ? 'POST' : 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      workspaceId,
      state,
      ...(kind === 'CHAT' ? { message: 'Проверка доступа' } : {}),
    }),
  })
}
