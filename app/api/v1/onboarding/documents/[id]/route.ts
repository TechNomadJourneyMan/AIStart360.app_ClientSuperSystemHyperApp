export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/api-identity'
import {
  deleteDocumentAndRetractPointA,
  pointARepositoryError,
} from '@/lib/point-a/model/repository'
import { prisma } from '@/lib/db'

/**
 * DELETE /api/v1/onboarding/documents/[id]
 * Deletes a document record and its file from Supabase storage.
 *
 * SECURITY (audit 2026-07-02): identity comes from the Supabase session, not a
 * client-supplied `user_id` query param (was an IDOR — any caller could target
 * another user's document id).
 */
export async function DELETE(
  req: NextRequest,
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
    .select('id, file_url, user_id, company_id, parse_status')
    .eq('id', params.id)
    .eq('user_id', userId)
    .single()

  if (fetchError || !doc) {
    return NextResponse.json({ ok: false, error: 'Document not found' }, { status: 404 })
  }
  if (doc.parse_status === 'processing') {
    return NextResponse.json(
      { ok: false, error: 'Дождитесь завершения обработки документа перед удалением' },
      { status: 409 },
    )
  }

  if (doc.company_id) {
    try {
      if (req.nextUrl.searchParams.get('force') !== 'true') {
        const { data: pointASource, error: sourceLookupError } = await sb
          .from('point_a_sources')
          .select('id')
          .eq('user_id', userId)
          .eq('company_id', doc.company_id)
          .eq('source_type', 'document')
          .eq('native_source_id', doc.id)
          .neq('status', 'deleted')
          .maybeSingle()
        if (sourceLookupError) throw sourceLookupError
        if (pointASource?.id) {
          const { data: confirmed, error: confirmedError } = await sb
            .from('point_a_values')
            .select('field_key')
            .eq('source_id', pointASource.id)
            .eq('status', 'confirmed')
          if (confirmedError) throw confirmedError
          if ((confirmed ?? []).length > 0) {
            return NextResponse.json({
              ok: false,
              error: 'Документ содержит подтверждённые значения. Подтвердите удаление и пересчёт.',
              requires_confirmation: true,
              confirmed_fields: [...new Set((confirmed ?? []).map((value) => value.field_key))],
            }, { status: 409 })
          }
        }
      }
      await deleteDocumentAndRetractPointA(sb, {
        userId,
        companyId: String(doc.company_id),
        documentId: doc.id,
        force: req.nextUrl.searchParams.get('force') === 'true',
      })
    } catch (error) {
      const message = pointARepositoryError(error)
      const requiresConfirmation = message.includes(
        'point_a_confirmed_values_require_force',
      )
      return NextResponse.json(
        {
          ok: false,
          error: requiresConfirmation
            ? 'Документ содержит подтверждённые значения. Подтвердите удаление и пересчёт.'
            : message,
          ...(requiresConfirmation ? { requires_confirmation: true } : {}),
        },
        { status: requiresConfirmation ? 409 : 500 },
      )
    }
  }

  // Legacy rows without a company have no canonical source. Normal rows were
  // already deleted together with their Point A source in one RPC transaction.
  if (!doc.company_id) {
    const { error: deleteError } = await sb
      .from('documents')
      .delete()
      .eq('id', params.id)
      .eq('user_id', userId)

    if (deleteError) {
      return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 })
    }
  }

  await prisma.documentSummary.deleteMany({
    where: { sourceDocumentId: doc.id },
  }).catch((error) => {
    console.warn('[documents/delete] RAG cleanup failed', error)
  })

  if (doc.file_url) {
    try {
      const url = new URL(doc.file_url)
      const match = url.pathname.match(
        /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/,
      )
      if (match) {
        const [, bucket, filePath] = match
        await sb.storage.from(bucket).remove([decodeURIComponent(filePath)])
      }
    } catch (error) {
      console.warn('[documents/delete] storage cleanup failed', error)
    }
  }

  return NextResponse.json({ ok: true, recalculated: Boolean(doc.company_id) })
}
