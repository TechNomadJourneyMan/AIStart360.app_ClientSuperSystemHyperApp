/**
 * Embedding generation for RAG over large documents.
 *
 * Model: OpenAI `text-embedding-3-small` — 1536 dimensions (matches our
 * existing `DocumentChunk.embedding vector(1536)` pgvector column), $0.02
 * per 1M tokens — cheapest option at this quality tier.
 *
 * The existing `lib/documents/chunking.ts` already produces semantic
 * chunks. This file adds the embedding step: chunks → embeddings →
 * DocumentChunk rows (with vector).
 *
 * Not called automatically by Phase 2 extractors — they take the first
 * 40 000 chars directly. This file exists for documents > 40k chars
 * where extractors can opt-in to retrieve relevant chunks before the
 * Sonnet call.
 *
 * Server-only.
 */

const OPENAI_API = 'https://api.openai.com/v1/embeddings'
const DEFAULT_MODEL = 'text-embedding-3-small'
const DEFAULT_DIMENSIONS = 1536

export interface EmbedChunkInput {
  index: number
  content: string
}

export interface EmbeddedChunk extends EmbedChunkInput {
  embedding: number[]
}

export interface EmbedOptions {
  model?: string
  dimensions?: number
  /** Batch size sent to the API. OpenAI max = 2048 input strings. */
  batchSize?: number
}

/**
 * Embed an array of chunks. Returns one embedding per chunk in order.
 * Throws on API errors — callers should try/catch and downgrade to
 * non-RAG path gracefully.
 */
export async function embedChunks(
  chunks: EmbedChunkInput[],
  opts: EmbedOptions = {}
): Promise<EmbeddedChunk[]> {
  if (!chunks.length) return []

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set — embeddings disabled')
  }

  const model = opts.model ?? DEFAULT_MODEL
  const dimensions = opts.dimensions ?? DEFAULT_DIMENSIONS
  const batch = Math.min(opts.batchSize ?? 256, 2048)

  const out: EmbeddedChunk[] = []

  for (let i = 0; i < chunks.length; i += batch) {
    const slice = chunks.slice(i, i + batch)
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: slice.map((c) => c.content.slice(0, 8_000)), // cap per-chunk tokens
        dimensions,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`[embeddings] OpenAI ${res.status}: ${body.slice(0, 300)}`)
    }

    const json = (await res.json()) as {
      data: Array<{ index: number; embedding: number[] }>
    }

    for (const item of json.data) {
      const src = slice[item.index]
      out.push({ ...src, embedding: item.embedding })
    }
  }

  return out
}

/**
 * Cosine similarity between two equal-length vectors.
 * Used for in-memory ranking before DB-side pgvector queries exist.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Rank chunks against a query string (embeds the query, then sorts by
 * cosine similarity). Returns top-k chunks.
 */
export async function retrieveRelevantChunks(params: {
  query: string
  chunks: EmbeddedChunk[]
  k?: number
}): Promise<EmbeddedChunk[]> {
  if (!params.chunks.length) return []

  const [queryEmbedded] = await embedChunks([{ index: 0, content: params.query }])
  const k = params.k ?? 5

  const scored = params.chunks.map((c) => ({
    chunk: c,
    score: cosineSimilarity(c.embedding, queryEmbedded.embedding),
  }))

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map((s) => s.chunk)
}
