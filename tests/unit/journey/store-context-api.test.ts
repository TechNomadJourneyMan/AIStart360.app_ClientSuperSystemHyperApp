import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getJourney,
  patchJourney,
  postJourneyDocument,
  postJourneyMessage,
} from '@/components/journey/api'
import { createEmptyWorkspace } from '@/components/journey/model'
import { usesJourneyBrowserState } from '@/components/journey/Workspace'

const identity = {
  workspaceId: 'store-journey-owner-1',
  accessToken: 'store-context-test-access-token',
}

function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

describe('Journey client Store context', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks every state-bearing Journey request as Store context', async () => {
    const state = createEmptyWorkspace(identity.workspaceId)
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({ state }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await getJourney(identity, state, 'store')
    await patchJourney(identity, state, 'store')
    await postJourneyMessage(identity, state, 'Помоги задать Точку B', 'store')
    await postJourneyDocument(
      identity,
      state,
      new File(['sku,qty\nA,1'], 'inventory.csv', { type: 'text/csv' }),
      'store',
    )

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      '/api/v1/journey/store',
      '/api/v1/journey/store',
      '/api/v1/journey/store/chat',
      '/api/v1/journey/store/documents',
    ])
    for (const [, init] of fetchMock.mock.calls) {
      expect(header(init, 'x-journey-context')).toBe('store')
      expect(header(init, 'x-journey-workspace-id')).toBe(identity.workspaceId)
      expect(header(init, 'x-journey-access-token')).toBe(identity.accessToken)
    }
  })

  it('does not label the default Journey workspace as Store context', async () => {
    const state = createEmptyWorkspace('canonical-journey')
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({ state }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await getJourney({ workspaceId: state.workspaceId }, state)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(header(fetchMock.mock.calls[0]?.[1], 'x-journey-context')).toBeNull()
  })

  it('disables browser identity and state persistence only for Store context', () => {
    expect(usesJourneyBrowserState('store')).toBe(false)
    expect(usesJourneyBrowserState('default')).toBe(true)
  })
})
