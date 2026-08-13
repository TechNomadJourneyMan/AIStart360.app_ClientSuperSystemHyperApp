import { describe, expect, it } from 'vitest'
import {
  createFailClosedWorkspace,
  requireVerifiedStoreResponse,
  shouldFailClosedJourneyRequest,
} from '@/components/journey/Workspace'
import { createEmptyWorkspace } from '@/components/journey/model'
import { JourneyRequestError } from '@/components/journey/api'

describe('Store Journey fail-closed UI state', () => {
  it('removes all previously rendered business and financial state', () => {
    const hidden = createFailClosedWorkspace(
      'journey-store-user-owner-1',
      'Store access unavailable',
    )

    expect(hidden.phase).toBe('error')
    expect(hidden.companyName).toBe('')
    expect(hidden.businessDescription).toBe('')
    expect(hidden.facts).toEqual([])
    expect(hidden.goals).toEqual([])
    expect(hidden.roadmap).toEqual([])
    expect(hidden.widgets).toEqual([])
    expect(hidden.widgetDecisions ?? []).toEqual([])
    expect(hidden.persistence.mode).toBe('unavailable')
  })

  it('fails closed for Store network, 503, 401 and 403 failures only', () => {
    const failures = [
      new TypeError('network offline'),
      new JourneyRequestError('unavailable', 503),
      new JourneyRequestError('unauthorized', 401),
      new JourneyRequestError('forbidden', 403),
    ]
    for (const failure of failures) {
      expect(shouldFailClosedJourneyRequest('store', failure)).toBe(true)
      expect(shouldFailClosedJourneyRequest('default', failure)).toBe(false)
    }
  })

  it('rejects any Store response that is not confirmed database state', () => {
    const local = createEmptyWorkspace('journey-store-user-owner-1')
    expect(() => requireVerifiedStoreResponse('store', local)).toThrow(
      'Store Journey не подтвердил серверное состояние.',
    )
    expect(() => requireVerifiedStoreResponse('default', local)).not.toThrow()
    expect(() => requireVerifiedStoreResponse('store', {
      ...local,
      persistence: { mode: 'database', label: 'Сохранено в AIStart360' },
    })).not.toThrow()
  })
})
