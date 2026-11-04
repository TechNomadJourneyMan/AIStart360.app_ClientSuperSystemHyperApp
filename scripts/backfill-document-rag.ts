/**
 * One-time/repeatable RAG backfill for already parsed documents.
 *
 * Usage:
 *   npx tsx scripts/backfill-document-rag.ts
 *   npx tsx scripts/backfill-document-rag.ts --limit=20
 *
 * Uses server-side env credentials already required by the app. It never logs
 * file contents, embeddings, URLs, or credentials. Safe to re-run: summaries
 * upsert by source_document_id and chunks replace atomically.
 */

import { createServiceClient } from '@/lib/supabase-service'
import { isSupabaseStorageUrl } from '@/lib/upload-url'
import { parseDocument } from '@/lib/documents/parse'
import { indexDocumentForRetrieval } from '@/lib/documents/rag'

function readLimit(): number {
  const raw = process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1]
  const parsed = raw ? Number(raw) : 100
  return Number.isFinite(parsed) ? Math.max(1, Math.min(1000, parsed)) : 100
}

async function main(): Promise<void> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('documents')
    .select('id, user_id, file_url, file_name, mime_type, parse_status')
    .in('parse_status', ['parsed', 'completed'])
    .not('parsed_data', 'is', null)
    .order('uploaded_at', { ascending: true })
    .limit(readLimit())

  if (error) throw new Error(`document query failed: ${error.message}`)

  let indexed = 0
  let skipped = 0
  let failed = 0
  for (const doc of data ?? []) {
    if (!doc.user_id || !isSupabaseStorageUrl(doc.file_url)) {
      skipped += 1
      continue
    }
    try {
      const response = await fetch(doc.file_url, {
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) throw new Error(`download_http_${response.status}`)
      const parsed = await parseDocument(
        Buffer.from(await response.arrayBuffer()),
        doc.file_name,
        doc.mime_type ?? undefined,
      )
      const result = await indexDocumentForRetrieval({
        documentId: doc.id,
        userId: doc.user_id,
        text: parsed.text,
        fileName: doc.file_name,
      })
      if (result.error) {
        failed += 1
        console.warn('[backfill-document-rag] failed', {
          documentId: doc.id,
          reason: result.error,
        })
      } else {
        indexed += 1
      }
    } catch (err) {
      failed += 1
      console.warn('[backfill-document-rag] failed', {
        documentId: doc.id,
        reason: err instanceof Error ? err.message : 'unknown_error',
      })
    }
  }

  console.info('[backfill-document-rag] complete', {
    considered: data?.length ?? 0,
    indexed,
    skipped,
    failed,
  })
}

main().catch((err) => {
  console.error('[backfill-document-rag] fatal', err instanceof Error ? err.message : 'unknown_error')
  process.exitCode = 1
})
