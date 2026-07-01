import { inngest } from '@/lib/inngest'
import { createServerClient } from '@/lib/supabase-server'
import { extractFromDocument, type ParsedDataPayload } from '@/lib/documents/extract'

export const parseDocumentFn = inngest.createFunction(
  {
    id: 'parse-document',
    retries: 2,
    // @ts-ignore
    event: 'document/parse',
  },
  // @ts-ignore
  async ({ event, step }: any) => {
    const { document_id, file_url, file_name, mime_type, doc_type } = event.data as {
      document_id: string
      file_url: string
      file_name: string
      mime_type?: string | null
      doc_type: string
    }

    const sb = createServerClient()

    await step.run('mark-processing', async () => {
      await sb
        .from('documents')
        .update({ parse_status: 'processing' })
        .eq('id', document_id)
    })

    try {
      const payload = await step.run('download-and-extract', async () => {
        // Cap the download so a slow/hanging file URL can't stall the parse
        // step indefinitely. Inngest still retries the step on throw.
        const res = await fetch(file_url, { signal: AbortSignal.timeout(60_000) })
        if (!res.ok) {
          throw new Error(`Не удалось скачать файл (HTTP ${res.status})`)
        }
        const arrayBuffer = await res.arrayBuffer()
        const { extraction, rawTextPreview, modelUsed, rawRows, clientRows, classification } =
          await extractFromDocument({
            buffer: Buffer.from(arrayBuffer),
            fileName: file_name,
            mimeType: mime_type ?? null,
            docType: doc_type,
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
        return parsed
      })

      await step.run('save', async () => {
        await sb
          .from('documents')
          .update({
            parse_status: 'parsed',
            parsed_data: payload,
            parse_error: null,
          })
          .eq('id', document_id)
      })

      return { document_id, fields_count: payload.fields.length }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown parse error'
      await step.run('mark-error', async () => {
        await sb
          .from('documents')
          .update({
            parse_status: 'error',
            parse_error: message,
          })
          .eq('id', document_id)
      })
      throw err
    }
  },
)
