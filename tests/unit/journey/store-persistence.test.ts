import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  filters: [] as Array<[string, unknown]>, inserted: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  data: null as Record<string, unknown> | null,
  error: null as { code?: string; message?: string } | null,
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({
  from: () => {
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { s.filters.push([key, value]); return query },
      maybeSingle: async () => ({ data: s.data, error: s.error }),
      insert: async (data: Record<string, unknown>) => { s.inserted = data; return { error: s.error } },
      update: (data: Record<string, unknown>) => { s.updated = data; return query },
    }
    return query
  },
}) }))

import { emptyStoreOverlay, loadStoreJourneyOverlay, saveStoreJourneyOverlay, storeJourneyWorkspaceId } from '@/lib/journey/store-persistence'
import { JourneyConflictError, JourneyPersistenceUnavailableError } from '@/lib/journey/persistence'

beforeEach(() => { s.filters = []; s.inserted = null; s.updated = null; s.data = null; s.error = null })

describe('isolated Store Journey persistence', () => {
  it('scopes every read to actor and actor/company-derived identity, with no write on a first read', async () => {
    const loaded = await loadStoreJourneyOverlay('owner', 'company')
    expect(loaded).toEqual({ overlay: emptyStoreOverlay('company'), revision: 0 })
    expect(s.filters).toEqual([['workspace_key', storeJourneyWorkspaceId('owner', 'company')], ['user_id', 'owner']])
    expect(s.inserted).toBeNull()
    expect(s.updated).toBeNull()
  })

  it('creates a credential that is never issued, and stores only the dedicated overlay', async () => {
    const overlay = emptyStoreOverlay('company')
    expect(await saveStoreJourneyOverlay('owner', 'company', overlay, 0)).toBe(1)
    expect(s.inserted?.access_token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(s.inserted?.state).toEqual(overlay)
    expect(s.inserted?.facts).toEqual([])
    expect(s.inserted?.widget_state).toEqual([])
    expect(s.inserted?.profile).toEqual({})
  })

  it('uses a compare-and-swap update with the exact expected revision and actor', async () => {
    s.data = { revision: 8 }
    expect(await saveStoreJourneyOverlay('owner', 'company', emptyStoreOverlay('company'), 7)).toBe(8)
    expect(s.filters).toContainEqual(['revision', 7])
    expect(s.filters).toContainEqual(['user_id', 'owner'])
    expect(s.updated?.revision).toBe(8)
  })

  it('does not overwrite when another device created or changed the state', async () => {
    s.error = { code: '23505' }
    await expect(saveStoreJourneyOverlay('owner', 'company', emptyStoreOverlay('company'), 0)).rejects.toBeInstanceOf(JourneyConflictError)
    s.error = null
    s.data = null
    await expect(saveStoreJourneyOverlay('owner', 'company', emptyStoreOverlay('company'), 7)).rejects.toBeInstanceOf(JourneyConflictError)
  })

  it('rejects a mismatched saved scope without erasing or replacing it', async () => {
    s.data = { revision: 4, state: emptyStoreOverlay('other-company') }
    await expect(loadStoreJourneyOverlay('owner', 'company')).rejects.toBeInstanceOf(JourneyPersistenceUnavailableError)
    expect(s.inserted).toBeNull()
    expect(s.updated).toBeNull()
    await expect(saveStoreJourneyOverlay('owner', 'company', emptyStoreOverlay('other-company'), 4)).rejects.toBeInstanceOf(JourneyPersistenceUnavailableError)
  })
})
