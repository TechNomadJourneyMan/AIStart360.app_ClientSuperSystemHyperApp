/**
 * Document → chunks → embeddings → pgvector persistence.
 *
 * The pipeline:
 *   1. Run `chunkDocument(fullText)` (LangChain RecursiveCharacterTextSplitter,
 *      1000-char chunks, 200-char overlap).
 *   2. Embed every chunk via `embedWithOpenRouter` (OpenAI text-embedding-3-small,
 *      1536 dims — matches the `vector(1536)` column on `DocumentChunk`).
 *   3. Delete any pre-existing chunks for `documentSummaryId` (idempotency) and
 *      insert the new ones via raw Prisma SQL (pgvector column is `Unsupported`).
 *
 * Contract:
 *   - Never throws. Every failure mode returns a structured `{ error }` result.
 *   - Idempotent: safe to call multiple times for the same summary id.
 *   - Best-effort: callers fire-and-forget from the API route.
 *
 * Invoked through `indexDocumentForRetrieval` from
 * `app/api/v1/onboarding/documents/[id]/process/route.ts` post-extraction
 * (behind the `ENABLE_DOCUMENT_EMBEDDINGS` env flag) and from
 * `scripts/backfill-embeddings.ts`. Usage is recorded as feature `doc_embed`.
 */

import { prisma } from '@/lib/db'
import { chunkDocument } from '@/lib/documents/chunking'
import { embedWithOpenRouter, hasOpenRouterKey } from '@/lib/ai/openrouter'

const DEFAULT_BATCH_SIZE = 16
const DEFAULT_MODEL = 'openai/text-embedding-3-small'
const EXPECTED_DIM = 1536

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
  opts?: { batchSize?: number; model?: string; userId?: string | null }
): Promise<EmbedAndStoreResult> {
  const failure = (error: string): EmbedAndStoreResult => ({
    chunks: 0,
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
    const chunks = await chunkDocument(fullText)
    if (chunks.length === 0) return failure('no_chunks_produced')

    // 2. Embed in batches.
    const vectors: number[][] = new Array(chunks.length)
    for (let i = 0; i < chunks.length; i += batchSize) {
      const slice = chunks.slice(i, i + batchSize)
      const inputs = slice.map((c) => c.content)
      const embeddings = await embedWithOpenRouter(inputs, {
        feature: 'doc_embed',
        userId: opts?.userId ?? null,
        model,
        dimensions: EXPECTED_DIM,
      })
      if (!embeddings || embeddings.length !== slice.length) {
        return failure(`embed_failed_at_batch_${i}`)
      }
      for (let j = 0; j < slice.length; j++) {
        const v = embeddings[j]
        if (!Array.isArray(v) || v.length !== EXPECTED_DIM) {
          return failure(
            `unexpected_dim ${Array.isArray(v) ? v.length : 'non-array'} expected ${EXPECTED_DIM}`
          )
        }
        vectors[i + j] = v
      }
    }

    // 3. Persist (idempotent: wipe then insert).
    await prisma.$executeRaw`
      DELETE FROM "document_chunks" WHERE "documentSummaryId" = ${documentSummaryId}
    `

    let stored = 0
    const embeddedAt = new Date()
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const vec = vectors[i]
      const vectorLiteral = toVectorLiteral(vec)
      const metadataJson = JSON.stringify(chunk.metadata ?? {})
      try {
        await prisma.$executeRaw`
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
        stored += 1
      } catch (insertErr) {
        console.warn(
          `[documents/embed] insert failed for chunk ${i}:`,
          insertErr instanceof Error ? insertErr.message : insertErr
        )
      }
    }

    if (stored === 0) return failure('no_chunks_stored')

    return {
      chunks: chunks.length,
      stored,
      embeddedAt: embeddedAt.toISOString(),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error'
    console.warn('[documents/embed] embedAndStoreChunks failed:', msg)
    return failure(msg)
  }
}

// ─── Document-level indexing (F-073) ─────────────────────────────────────────

export interface IndexDocumentInput {
  /** `documents.id` (Supabase, UUID) — stored in summary metadata for citations. */
  documentId: string
  /** Owner (`documents.user_id`) — scopes RAG retrieval (migration 054). */
  userId: string
  /** Full parsed document text. */
  text: string
}

export interface IndexDocumentResult extends EmbedAndStoreResult {
  summaryId: string | null
}

/**
 * Index one uploaded document for chat retrieval: (re)create its
 * `document_summaries` row owned by `userId` and embed its chunks.
 *
 * Unlike the old inline pipeline this does NOT require a Prisma `clients` row
 * (migration 091 made `clientId` nullable) — that requirement silently skipped
 * every ordinary client, which is why document search stayed empty. Idempotent:
 * a previous summary of the same document (and its chunks, by cascade) is
 * replaced. Never throws.
 */
export async function indexDocumentForRetrieval(input: IndexDocumentInput): Promise<IndexDocumentResult> {
  const fail = (error: string): IndexDocumentResult => ({ summaryId: null, chunks: 0, stored: 0, embeddedAt: null, error })
  try {
    if (!input.documentId || !input.userId) return fail('missing_ids')
    if (!input.text?.trim()) return fail('empty_text')
    if (!hasOpenRouterKey()) return fail('missing_openrouter_key')

    // Best-effort legacy linkage; NULL is fine since migration 091.
    const client = await prisma.client
      .findFirst({ where: { managerId: input.userId }, select: { id: true } })
      .catch(() => null)
    const metadataJson = JSON.stringify({ source_document_id: input.documentId })

    await prisma.$executeRaw`
      DELETE FROM "document_summaries" WHERE "metadata"->>'source_document_id' = ${input.documentId}
    `
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "document_summaries" ("id", "clientId", "user_id", "content", "metadata", "createdAt")
      VALUES (gen_random_uuid()::text, ${client?.id ?? null}, ${input.userId}, ${input.text}, ${metadataJson}::jsonb, now())
      RETURNING "id"
    `
    const summaryId = rows?.[0]?.id ?? null
    if (!summaryId) return fail('summary_insert_failed')

    const result = await embedAndStoreChunks(summaryId, input.text, { userId: input.userId })
    return { ...result, summaryId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error'
    console.warn('[documents/embed] indexDocumentForRetrieval failed:', msg)
    return fail(msg)
  }
}

/**
 * Rough embedding cost for `chars` of document text with
 * openai/text-embedding-3-small ($0.02 / 1M tokens):
 *   tokens ≈ chars × 1.25 (chunk overlap 200/1000 → ~25% re-embedded) / 2.5
 *            (Cyrillic averages ~2.5 chars per token)
 *   cost   ≈ tokens × 0.02 / 1_000_000
 */
export function estimateEmbeddingCost(chars: number): { tokens: number; costUsd: number } {
  const tokens = Math.ceil((Math.max(0, chars) * 1.25) / 2.5)
  return { tokens, costUsd: Math.round(((tokens * 0.02) / 1_000_000) * 1e6) / 1e6 }
}
