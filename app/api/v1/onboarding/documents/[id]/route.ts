export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

/**
 * DELETE /api/v1/onboarding/documents/[id]?user_id=xxx
 * Deletes a document record and its file from Supabase storage.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = req.nextUrl.searchParams.get('user_id')
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'user_id required' }, { status: 400 })
  }

  const sb = createServerClient()

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
