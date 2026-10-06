export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/api-identity'
import { countRowsForLocation, deleteDocumentCascade, getDocument, isUuid } from '@/lib/documents/repository'
import { documentStorage, isInOwnerFolder, locationForDocument } from '@/lib/documents/storage'
import { createServerClient } from '@/lib/supabase-server'

/**
 * DELETE /api/v1/onboarding/documents/[id]
 *
 * Deletes a document the caller uploaded, together with everything derived
 * from it:
 *   - the storage object, located by storage_bucket/storage_path (legacy rows:
 *     parsed from file_url — public AND signed URLs, or a bare path); only
 *     objects inside the owner's folder are ever removed;
 *   - RAG summaries (document_summaries; their chunks cascade);
 *   - queued processing tasks (cancelled).
 *
 * SECURITY (audit 2026-07-02): identity comes from the Supabase session, not a
 * client-supplied `user_id` query param.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const doc = isUuid(params.id) ? await getDocument(params.id) : null
  if (!doc || doc.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: 'Document not found' }, { status: 404 })
  }

  let storageRemoved = false
  const loc = locationForDocument(doc)
  if (loc && isInOwnerFolder(loc, doc.user_id)) {
    const shared = doc.storage_bucket ? await countRowsForLocation(loc.bucket, loc.path, doc.id) : 0
    if (shared === 0) {
      try {
        await documentStorage().remove(loc)
        storageRemoved = true
      } catch (err) {
        // Best-effort: the row is still deleted; the orphan is logged.
        console.error('[documents/delete] storage object not removed', doc.id, err instanceof Error ? err.message : err)
      }
    }
  }

  const result = await deleteDocumentCascade(doc.id)
  if (!result.deleted) {
    return NextResponse.json({ ok: false, error: 'Document not found' }, { status: 404 })
  }
  return NextResponse.json({
    ok: true,
    data: { storage_removed: storageRemoved, summaries_deleted: result.summaries, tasks_cancelled: result.tasksCancelled },
  })
}
