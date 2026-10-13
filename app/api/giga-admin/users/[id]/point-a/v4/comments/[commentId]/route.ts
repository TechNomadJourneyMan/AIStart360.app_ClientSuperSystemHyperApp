export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { recordAdminAction } from '@/lib/admin/audit'
import { isUuid } from '@/lib/admin/client-scope'
import { badRequest, guardPointAExpert } from '@/lib/admin/point-a-expert'

/**
 * DELETE /api/giga-admin/users/:id/point-a/v4/comments/:commentId — hide the
 * expert's note (soft delete: deleted_at). Only a note of this user's company.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; commentId: string } }) {
  const g = await guardPointAExpert(req, params.id, 'write')
  if (g.response) return g.response
  const { actor, sb, companyId } = g
  if (!isUuid(params.commentId)) return badRequest('Комментарий не найден', 404)

  const { data, error } = await sb
    .from('point_a_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', params.commentId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .select('id, target_kind, target_key, body')
  if (error) {
    console.error('[giga-admin/point-a/comments] delete failed', error.code ?? '')
    return badRequest('Не удалось удалить комментарий', 500)
  }
  const row = ((data ?? []) as Array<Record<string, unknown>>)[0]
  if (!row) return badRequest('Комментарий не найден', 404)

  await recordAdminAction(actor, {
    action: 'point_a.comment_deleted',
    entityType: 'company', entityId: companyId, targetUserId: params.id,
    oldValue: { targetKind: row.target_kind, targetKey: row.target_key, body: row.body },
    metadata: { commentId: params.commentId },
  }, req)

  return NextResponse.json({ ok: true })
}
