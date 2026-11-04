/**
 * Document → chunks → embeddings → pgvector persistence.
 *
 * The pipeline:
 *   1. Run `chunkDocument(fullText)` (LangChain RecursiveCharacterTextSplitter,
 *      1000-char chunks, 200-char overlap).
 *   2. Embed every chunk via `embedWithOpenRouter` (OpenAI
 *      text-embedding-3-large projected to 1536 dimensions — matches the
 *      `vector(1536)` column on `DocumentChunk`).
 *   3. Delete any pre-existing chunks for `documentSummaryId` (idempotency) and
 *      insert the new ones via raw Prisma SQL (pgvector column is `Unsupported`).
 *
 * Contract:
 *   - Never throws. Every failure mode returns a structured `{ error }` result.
 *   - Idempotent: safe to call multiple times for the same summary id.
 *   - Best-effort: callers fire-and-forget from the API route.
 *
 * Designed to be invoked from
 * `app/api/v1/onboarding/documents/[id]/process/route.ts` post-extraction, behind
 * the `ENABLE_DOCUMENT_EMBEDDINGS` env flag.
 */

import { prisma } from '@/lib/db'
import { chunkDocument } from '@/lib/documents/chunking'
import {
  embedWithOpenRouter,
  hasOpenRouterKey,
  OPENROUTER_EMBEDDING_DIMENSIONS,
  OPENROUTER_EMBEDDING_MODEL,
} from '@/lib/ai/openrouter'

const DEFAULT_BATCH_SIZE = 16
const DEFAULT_MODEL = OPENROUTER_EMBEDDING_MODEL
const EXPECTED_DIM = OPENROUTER_EMBEDDING_DIMENSIONS

export interface EmbedAndStoreResult {
  /** Number of chunks produced by the splitter. */
  chunks: number
  /** Number of chunks actually persisted to `DocumentChunk`. */
  stored: number
  /** ISO timestamp of completion, or `null` if nothing was stored. */
  embeddedAt: string | null
  /** Human-readable failure reason (in English). Absent on success. */
  error?: string
}

/** Serialize a JS number array into a pgvector literal: '[0.123456,0.789012,...]'. */
function toVectorLiteral(vec: number[]): string {
  // Six decimal places balances precision (~6×10⁻⁷) against payload size.
  const parts: string[] = new Array(vec.length)
  for (let i = 0; i < vec.length; i++) {
    const n = vec[i]
    parts[i] = Number.isFinite(n) ? n.toFixed(6) : '0.000000'
  }
  return `[${parts.join(',')}]`
}

/**
 * Chunk `fullText`, embed each chunk, and persist the chunks + embeddings to
 * the `document_chunks` table for the given `DocumentSummary` id.
 *
 * @param documentSummaryId CUID of the parent `DocumentSummary`.
 * @param fullText          The full parsed document text.
 * @param opts.batchSize    OpenRouter embeddings batch size. Default 16.
 * @param opts.model        Embedding model id. Default openai/text-embedding-3-small.
 */
export async function embedAndStoreChunks(
  documentSummaryId: string,
  fullText: string,
  opts?: {
    batchSize?: number
    model?: string
    metadata?: Record<string, unknown>
    /** Persisted atomically with the replacement chunks when provided. */
    summaryContent?: string
  }
): Promise<EmbedAndStoreResult> {
  const failure = (error: string, chunks = 0): EmbedAndStoreResult => ({
    chunks,
    stored: 0,
    embeddedAt: null,
    error,
  })

  try {
    if (!documentSummaryId) return failure('missing_documentSummaryId')
    if (!fullText || !fullText.trim()) return failure('empty_text')
    if (!hasOpenRouterKey()) return failure('missing_openrouter_key')

    const model = opts?.model ?? DEFAULT_MODEL
    const batchSize = Math.max(1, opts?.batchSize ?? DEFAULT_BATCH_SIZE)

    // 1. Chunk.
    const chunks = await chunkDocument(fullText, 1000, 200, {
      ...(opts?.metadata ?? {}),
      embedding_model: model,
      embedding_dimensions: EXPECTED_DIM,
    })
    if (chunks.length === 0) return failure('no_chunks_produced')

    // 2. Embed in batches.
    const vectors: number[][] = new Array(chunks.length)
    for (let i = 0; i < chunks.length; i += batchSize) {
      const slice = chunks.slice(i, i + batchSize)
      const inputs = slice.map((c) => c.content)
      const embeddings = await embedWithOpenRouter(inputs, {
        model,
        dimensions: EXPECTED_DIM,
      })
      if (!embeddings || embeddings.length !== slice.length) {
        return failure(`embed_failed_at_batch_${i}`, chunks.length)
      }
      for (let j = 0; j < slice.length; j++) {
        const v = embeddings[j]
        if (!Array.isArray(v) || v.length !== EXPECTED_DIM) {
          return failure(
            `unexpected_dim ${Array.isArray(v) ? v.length : 'non-array'} expected ${EXPECTED_DIM}`,
            chunks.length,
          )
        }
        vectors[i + j] = v
      }
    }

    // 3. Persist atomically (idempotent: wipe then insert). A failed insert
    // rolls the whole replacement back, preserving the last good index.
    const embeddedAt = new Date()
    await prisma.$transaction(
      async (tx) => {
        // Inline processing and the Inngest backup may finish together. Serialize
        // replacement for one summary so two successful runs cannot duplicate
        // chunks after both observe an empty table.
        // The lock function returns PostgreSQL `void`, which Prisma cannot
        // deserialize. Keep it inside a materialized CTE and return a supported
        // boolean value after the lock has been acquired.
        await tx.$queryRaw<Array<{ locked: boolean }>>`
          WITH acquired AS MATERIALIZED (
            SELECT pg_advisory_xact_lock(hashtext(${documentSummaryId}))
          )
          SELECT true AS locked FROM acquired
        `
        await tx.$executeRaw`
          DELETE FROM "document_chunks" WHERE "documentSummaryId" = ${documentSummaryId}
        `

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]
          const vectorLiteral = toVectorLiteral(vectors[i])
          const metadataJson = JSON.stringify(chunk.metadata ?? {})
          await tx.$executeRaw`
            INSERT INTO "document_chunks" (
              "id",
              "documentSummaryId",
              "content",
              "embedding",
              "metadata",
              "createdAt"
            ) VALUES (
              gen_random_uuid()::text,
              ${documentSummaryId},
              ${chunk.content},
              ${vectorLiteral}::vector,
              ${metadataJson}::jsonb,
              ${embeddedAt}
            )
          `
        }
        if (opts?.summaryContent !== undefined) {
          await tx.$executeRaw`
            UPDATE "document_summaries"
               SET "content" = ${opts.summaryContent}
             WHERE "id" = ${documentSummaryId}
          `
        }
      },
      {
        maxWait: 10_000,
        timeout: 120_000,
      },
    )

    return {
      chunks: chunks.length,
      stored: chunks.length,
      embeddedAt: embeddedAt.toISOString(),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error'
    console.warn('[documents/embed] embedAndStoreChunks failed:', msg)
    return failure(msg)
  }
}
