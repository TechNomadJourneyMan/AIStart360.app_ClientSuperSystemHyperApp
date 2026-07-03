export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'

/**
 * DELETE /api/v1/onboarding/documents/[id]
 * Deletes a document record and its file from Supabase storage.
 *
 * SECURITY (audit 2026-07-02): identity comes from the Supabase session, not a
 * client-supplied `user_id` query param (was an IDOR — any caller could target
 * another user's document id).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = user.id

  // Fetch the document to get the storage path
  const { data: doc, error: fetchError } = await sb
    .from('documents')
    .select('id, file_url, user_id')
    .eq('id', params.id)
    .eq('user_id', userId)
    .single()

  if (fetchError || !doc) {
    return NextResponse.json({ ok: false, error: 'Document not found' }, { status: 404 })
  }

  // Delete from storage if possible (extract path from URL)
  if (doc.file_url) {
    try {
      const url = new URL(doc.file_url)
      // Supabase storage URL format: .../storage/v1/object/public/<bucket>/<path>
      const match = url.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
      if (match) {
        const [, bucket, filePath] = match
        await sb.storage.from(bucket).remove([filePath])
      }
    } catch {
      // Storage delete is best-effort — continue with DB delete
    }
  }

  // Delete from database
  const { error: deleteError } = await sb
    .from('documents')
    .delete()
    .eq('id', params.id)
    .eq('user_id', userId)

  if (deleteError) {
    return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
