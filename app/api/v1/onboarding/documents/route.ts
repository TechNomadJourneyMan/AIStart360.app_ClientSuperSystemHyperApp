export const dynamic = 'force-dynamic'

export const runtime = 'nodejs'
// Processing may start in the background of this request (waitUntil).
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { handleDocumentFinalize } from '@/lib/documents/finalize-http'
import { dbError } from '@/lib/api-error'

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

  if (error) return dbError('v1/onboarding/documents', error)
  return NextResponse.json({ ok: true, data: data ?? [] })
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
