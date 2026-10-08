import { beforeEach, describe, expect, it, vi } from 'vitest'

const embedWithOpenRouter = vi.fn()
const executeRaw = vi.fn(async () => 1)
const queryRaw = vi.fn(async () => [{ id: 'sum-1' }])

vi.mock('@/lib/ai/openrouter', () => ({
  embedWithOpenRouter: (...a: unknown[]) => embedWithOpenRouter(...a),
  hasOpenRouterKey: () => true,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    $executeRaw: (...a: unknown[]) => executeRaw(...(a as [])),
    $queryRaw: (...a: unknown[]) => queryRaw(...(a as [])),
    client: { findFirst: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/documents/chunking', () => ({
  chunkDocument: async (text: string) =>
    text.split('|').map((content, i) => ({ content, metadata: { i } })),
}))

const USER = '11111111-2222-3333-4444-555555555555'
const vec = () => new Array(1536).fill(0.01)

beforeEach(() => {
  embedWithOpenRouter.mockReset()
  executeRaw.mockClear()
  queryRaw.mockClear()
  embedWithOpenRouter.mockImplementation(async (inputs: string[]) => inputs.map(vec))
})

describe('embedAndStoreChunks', () => {
  it('embeds in batches, tags usage as doc_embed and stores every chunk', async () => {
    const { embedAndStoreChunks } = await import('@/lib/documents/embed')
    const text = Array.from({ length: 40 }, (_, i) => `chunk ${i}`).join('|')
    const r = await embedAndStoreChunks('sum-1', text, { batchSize: 16, userId: USER })
    expect(r).toMatchObject({ chunks: 40, stored: 40 })
    expect(embedWithOpenRouter).toHaveBeenCalledTimes(3)
    expect(embedWithOpenRouter.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([16, 16, 8])
    expect(embedWithOpenRouter.mock.calls[0][1]).toMatchObject({ feature: 'doc_embed', userId: USER, dimensions: 1536 })
    // 1 DELETE + 40 INSERTs
    expect(executeRaw).toHaveBeenCalledTimes(41)
  })

  it('refuses vectors of the wrong dimension (nothing is written)', async () => {
    embedWithOpenRouter.mockImplementation(async (inputs: string[]) => inputs.map(() => [0.1, 0.2]))
    const { embedAndStoreChunks } = await import('@/lib/documents/embed')
    const r = await embedAndStoreChunks('sum-1', 'a|b', { userId: USER })
    expect(r.error).toMatch(/unexpected_dim/)
    expect(executeRaw).not.toHaveBeenCalled()
  })
})

describe('indexDocumentForRetrieval', () => {
  it('creates a user-owned summary without a Prisma client row and embeds it', async () => {
    const { indexDocumentForRetrieval } = await import('@/lib/documents/embed')
    const r = await indexDocumentForRetrieval({ documentId: 'doc-1', userId: USER, text: 'a|b|c' })
    expect(r).toMatchObject({ summaryId: 'sum-1', stored: 3 })
    expect(queryRaw).toHaveBeenCalledTimes(1)
    // clientId is NULL (no Prisma client), owner is the user
    const insertArgs = queryRaw.mock.calls[0] as unknown[]
    expect(insertArgs).toContain(null)
    expect(insertArgs).toContain(USER)
  })
})

describe('estimateEmbeddingCost', () => {
  it('follows chars × 1.25 / 2.5 tokens at $0.02 per 1M', async () => {
    const { estimateEmbeddingCost } = await import('@/lib/documents/embed')
    expect(estimateEmbeddingCost(1_000_000)).toEqual({ tokens: 500_000, costUsd: 0.01 })
  })
})
