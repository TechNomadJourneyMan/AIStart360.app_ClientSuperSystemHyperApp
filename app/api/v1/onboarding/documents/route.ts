export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { notifyAdmins } from '@/lib/notifications'
import { inngest } from '@/lib/inngest'
import { isSupabaseStorageUrl } from '@/lib/upload-url'
import {
  ensureOwnedCompany,
  pointARepositoryError,
} from '@/lib/point-a/model/repository'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'xlsx', 'xls', 'csv', 'docx', 'txt', 'md',
  'png', 'jpg', 'jpeg', 'pptx',
])
const ALLOWED_DOC_TYPES = new Set([
  'pl_report', 'balance_sheet', 'marketing_report', 'ops_report',
  'crm_export', 'sales_report', 'client_base', 'patient_base', 'audit', 'other',
])

function fileExtension(fileName: string): string {
  return fileName.toLowerCase().split('.').pop()?.split(/[?#]/, 1)[0] ?? ''
}

// GET /api/v1/onboarding/documents — the caller's own documents (session user).
// user_id is no longer trusted from the query. See technical-audit A5.
export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('documents')
    .select('*')
    .eq('user_id', user.id)
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, data: data ?? [] })
}

// POST /api/v1/onboarding/documents — register a document for the caller.
// user_id comes from the session, never the body. See technical-audit A5.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      company_id,
      file_name,
      file_url,
      file_size,
      mime_type,
      doc_type,
      period_quarter,
      period_year,
      content_hash,
    } = body

    if (
      typeof file_name !== 'string' ||
      typeof file_url !== 'string' ||
      typeof doc_type !== 'string' ||
      !file_name ||
      !file_url
    ) {
      return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 })
    }
    if (!ALLOWED_EXTENSIONS.has(fileExtension(file_name))) {
      return NextResponse.json(
        { ok: false, error: 'Неподдерживаемый формат файла' },
        { status: 400 },
      )
    }
    if (!ALLOWED_DOC_TYPES.has(doc_type)) {
      return NextResponse.json({ ok: false, error: 'Некорректный тип документа' }, { status: 400 })
    }
    if (
      typeof file_size !== 'number' ||
      !Number.isFinite(file_size) ||
      file_size <= 0 ||
      file_size > MAX_FILE_SIZE
    ) {
      return NextResponse.json(
        { ok: false, error: 'Размер файла должен быть от 1 байта до 20 MB' },
        { status: 400 },
      )
    }
    if (typeof content_hash !== 'string' || !/^[a-f0-9]{64}$/i.test(content_hash)) {
      return NextResponse.json({ ok: false, error: 'Некорректный content_hash' }, { status: 400 })
    }

    // SECURITY (audit 2026-07-02): `file_url` is later fetched server-side by the
    // /process pipeline. Constrain it to our own Supabase Storage so it can't be
    // pointed at internal services / cloud-metadata endpoints (SSRF).
    if (!isSupabaseStorageUrl(file_url)) {
      return NextResponse.json({ ok: false, error: 'file_url must be a Supabase Storage URL' }, { status: 400 })
    }

    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    const user_id = user.id
    let ownedCompanyId: string
    try {
      ownedCompanyId = await ensureOwnedCompany(sb, user_id, company_id ?? null)
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: pointARepositoryError(error) },
        { status: 400 },
      )
    }

    const { data: duplicate, error: duplicateError } = await sb
      .from('documents')
      .select('*')
      .eq('user_id', user_id)
      .eq('content_hash', content_hash)
      .maybeSingle()
    if (duplicateError) {
      return NextResponse.json({ ok: false, error: duplicateError.message }, { status: 500 })
    }
    if (duplicate) {
      return NextResponse.json({
        ok: true,
        data: duplicate,
        deduplicated: true,
      })
    }

    const { data: doc, error } = await sb
      .from('documents')
      .insert({
        user_id,
        company_id: ownedCompanyId,
        file_name,
        file_url,
        file_size: file_size ?? null,
        mime_type: mime_type ?? null,
        doc_type,
        period_quarter: period_quarter ?? null,
        period_year: period_year ?? null,
        content_hash,
        parse_status: 'queued',
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        const { data: duplicate } = await sb
          .from('documents')
          .select('*')
          .eq('user_id', user_id)
          .eq('content_hash', content_hash)
          .single()
        if (duplicate) {
          return NextResponse.json({ ok: true, data: duplicate, deduplicated: true })
        }
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    // Notify admins about file upload (fire-and-forget)
    notifyAdmins('file_uploaded', {
      fileName: file_name,
      docType: doc_type,
      fileSize: file_size,
      mimeType: mime_type,
    }, user_id)

    // Best-effort: also queue via Inngest if it's configured (provides retries
    // and observability). Client also fires an inline /process call as the
    // primary path, so Inngest is optional and safe to skip on failure.
    if (doc) {
      try {
        await inngest.send({
          name: 'document/parse',
          data: {
            document_id: doc.id,
            file_url,
            file_name,
            mime_type: mime_type ?? null,
            doc_type,
            user_id,
          },
        })
      } catch (err) {
        console.warn('[documents] inngest send failed (ok — using inline fallback) for doc', doc.id, err)
      }
    }

    return NextResponse.json({ ok: true, data: doc })
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
}
