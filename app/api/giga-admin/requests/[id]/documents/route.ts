export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createServerClient } from '@/lib/supabase-server'

function isSuperAdmin(req: NextRequest): boolean {
  return req.cookies.get('aistart360_role')?.value === 'super_admin'
}

/**
 * GET /api/giga-admin/requests/[id]/documents
 * Returns uploaded documents for a client tied to the given AdminRequest.
 * Looks up the userId from AdminRequest.payload, then fetches from Supabase.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const adminRequest = await prisma.adminRequest.findUnique({
      where: { id: params.id },
    })

    if (!adminRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    const payload = (adminRequest.payload ?? {}) as Record<string, string>
    const userId = payload.userId

    if (!userId) {
      return NextResponse.json({ error: 'No userId in request payload' }, { status: 400 })
    }

    const supabase = createServerClient()

    const { data: documents, error } = await supabase
      .from('documents')
      .select('id, file_name, doc_type, file_size, mime_type, parse_status, uploaded_at, file_url')
      .eq('user_id', userId)
      .order('uploaded_at', { ascending: false })

    if (error) {
      // Table might not exist yet — return empty
      console.warn('[giga-admin/requests/[id]/documents] Supabase error:', error.message)
      return NextResponse.json({ ok: true, data: [] })
    }

    // Generate signed download URLs for each document
    const docsWithUrls = await Promise.all(
      (documents ?? []).map(async (doc) => {
        let downloadUrl = doc.file_url
        if (doc.file_url && !doc.file_url.startsWith('http')) {
          // file_url is a storage path — generate signed URL
          const { data: signed } = await supabase.storage
            .from('client-documents')
            .createSignedUrl(doc.file_url, 3600) // 1 hour
          if (signed?.signedUrl) downloadUrl = signed.signedUrl
        }
        return { ...doc, download_url: downloadUrl }
      })
    )

    return NextResponse.json({ ok: true, data: docsWithUrls })
  } catch (error) {
    console.error('[giga-admin/requests/[id]/documents] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
