export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import {
  extractFromDocument,
  type ParsedDataPayload,
} from '@/lib/documents/extract'
import { parseDocument } from '@/lib/documents/parse'

// POST /api/v1/onboarding/documents/[id]/process
// Inline document parsing. Fetches the document, parses it, runs LLM extraction,
// and stores the result in documents.parsed_data. Idempotent for in-flight work
// (re-entry while parse_status='processing' is a no-op).
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = createServerClient()

  const { data: doc, error: fetchErr } = await sb
    .from('documents')
    .select('id, file_url, file_name, mime_type, doc_type, parse_status')
    .eq('id', params.id)
    .single()

  if (fetchErr || !doc) {
    return NextResponse.json(
      { ok: false, error: fetchErr?.message ?? 'Документ не найден' },
      { status: 404 },
    )
  }

  if (doc.parse_status === 'processing') {
    return NextResponse.json({ ok: true, note: 'already_processing' })
  }

  await sb
    .from('documents')
    .update({ parse_status: 'processing', parse_error: null })
    .eq('id', doc.id)

  try {
    const fileRes = await fetch(doc.file_url)
    if (!fileRes.ok) {
      throw new Error(`Не удалось скачать файл (HTTP ${fileRes.status})`)
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer())

    const { extraction, rawTextPreview, modelUsed } = await extractFromDocument({
      buffer,
      fileName: doc.file_name,
      mimeType: doc.mime_type,
      docType: doc.doc_type,
    })

    const payload: ParsedDataPayload = {
      summary: extraction.summary,
      fields: extraction.fields,
      raw_text_preview: rawTextPreview,
      extracted_at: new Date().toISOString(),
      model_used: modelUsed,
    }

    const { error: updateErr } = await sb
      .from('documents')
      .update({
        parse_status: 'parsed',
        parsed_data: payload,
        parse_error: null,
      })
      .eq('id', doc.id)

    if (updateErr) throw new Error(updateErr.message)

    // Fire-and-forget: chunk + embed the parsed text into pgvector storage so
    // it becomes available to RAG. Gated behind ENABLE_DOCUMENT_EMBEDDINGS so
    // production traffic doesn't burn embedding credits until we're ready.
    void (async () => {
      if (process.env.ENABLE_DOCUMENT_EMBEDDINGS !== 'true') return
      try {
        const { prisma } = await import('@/lib/db')
        const { embedAndStoreChunks } = await import('@/lib/documents/embed')

        // Best-effort owner → Client lookup. The Supabase `documents.user_id`
        // → `profiles.id` chain doesn't map 1:1 to the Prisma `Client` model
        // in every environment, so we skip silently if no client is found.
        const ownerClient = await prisma.client.findFirst({
          where: { managerId: (doc as { user_id?: string }).user_id ?? '__none__' },
          select: { id: true },
        }).catch(() => null)
        if (!ownerClient) return

        // Re-parse to obtain full text (extract.ts only retains a preview).
        const reFile = await fetch(doc.file_url).catch(() => null)
        if (!reFile || !reFile.ok) return
        const reBuffer = Buffer.from(await reFile.arrayBuffer())
        const parsed = await parseDocument(
          reBuffer,
          doc.file_name,
          doc.mime_type ?? undefined,
        )
        if (!parsed.text?.trim()) return

        const summary = await prisma.documentSummary.create({
          data: {
            clientId: ownerClient.id,
            content: parsed.text,
            metadata: { source_document_id: doc.id },
          },
        })

        const result = await embedAndStoreChunks(summary.id, parsed.text)
        if (result.error) {
          console.warn('[documents/process] embed result', result)
        }
      } catch (e) {
        console.warn('[documents/process] embed failed', e)
      }
    })()

    return NextResponse.json({
      ok: true,
      fields_count: payload.fields.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
    console.error('[documents/process] failed for', doc.id, message)
    await sb
      .from('documents')
      .update({ parse_status: 'error', parse_error: message })
      .eq('id', doc.id)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
