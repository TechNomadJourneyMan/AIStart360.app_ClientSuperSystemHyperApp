export const dynamic = 'force-dynamic'

export const runtime = 'nodejs'
// Processing may start in the background of this request (waitUntil).
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { handleDocumentFinalize } from '@/lib/documents/finalize-http'
import { dbError } from '@/lib/api-error'
import { CLIENT_DOCUMENT_COLUMNS, parsedDataForList } from '@/lib/documents/status-view'

/** Most recent documents returned by the (polled) list. */
const LIST_LIMIT = 200

// GET /api/v1/onboarding/documents — the caller's own documents (session user).
// user_id is no longer trusted from the query. See technical-audit A5.
// Polled every few seconds while a document is processing, so it returns the
// ClientDocument columns only and parsed_data without its row arrays
// (raw_rows / client_rows can hold thousands of rows).
export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('documents')
    .select(CLIENT_DOCUMENT_COLUMNS)
    .eq('user_id', user.id)
    .order('uploaded_at', { ascending: false })
    .limit(LIST_LIMIT)

  if (error) return dbError('v1/onboarding/documents', error)
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  return NextResponse.json({ ok: true, data: rows.map((row) => ({ ...row, parsed_data: parsedDataForList(row.parsed_data) })) })
}

// POST /api/v1/onboarding/documents — register an uploaded document.
// Backward-compatible front door of POST /api/v1/documents: accepts the old
// body ({ file_url: <Supabase Storage URL>, file_name, doc_type, period_* })
// as well as the new one ({ storage_path, ... }). Both go through the same
// server finalize (owner-folder check, size cap, magic bytes, bomb checks,
// sha256 dedupe); the signed URL is never stored. Processing starts
// asynchronously — POST …/[id]/process is no longer required (it returns the
// already queued task). Response: see app/api/v1/documents/route.ts.
export async function POST(req: NextRequest) {
  return handleDocumentFinalize(req, 'legacy')
}
