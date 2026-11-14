export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// The document_intelligence run starts in the background of this request
// (waitUntil) when Inngest is not configured; give it the full budget.
export const maxDuration = 300

import { NextRequest } from 'next/server'
import { handleDocumentFinalize } from '@/lib/documents/finalize-http'
import { withDeadline } from '@/lib/runtime/deadline'

/**
 * POST /api/v1/documents — finalize an upload.
 *
 * The browser uploads the file to the private `client-documents` bucket under
 * its own folder (`<auth uid>/<uuid>.<ext>`), then calls this endpoint:
 *
 *   { storage_path, bucket?: 'client-documents', file_name, doc_type,
 *     period?: { quarter?: 'Q1'..'Q4', year?: 2020..2030 }, company_id? }
 *
 * The server downloads the object (size-capped), checks it (magic bytes,
 * zip/XML bombs, PDF active content), hashes it, deduplicates per company and
 * registers it; processing starts asynchronously (FILE_UPLOADED →
 * document_intelligence agent).
 *
 *   201 { ok: true,  duplicate: false, data: document }
 *   200 { ok: true,  duplicate: true,  data: existing document }
 *   422 { ok: false, rejected: true, code, error, data: document (parse_status 'rejected') }
 *   400 / 401 / 403 / 404 / 409 / 429 / 503 { ok: false, code, error }
 */
async function handlePost(req: NextRequest) {
  return handleDocumentFinalize(req, 'storage_path')
}

/**
 * R-015: on Railway `next start` ignores maxDuration, so the request had no time limit. After
 * 60 s the client gets 504 (DEADLINE_EXCEEDED) and the work below sees its deadline
 * spent (a size-capped download and the file checks; processing itself is async). ROUTE_DEADLINE_MS_DOCUMENTS_FINALIZE overrides it; ROUTE_DEADLINE_DISABLED=1 turns it off.
 */
export const POST = withDeadline(handlePost, { label: 'documents-finalize', ms: 60_000 })
