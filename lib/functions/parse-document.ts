import { inngest } from '@/lib/inngest'
import { createServiceClient } from '@/lib/supabase-service'
import { extractFromDocument, type ParsedDataPayload } from '@/lib/documents/extract'
import { createHash } from 'node:crypto'
import {
  ingestDocumentToPointA,
  pointARepositoryError,
} from '@/lib/point-a/model/repository'

export const parseDocumentFn = inngest.createFunction(
  {
    id: 'parse-document',
    retries: 2,
    // @ts-ignore
    event: 'document/parse',
  },
  // @ts-ignore
  async ({ event, step }: any) => {
    const { document_id, file_url, file_name, mime_type, doc_type, user_id } = event.data as {
      document_id: string
      file_url: string
      file_name: string
      mime_type?: string | null
      doc_type: string
      user_id?: string | null
    }

    const sb = createServiceClient()

    const sourceDoc = await step.run('load-document', async () => {
      const { data, error } = await sb
        .from('documents')
        .select('id,user_id,company_id,file_url,file_name,mime_type,doc_type,period_year,period_quarter,content_hash,parse_status')
        .eq('id', document_id)
        .single()
      if (error || !data) throw new Error(error?.message ?? 'Документ не найден')
      return data
    })
    if (sourceDoc.parse_status === 'parsed') {
      return { document_id, note: 'already_parsed' }
    }

    const claimed = await step.run('mark-processing', async () => {
      const { data, error } = await sb
        .from('documents')
        .update({
          parse_status: 'processing',
          parse_error: null,
          processing_started_at: new Date().toISOString(),
        })
        .eq('id', document_id)
        .neq('parse_status', 'processing')
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      return Boolean(data)
    })
    if (!claimed) return { document_id, note: 'already_processing' }

    try {
      const extractionResult = await step.run('download-and-extract', async () => {
        // Cap the download so a slow/hanging file URL can't stall the parse
        // step indefinitely. Inngest still retries the step on throw.
        const res = await fetch(sourceDoc.file_url || file_url, {
          signal: AbortSignal.timeout(60_000),
        })
        if (!res.ok) {
          throw new Error(`Не удалось скачать файл (HTTP ${res.status})`)
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        if (buffer.byteLength > 20 * 1024 * 1024) {
          throw new Error('Файл превышает лимит 20 MB')
        }
        const contentHash = createHash('sha256').update(buffer).digest('hex')
        if (sourceDoc.content_hash && sourceDoc.content_hash !== contentHash) {
          throw new Error('Контрольная сумма файла не совпадает с зарегистрированной')
        }
        const {
          extraction,
          rawTextPreview,
          fullText,
          modelUsed,
          rawRows,
          clientRows,
          classification,
        } =
          await extractFromDocument({
            buffer,
            fileName: sourceDoc.file_name || file_name,
            mimeType: sourceDoc.mime_type ?? mime_type ?? null,
            docType: sourceDoc.doc_type || doc_type,
          })
        const parsed: ParsedDataPayload = {
          summary: extraction.summary,
          fields: extraction.fields,
          raw_text_preview: rawTextPreview,
          extracted_at: new Date().toISOString(),
          model_used: modelUsed,
          ...(rawRows && rawRows.length > 0 ? { raw_rows: rawRows } : {}),
          ...(clientRows && clientRows.length > 0 ? { client_rows: clientRows } : {}),
          ...(classification ? { classification } : {}),
        }

        let ownerId = sourceDoc.user_id ?? user_id ?? null
        if (!ownerId) {
          const { data: sourceDoc } = await sb
            .from('documents')
            .select('user_id')
            .eq('id', document_id)
            .maybeSingle()
          ownerId = sourceDoc?.user_id ?? null
        }
        if (ownerId) {
          const { indexDocumentForRetrieval } = await import('@/lib/documents/rag')
          const indexResult = await indexDocumentForRetrieval({
            documentId: document_id,
            userId: ownerId,
            text: fullText,
            fileName: sourceDoc.file_name || file_name,
          })
          if (indexResult.error && indexResult.error !== 'missing_openrouter_key') {
            console.warn('[parse-document] RAG indexing result', indexResult)
          }
        }
        return { parsed, contentHash }
      })

      await step.run('save', async () => {
        const { data: savedDocument, error } = await sb
          .from('documents')
          .update({
            parse_status: 'parsed',
            parsed_data: extractionResult.parsed,
            parse_error: null,
            processing_started_at: null,
          })
          .eq('id', document_id)
          .eq('parse_status', 'processing')
          .select('id')
          .maybeSingle()
        if (error) throw new Error(error.message)
        if (!savedDocument) {
          throw new Error('Документ был удалён или обработка была отменена')
        }

        if (!sourceDoc.content_hash) {
          const { error: hashError } = await sb
            .from('documents')
            .update({ content_hash: extractionResult.contentHash })
            .eq('id', document_id)
          if (hashError && hashError.code !== '23505') {
            console.warn('[parse-document] content hash save failed', hashError.message)
          }
        }
      })

      const pointASync = await step.run('sync-point-a', async () => {
        if (!sourceDoc.company_id) return { skipped: 'missing_company' }
        return ingestDocumentToPointA(sb, {
          id: document_id,
          userId: sourceDoc.user_id,
          companyId: sourceDoc.company_id,
          fileName: sourceDoc.file_name,
          docType: sourceDoc.doc_type,
          parsedData: extractionResult.parsed,
          contentHash: sourceDoc.content_hash ?? extractionResult.contentHash,
          periodYear: sourceDoc.period_year,
          periodQuarter: sourceDoc.period_quarter,
        }).catch((error) => {
          throw new Error(`Point A sync failed: ${pointARepositoryError(error)}`)
        })
      })

      await step.run('mark-complete', async () => {
        const { error } = await sb
          .from('documents')
          .update({
            parse_status: 'parsed',
            parse_error: null,
            processing_started_at: null,
          })
          .eq('id', document_id)
        if (error) throw new Error(error.message)
      })

      return {
        document_id,
        fields_count: extractionResult.parsed.fields.length,
        point_a_sync: pointASync,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown parse error'
      await step.run('mark-error', async () => {
        await sb
          .from('documents')
          .update({
            parse_status: 'error',
            parse_error: message,
            processing_started_at: null,
          })
          .eq('id', document_id)
      })
      throw err
    }
  },
)
