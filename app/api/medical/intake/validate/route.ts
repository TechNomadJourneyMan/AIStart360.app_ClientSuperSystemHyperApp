export const dynamic = 'force-dynamic'

// POST /api/medical/intake/validate  body: { documentId }
// Downloads the patient_base file from Supabase Storage, runs validatePatientBase(),
// returns DataQualityReport. UI shows issues inline after upload.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { validatePatientBase, type DataQualityReport } from '@/lib/data-quality'
import { requireServiceRoleKey } from '@/lib/supabase-service'
import { documentStorage, isInOwnerFolder, locationForDocument, StorageError } from '@/lib/documents/storage'
import { documentMaxBytes } from '@/lib/documents/preflight'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: requireServiceRoleKey(),
  }
}

async function srGet<T>(path: string): Promise<T | null> {
  const { url, key } = srBase()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return (await res.json()) as T
}

/**
 * Download the bytes of the CALLER's own document. The location comes from
 * locationForDocument (storage_bucket/storage_path, a Supabase Storage URL or
 * a bare `documents` path) — never from joining file_url into a URL — and an
 * object outside the caller's `<uid>/` folder is refused: the download runs
 * with the service key, so a row pointing at someone else's object (or a
 * crafted `../` path) must not be readable through this route.
 */
async function downloadOwnDocument(
  doc: { user_id: string; file_url: string | null; storage_bucket?: string | null; storage_path?: string | null },
  userId: string,
): Promise<{ ok: true; buf: Buffer } | { ok: false; status: number; error: string }> {
  const loc = locationForDocument(doc)
  if (!loc || !isInOwnerFolder(loc, userId)) {
    return { ok: false, status: 403, error: 'file is outside your storage folder' }
  }
  try {
    return { ok: true, buf: await documentStorage().download(loc, { maxBytes: documentMaxBytes() }) }
  } catch (err) {
    const code = err instanceof StorageError ? err.code : 'UNAVAILABLE'
    console.error('[medical] storage download failed', code)
    if (code === 'TOO_LARGE') return { ok: false, status: 413, error: 'file too large' }
    if (code === 'NOT_FOUND') return { ok: false, status: 404, error: 'file not found in storage' }
    return { ok: false, status: 500, error: 'failed to download file' }
  }
}

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: { documentId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const documentId = typeof body?.documentId === 'string' ? body.documentId.trim() : ''
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })
  // The id goes into a PostgREST filter: only a UUID may get there.
  if (!UUID_RE.test(documentId)) return NextResponse.json({ error: 'invalid documentId' }, { status: 400 })

  // 1. Resolve document → check ownership
  interface DocRow { id: string; user_id: string; file_name: string; file_url: string | null; doc_type: string; storage_bucket: string | null; storage_path: string | null }
  const rows = await srGet<DocRow[]>(
    `documents?id=eq.${encodeURIComponent(documentId)}&select=id,user_id,file_name,file_url,doc_type,storage_bucket,storage_path&limit=1`,
  )
  const doc = rows?.[0]
  if (!doc) return NextResponse.json({ error: 'document not found' }, { status: 404 })
  if (doc.user_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (doc.doc_type !== 'patient_base') {
    return NextResponse.json({ error: 'document is not a patient_base' }, { status: 400 })
  }

  // 2. Download file
  const dl = await downloadOwnDocument(doc, user.id)
  if (!dl.ok) return NextResponse.json({ error: dl.error }, { status: dl.status })
  const buf = dl.buf

  // 3. Validate
  const report: DataQualityReport = validatePatientBase(buf, doc.file_name)
  return NextResponse.json({ ok: true, data: report })
}
