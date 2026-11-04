import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findClient: vi.fn(),
  upsertSummary: vi.fn(),
  updateSummary: vi.fn(),
  embed: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    client: { findFirst: mocks.findClient },
    documentSummary: {
      upsert: mocks.upsertSummary,
      update: mocks.updateSummary,
    },
  },
}))
vi.mock('@/lib/ai/openrouter', () => ({
  hasOpenRouterKey: () => true,
}))
vi.mock('@/lib/documents/embed', () => ({
  embedAndStoreChunks: mocks.embed,
}))

import { indexDocumentForRetrieval } from '@/lib/documents/rag'

describe('indexDocumentForRetrieval', () => {
  beforeEach(() => {
    delete process.env.ENABLE_DOCUMENT_EMBEDDINGS
    mocks.findClient.mockReset().mockResolvedValue(null)
    mocks.upsertSummary.mockReset().mockResolvedValue({ id: 'summary-1' })
    mocks.updateSummary.mockReset().mockResolvedValue({ id: 'summary-1' })
    mocks.embed.mockReset().mockResolvedValue({
      chunks: 2,
      stored: 2,
      embeddedAt: '2026-07-25T00:00:00.000Z',
    })
  })

  it('indexes an onboarding owner even when no legacy Prisma Client exists', async () => {
    const result = await indexDocumentForRetrieval({
      documentId: 'document-1',
      userId: 'user-1',
      text: 'Revenue was 42 million KZT.',
      fileName: 'pnl.pdf',
    })

    expect(result.stored).toBe(2)
    expect(mocks.upsertSummary).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourceDocumentId: 'document-1' },
      create: expect.objectContaining({
        sourceDocumentId: 'document-1',
        userId: 'user-1',
        clientId: null,
      }),
    }))
    expect(mocks.embed).toHaveBeenCalledWith(
      'summary-1',
      'Revenue was 42 million KZT.',
      expect.any(Object),
    )
  })
})
