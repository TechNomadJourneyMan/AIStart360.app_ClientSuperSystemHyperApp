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
import { getSessionUser, getSessionRole, isStaffRole } from '@/lib/api-identity'
import { isSupabaseStorageUrl } from '@/lib/upload-url'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { setAiActor } from '@/lib/ai/usage'
import { runInBackground } from '@/lib/background'

// POST /api/v1/onboarding/documents/[id]/process
// Inline document parsing. Fetches the document, parses it, runs LLM extraction,
// and stores the result in documents.parsed_data. Idempotent for in-flight work
// (re-entry while parse_status='processing' is a no-op).
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = createServerClient()

  // SECURITY (audit 2026-07-02): this endpoint fetches doc.file_url server-side
  // and runs a paid LLM extraction. It had NO auth — an attacker could trigger
  // processing (and, via the SSRF in the old insert path, exfiltrate fetched
  // content). Require an authenticated owner (or staff) and throttle per user.
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (await isRateLimitedKey(user.id, 'documents-process', { max: 20, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
  }

  const { data: doc, error: fetchErr } = await sb
    .from('documents')
    .select('id, user_id, file_url, file_name, mime_type, doc_type, parse_status')
    .eq('id', params.id)
    .single()

  if (fetchErr || !doc) {
    return NextResponse.json({ ok: false, error: 'Документ не найден' }, { status: 404 })
  }

  // Owner-or-staff: don't let one user process another user's document.
  if (doc.user_id !== user.id && !isStaffRole(await getSessionRole(sb, user.id))) {
    return NextResponse.json({ ok: false, error: 'Документ не найден' }, { status: 404 })
  }

  // Defense-in-depth: even though insert now validates file_url, re-check before
  // the server-side fetch so a legacy/tampered row can't drive an SSRF.
  if (!isSupabaseStorageUrl(doc.file_url)) {
    return NextResponse.json({ ok: false, error: 'Некорректный источник файла' }, { status: 400 })
  }

  // Attribute the extraction / binding / embedding cost to the document owner.
  setAiActor({ userId: String(doc.user_id), actorId: doc.user_id === user.id ? null : user.id })

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

    const { extraction, rawTextPreview, modelUsed, rawRows, clientRows, classification } =
      await extractFromDocument({
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
      ...(rawRows && rawRows.length > 0 ? { raw_rows: rawRows } : {}),
      ...(clientRows && clientRows.length > 0 ? { client_rows: clientRows } : {}),
      ...(classification ? { classification } : {}),
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

    const ownerUserId = String((doc as { user_id?: string }).user_id ?? '')

    // F-076: suggest survey answers from the extracted metrics (never
    // overwrites a typed answer; the user accepts each one in the wizard).
    let suggestions = 0
    try {
      const { storeDocumentSuggestions } = await import('@/lib/documents/survey-suggestions')
      const { createServiceClient } = await import('@/lib/supabase-service')
      const r = await storeDocumentSuggestions(createServiceClient(), {
        userId: ownerUserId,
        documentId: doc.id,
        fields: payload.fields,
      })
      suggestions = r.stored
    } catch (e) {
      console.warn('[documents/process] suggestions failed (non-fatal)', e instanceof Error ? e.message : e)
    }

    // F-073: chunk + embed the full text for chat retrieval. Gated behind
    // ENABLE_DOCUMENT_EMBEDDINGS; no longer requires a Prisma `clients` row
    // (that silently skipped every ordinary client). Runs in the background.
    if (process.env.ENABLE_DOCUMENT_EMBEDDINGS === 'true' && ownerUserId) {
      void runInBackground('document-embed', async () => {
        try {
          const { indexDocumentForRetrieval } = await import('@/lib/documents/embed')
          // Re-parse to obtain full text (extract.ts only retains a preview).
          const reFile = await fetch(doc.file_url).catch(() => null)
          if (!reFile || !reFile.ok) return
          const reBuffer = Buffer.from(await reFile.arrayBuffer())
          const parsed = await parseDocument(reBuffer, doc.file_name, doc.mime_type ?? undefined)
          if (!parsed.text?.trim()) return
          const result = await indexDocumentForRetrieval({ documentId: doc.id, userId: ownerUserId, text: parsed.text })
          if (result.error) console.warn('[documents/process] embed result', result)
        } catch (e) {
          console.warn('[documents/process] embed failed', e)
        }
      })
    }

    return NextResponse.json({
      ok: true,
      fields_count: payload.fields.length,
      suggestions,
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
