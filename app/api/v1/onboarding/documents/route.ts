export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { notifyAdmins } from '@/lib/notifications'
import { inngest } from '@/lib/inngest'
import { isSupabaseStorageUrl } from '@/lib/upload-url'

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
    const { company_id, file_name, file_url, file_size, mime_type, doc_type, period_quarter, period_year } = body

    if (!file_name || !file_url || !doc_type) {
      return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 })
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

    const { data: doc, error } = await sb
      .from('documents')
      .insert({
        user_id,
        company_id: company_id ?? null,
        file_name,
        file_url,
        file_size: file_size ?? null,
        mime_type: mime_type ?? null,
        doc_type,
        period_quarter: period_quarter ?? null,
        period_year: period_year ?? null,
        parse_status: 'queued',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

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
