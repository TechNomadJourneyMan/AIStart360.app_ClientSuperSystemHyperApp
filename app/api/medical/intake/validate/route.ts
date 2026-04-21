export const dynamic = 'force-dynamic'

// POST /api/medical/intake/validate  body: { documentId }
// Downloads the patient_base file from Supabase Storage, runs validatePatientBase(),
// returns DataQualityReport. UI shows issues inline after upload.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { validatePatientBase, type DataQualityReport } from '@/lib/data-quality'

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

async function downloadFromStorage(objectPath: string): Promise<ArrayBuffer | null> {
  const { url, key } = srBase()
  const res = await fetch(`${url}/storage/v1/object/documents/${objectPath}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    console.error('[validate] storage download failed', res.status, objectPath)
    return null
  }
  return res.arrayBuffer()
}

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: { documentId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const documentId = body.documentId?.trim()
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })

  // 1. Resolve document → check ownership
  interface DocRow { id: string; user_id: string; file_name: string; file_url: string; doc_type: string }
  const rows = await srGet<DocRow[]>(
    `documents?id=eq.${documentId}&select=id,user_id,file_name,file_url,doc_type&limit=1`,
  )
  const doc = rows?.[0]
  if (!doc) return NextResponse.json({ error: 'document not found' }, { status: 404 })
  if (doc.user_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (doc.doc_type !== 'patient_base') {
    return NextResponse.json({ error: 'document is not a patient_base' }, { status: 400 })
  }

  // 2. Download file
  const buf = await downloadFromStorage(doc.file_url)
  if (!buf) return NextResponse.json({ error: 'failed to download file' }, { status: 500 })

  // 3. Validate
  const report: DataQualityReport = validatePatientBase(buf, doc.file_name)
  return NextResponse.json({ ok: true, data: report })
}
