export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServerClient } from '@/lib/supabase-server'
import {
  extractFromDocument,
  type ParsedDataPayload,
} from '@/lib/documents/extract'
import { getSessionUser, getSessionRole, isStaffRole } from '@/lib/api-identity'
import { isSupabaseStorageUrl } from '@/lib/upload-url'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createHash } from 'node:crypto'
import {
  ingestDocumentToPointA,
  pointARepositoryError,
} from '@/lib/point-a/model/repository'

// POST /api/v1/onboarding/documents/[id]/process
// Inline document parsing. Fetches the document, parses it, runs LLM extraction,
// and stores the result in documents.parsed_data. Idempotent for in-flight work
// (re-entry while parse_status='processing' is a no-op).
export async function POST(
  req: NextRequest,
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
    .select('id, user_id, company_id, file_url, file_name, file_size, mime_type, doc_type, parse_status, content_hash, period_year, period_quarter')
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

  const force = req.nextUrl.searchParams.get('force') === 'true'
  if (doc.parse_status === 'processing') {
    return NextResponse.json({ ok: true, note: 'already_processing' })
  }
  if (doc.parse_status === 'parsed' && !force) {
    return NextResponse.json({ ok: true, note: 'already_parsed' })
  }

  const { data: claimed, error: claimError } = await sb
    .from('documents')
    .update({
      parse_status: 'processing',
      parse_error: null,
      processing_started_at: new Date().toISOString(),
    })
    .eq('id', doc.id)
    .neq('parse_status', 'processing')
    .select('id')
    .maybeSingle()
  if (claimError) {
    return NextResponse.json({ ok: false, error: claimError.message }, { status: 500 })
  }
  if (!claimed) {
    return NextResponse.json({ ok: true, note: 'already_processing' })
  }

  try {
    const fileRes = await fetch(doc.file_url, {
      signal: AbortSignal.timeout(60_000),
    })
    if (!fileRes.ok) {
      throw new Error(`Не удалось скачать файл (HTTP ${fileRes.status})`)
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer())
    if (buffer.byteLength > 20 * 1024 * 1024) {
      throw new Error('Файл превышает лимит 20 MB')
    }
    const contentHash = createHash('sha256').update(buffer).digest('hex')
    if (doc.content_hash && doc.content_hash !== contentHash) {
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

    const { data: savedDocument, error: updateErr } = await sb
      .from('documents')
      .update({
        parse_status: 'parsed',
        parsed_data: payload,
        parse_error: null,
        processing_started_at: null,
      })
      .eq('id', doc.id)
      .eq('parse_status', 'processing')
      .select('id')
      .maybeSingle()

    if (updateErr) throw new Error(updateErr.message)
    if (!savedDocument) {
      throw new Error('Документ был удалён или обработка была отменена')
    }
    if (!doc.content_hash) {
      const { error: hashUpdateError } = await sb
        .from('documents')
        .update({ content_hash: contentHash })
        .eq('id', doc.id)
      if (hashUpdateError && hashUpdateError.code !== '23505') {
        console.warn('[documents/process] content hash save failed', hashUpdateError.message)
      }
    }

    let pointASync: unknown = null
    if (doc.company_id) {
      try {
        pointASync = await ingestDocumentToPointA(sb, {
          id: doc.id,
          userId: doc.user_id,
          companyId: String(doc.company_id),
          fileName: doc.file_name,
          docType: doc.doc_type,
          parsedData: payload,
          contentHash: doc.content_hash ?? contentHash,
          periodYear: doc.period_year,
          periodQuarter: doc.period_quarter,
        })
      } catch (error) {
        const message = pointARepositoryError(error)
        console.warn('[documents/process] Point A sync failed', message)
        throw new Error(`Point A sync failed: ${message}`)
      }
    }

    // Keep post-response work alive on Vercel. The indexer is idempotent and
    // does not require a legacy Prisma Client row.
    const indexPromise = import('@/lib/documents/rag')
      .then(({ indexDocumentForRetrieval }) => indexDocumentForRetrieval({
        documentId: doc.id,
        userId: doc.user_id,
        text: fullText,
        fileName: doc.file_name,
      }))
      .then((result) => {
        if (result.error && result.error !== 'missing_openrouter_key') {
          console.warn('[documents/process] RAG indexing result', result)
        }
      })
      .catch((error) => {
        console.warn('[documents/process] RAG indexing failed', error)
      })
    try {
      waitUntil(indexPromise)
    } catch {
      // Local/test runtimes may not install Vercel's request context. The
      // promise is already running and the indexer never rejects.
      void indexPromise
    }

    return NextResponse.json({
      ok: true,
      fields_count: payload.fields.length,
      point_a_sync: pointASync,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
    console.error('[documents/process] failed for', doc.id, message)
    await sb
      .from('documents')
      .update({
        parse_status: 'error',
        parse_error: message,
        processing_started_at: null,
      })
      .eq('id', doc.id)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
