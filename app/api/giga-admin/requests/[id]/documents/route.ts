export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authorizeUserDataRead, resolveRequestUserId } from '@/lib/admin/user-data-access'
import { isInOwnerFolder, locationForDocument } from '@/lib/documents/storage'
import { dbError } from '@/lib/api-error'

/**
 * GET /api/giga-admin/requests/[id]/documents
 * Returns uploaded documents for a client tied to the given AdminRequest.
 * Looks up the userId from AdminRequest.payload, then fetches from Supabase.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await authorizeUserDataRead(req, ['users.view', 'users.sensitive'], (sb) => resolveRequestUserId(sb, params.id))
  if ('response' in access) return access.response

  try {
    const supabase = access.sb
    const userId = access.userId

    if (!userId) {
      return NextResponse.json({ ok: true, data: [] })
    }

    const { data: documents, error } = await supabase
      .from('documents')
      .select('id, user_id, file_name, doc_type, file_size, mime_type, parse_status, uploaded_at, file_url, storage_bucket, storage_path')
      .eq('user_id', userId)
      .order('uploaded_at', { ascending: false })

    // A failed query is an error, never «the client uploaded nothing».
    if (error) return dbError('giga-admin/requests/[id]/documents', error, 'Не удалось загрузить документы клиента.')

    // Short-lived signed download URLs. New rows carry storage_bucket/path
    // (089); legacy rows a Storage URL or a bare path of the `documents` bucket.
    const docsWithUrls = await Promise.all(
      (documents ?? []).map(async (doc) => {
        let downloadUrl: string | null = /^https?:\/\//i.test(doc.file_url ?? '') ? doc.file_url : null
        const loc = locationForDocument(doc)
        if (loc && isInOwnerFolder(loc, doc.user_id)) {
          const { data: signed } = await supabase.storage
            .from(loc.bucket)
            .createSignedUrl(loc.path, 3600) // 1 hour
          if (signed?.signedUrl) downloadUrl = signed.signedUrl
        }
        const { user_id: _owner, storage_bucket: _bucket, storage_path: _path, ...rest } = doc
        return { ...rest, download_url: downloadUrl }
      })
    )

    return NextResponse.json({ ok: true, data: docsWithUrls })
  } catch (error) {
    console.error('[giga-admin/requests/[id]/documents] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
