/**
 * Idempotent bridge from a parsed public.documents row to the Prisma-backed
 * DocumentSummary/DocumentChunk RAG tables.
 *
 * DocumentSummary.userId is the ownership boundary. clientId is optional:
 * onboarding users do not necessarily have a legacy Prisma Client row, and
 * requiring one made indexing silently skip the normal client-portal path.
 */

import { prisma } from '@/lib/db'
import { hasOpenRouterKey } from '@/lib/ai/openrouter'
import {
  embedAndStoreChunks,
  type EmbedAndStoreResult,
} from '@/lib/documents/embed'
import { boundDocumentText } from '@/lib/documents/text-budget'

const MAX_RAG_TEXT_CHARS = 240_000

export interface IndexDocumentForRetrievalInput {
  documentId: string
  userId: string
  text: string
  fileName?: string | null
}

export interface IndexDocumentForRetrievalResult extends EmbedAndStoreResult {
  summaryId: string | null
}

export async function indexDocumentForRetrieval(
  input: IndexDocumentForRetrievalInput,
): Promise<IndexDocumentForRetrievalResult> {
  const fail = (error: string): IndexDocumentForRetrievalResult => ({
    summaryId: null,
    chunks: 0,
    stored: 0,
    embeddedAt: null,
    error,
  })

  if (process.env.ENABLE_DOCUMENT_EMBEDDINGS === 'false') {
    return fail('document_embeddings_disabled')
  }
  if (!input.documentId) return fail('missing_document_id')
  if (!input.userId) return fail('missing_user_id')
  if (!input.text.trim()) return fail('empty_text')
  if (!hasOpenRouterKey()) return fail('missing_openrouter_key')

  try {
    const ragText = boundDocumentText(input.text, MAX_RAG_TEXT_CHARS)
    // Preserve the legacy Client relation when it exists, but never make it an
    // indexing prerequisite.
    const ownerClient = await prisma.client.findFirst({
      where: { managerId: input.userId },
      select: { id: true },
    }).catch(() => null)

    const metadata = {
      source_document_id: input.documentId,
      file_name: input.fileName ?? null,
    }
    const summary = await prisma.documentSummary.upsert({
      where: { sourceDocumentId: input.documentId },
      update: {
        userId: input.userId,
        metadata,
        ...(ownerClient ? { clientId: ownerClient.id } : {}),
      },
      create: {
        sourceDocumentId: input.documentId,
        userId: input.userId,
        clientId: ownerClient?.id ?? null,
        content: ragText,
        metadata,
      },
      select: { id: true },
    })

    const result = await embedAndStoreChunks(summary.id, ragText, {
      metadata: {
        source_document_id: input.documentId,
        file_name: input.fileName ?? null,
      },
      summaryContent: ragText,
    })
    return { summaryId: summary.id, ...result }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error'
    console.warn('[documents/rag] indexing failed:', message)
    return fail(message)
  }
}
