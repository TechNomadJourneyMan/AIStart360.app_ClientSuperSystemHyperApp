/**
 * lib/ai/retrieval/index.ts — RAG retrieval over the user's own documents.
 *
 * Embeds the query and calls the scoped `match_user_document_chunks` RPC
 * (migration 046). The user id comes from the SERVER session, never the client
 * (Q11 fix: scope by document_summaries.user_id). Null-safe: no OpenRouter key,
 * no embeddings, or an RPC error all degrade to an empty result so the chat
 * simply runs without documents. Spec: 01-ai-chat-rag.md §4.
 */

import { embedWithOpenRouter } from '@/lib/ai/openrouter'
import { createServiceClient } from '@/lib/supabase-service'

export interface RetrievedChunk {
  chunkId: string
  documentId: string
  documentName: string
  content: string
  similarity: number
}

const MAX_CONTEXT_CHARS = 4000

export async function retrieveUserChunks(
  userId: string,
  query: string,
  opts: { limit?: number; minSimilarity?: number } = {},
): Promise<RetrievedChunk[]> {
  if (!userId || !query.trim()) return []

  let vector: number[] | null = null
  try {
    const vectors = await embedWithOpenRouter([query])
    vector = vectors?.[0] ?? null
  } catch {
    return []
  }
  if (!vector) return []

  try {
    const sb = createServiceClient()
    const { data, error } = await sb.rpc('match_user_document_chunks', {
      p_user_id: userId,
      p_query: vector as unknown as string,
      p_limit: opts.limit ?? 6,
      p_min_similarity: opts.minSimilarity ?? 0.25,
    })
    if (error || !Array.isArray(data)) return []

    const chunks: RetrievedChunk[] = (data as Array<{
      chunk_id: string; summary_id: string; document_name: string; content: string; similarity: number
    }>).map((r) => ({
      chunkId: r.chunk_id,
      documentId: r.summary_id,
      documentName: r.document_name,
      content: r.content,
      similarity: r.similarity,
    }))

    // Trim to a total character budget (keep the most similar first).
    const budgeted: RetrievedChunk[] = []
    let total = 0
    for (const ch of chunks) {
      total += ch.content.length
      if (total > MAX_CONTEXT_CHARS && budgeted.length > 0) break
      budgeted.push(ch)
    }
    return budgeted
  } catch {
    return []
  }
}
