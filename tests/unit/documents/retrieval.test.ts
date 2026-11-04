import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/ai/openrouter', () => ({
  OPENROUTER_EMBEDDING_DIMENSIONS: 1536,
  embedWithOpenRouter: mocks.embed,
}))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({ rpc: mocks.rpc }),
}))

import { retrieveUserChunks } from '@/lib/ai/retrieval'

describe('retrieveUserChunks', () => {
  beforeEach(() => {
    mocks.embed.mockReset().mockResolvedValue([new Array(1536).fill(0.25)])
    mocks.rpc.mockReset().mockResolvedValue({ data: [], error: null })
  })

  it('serializes a 1536-d query as a pgvector literal and bounds RPC options', async () => {
    await retrieveUserChunks('user-1', 'revenue trend', {
      limit: 99,
      minSimilarity: -1,
    })

    expect(mocks.rpc).toHaveBeenCalledWith(
      'match_user_document_chunks',
      expect.objectContaining({
        p_user_id: 'user-1',
        p_limit: 20,
        p_min_similarity: 0,
        p_query: expect.stringMatching(/^\[0\.25,/),
      }),
    )
  })

  it('does not call retrieval with a wrong-dimensional provider response', async () => {
    mocks.embed.mockResolvedValue([[0.1, 0.2]])
    await expect(retrieveUserChunks('user-1', 'query')).resolves.toEqual([])
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
