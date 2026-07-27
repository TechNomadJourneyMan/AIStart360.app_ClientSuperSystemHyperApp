import { createHash } from 'crypto'
import { gateway } from '@ai-sdk/gateway'
import { embedMany } from 'ai'
import { createServerClient } from '@/lib/supabase-server'
import { chunkDocument } from '@/lib/documents/chunking'
import { parseDocument } from '@/lib/documents/parse'
import type { SalesAccessContext } from './access'
import { query, withTransaction } from './database'
import { DomainError } from './errors'
import { KNOWLEDGE_MODELS } from './knowledge-service'

function vectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`
}

function sourceLocator(content: string, chunkIndex: number) {
  const sheetMatches = [...content.matchAll(/\[Sheet:\s*([^\]]+)\]/g)]
  const sheet = sheetMatches.at(-1)?.[1]
  return {
    chunk: chunkIndex,
    ...(sheet ? { sheet } : {}),
  }
}

export async function registerKnowledgeDocument(input: {
  organizationId: string
  fileName: string
  mimeType: string
  storagePath: string
  contentHash: string
  access: SalesAccessContext
}) {
  const existing = await query<{
    id: string
    status: string
    version_number: number
  }>(
    `SELECT id, status, version_number
     FROM knowledge_documents
     WHERE organization_id = $1 AND content_hash = $2
     ORDER BY version_number DESC LIMIT 1`,
    [input.organizationId, input.contentHash],
  )
  if (existing[0]) return { ...existing[0], duplicate: true }

  const rows = await query<{ id: string; status: string; version_number: number }>(
    `INSERT INTO knowledge_documents (
       organization_id, title, document_type, storage_path, content_hash,
       metadata, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     RETURNING id, status, version_number`,
    [
      input.organizationId,
      input.fileName,
      input.fileName.split('.').pop()?.toLowerCase() ?? 'unknown',
      input.storagePath,
      input.contentHash,
      JSON.stringify({ mimeType: input.mimeType, fileName: input.fileName }),
      input.access.actorId,
    ],
  )
  return { ...rows[0], duplicate: false }
}

export async function indexKnowledgeDocument(documentId: string) {
  const documents = await query<{
    id: string
    organization_id: string
    storage_path: string | null
    title: string
    metadata: { mimeType?: string }
  }>(
    `SELECT id, organization_id, storage_path, title, metadata
     FROM knowledge_documents WHERE id = $1::uuid`,
    [documentId],
  )
  const document = documents[0]
  if (!document?.storage_path) throw new DomainError('DOCUMENT_NOT_FOUND', 'Документ не найден', 404)

  await query(`UPDATE knowledge_documents SET status = 'parsing', error_message = NULL WHERE id = $1::uuid`, [documentId])
  try {
    const supabase = createServerClient()
    const downloaded = await supabase.storage
      .from('knowledge-documents')
      .download(document.storage_path)
    if (downloaded.error || !downloaded.data) {
      throw new Error(downloaded.error?.message ?? 'Storage download failed')
    }
    const buffer = Buffer.from(await downloaded.data.arrayBuffer())
    const parsed = await parseDocument(buffer, document.title, document.metadata?.mimeType)
    const chunks = await chunkDocument(parsed.text, 1200, 200, {
      documentId,
      organizationId: document.organization_id,
      fileName: document.title,
      documentType: parsed.metadata.type,
    })
    await query(`UPDATE knowledge_documents SET status = 'indexing' WHERE id = $1::uuid`, [documentId])

    let embeddings: Array<number[] | null> = chunks.map(() => null)
    if (process.env.AI_GATEWAY_API_KEY && chunks.length) {
      const embedded: number[][] = []
      for (let index = 0; index < chunks.length; index += 64) {
        const batch = chunks.slice(index, index + 64)
        const result = await embedMany({
          model: gateway.embeddingModel(KNOWLEDGE_MODELS.embedding),
          values: batch.map((chunk) => chunk.content),
          maxParallelCalls: 4,
        })
        embedded.push(...result.embeddings)
      }
      embeddings = embedded
    }

    await withTransaction(async (client) => {
      await client.query(`DELETE FROM knowledge_chunks WHERE document_id = $1::uuid`, [documentId])
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index]
        await client.query(
          `INSERT INTO knowledge_chunks (
             organization_id, document_id, chunk_index, content, embedding,
             source_locator, metadata
           ) VALUES ($1,$2::uuid,$3,$4,$5::vector,$6::jsonb,$7::jsonb)`,
          [
            document.organization_id,
            documentId,
            index,
            chunk.content,
            embeddings[index] ? vectorLiteral(embeddings[index]!) : null,
            JSON.stringify(sourceLocator(chunk.content, index)),
            JSON.stringify(chunk.metadata),
          ],
        )
      }
      await client.query(
        `UPDATE knowledge_documents
         SET status = 'ready', metadata = metadata || $2::jsonb, updated_at = now()
         WHERE id = $1::uuid`,
        [
          documentId,
          JSON.stringify({
            ...parsed.metadata,
            chunks: chunks.length,
            embeddingModel: embeddings.some(Boolean) ? KNOWLEDGE_MODELS.embedding : null,
          }),
        ],
      )
      await client.query(
        `INSERT INTO outbox_events (
           organization_id, event_type, entity_type, entity_id, actor_id, payload
         ) SELECT organization_id, 'knowledge.document.indexed', 'knowledge_document',
           id::text, created_by, jsonb_build_object('chunks', $2::int)
         FROM knowledge_documents WHERE id = $1::uuid`,
        [documentId, chunks.length],
      )
    })
    return { documentId, chunks: chunks.length, status: 'ready' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Indexing failed'
    await query(
      `UPDATE knowledge_documents
       SET status = 'failed', error_message = $2, updated_at = now()
       WHERE id = $1::uuid`,
      [documentId, message.slice(0, 2000)],
    )
    throw error
  }
}

export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
