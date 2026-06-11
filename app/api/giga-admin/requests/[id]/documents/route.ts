export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { isPrivilegedViewer } from '@/lib/expert-auth'
import { GIGA_COOKIE_NAME, verifyGigaRole } from '@/lib/giga-cookie'

/**
 * GET /api/giga-admin/requests/[id]/documents
 * Returns uploaded documents for a client tied to the given AdminRequest.
 * Looks up the userId from AdminRequest.payload, then fetches from Supabase.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Read access: signed super_admin giga cookie OR Supabase session with expert/admin role
  const cookieRole = verifyGigaRole(req.cookies.get(GIGA_COOKIE_NAME)?.value)
  if (!(await isPrivilegedViewer(cookieRole))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const supabase = createServerClient()

    // Try admin_requests first, then treat id as profile id
    let userId: string | null = null
    const { data: arRow } = await supabase
      .from('admin_requests')
      .select('payload')
      .eq('id', params.id)
      .maybeSingle()

    if (arRow) {
      userId = (arRow.payload as Record<string, string>)?.userId ?? null
    } else {
      // id might be a profile id directly
      userId = params.id
    }

    if (!userId) {
      return NextResponse.json({ ok: true, data: [] })
    }

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
            .from('documents')
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
