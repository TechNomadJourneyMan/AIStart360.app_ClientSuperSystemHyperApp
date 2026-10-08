export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guardClientAccess, isUuid } from '@/lib/admin/client-scope'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { hasPermission } from '@/lib/admin/rbac'

/**
 * DELETE /api/giga-admin/users/:id/comments/:commentId — убрать комментарий.
 * Автор удаляет свой; чужой — только тот, кто управляет пользователями
 * (users.manage: админ). Факт удаления и текст остаются в журнале.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; commentId: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive', 'clients.review'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied
  if (!isUuid(params.commentId)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const sb = createServiceClient()
  const { data: row } = await sb
    .from('expert_comments')
    .select('id, author_id, block_key, text')
    .eq('id', params.commentId)
    .eq('client_id', params.id)
    .maybeSingle()
  const c = row as { id: string; author_id: string; block_key: string | null; text: string } | null
  if (!c) return NextResponse.json({ ok: false, error: 'Комментарий не найден' }, { status: 404 })
  if (c.author_id !== guard.actor.id && !hasPermission(guard.actor.role, 'users.manage')) {
    return NextResponse.json({ ok: false, error: 'Удалить можно только свой комментарий' }, { status: 403 })
  }

  const { error } = await sb.from('expert_comments').delete().eq('id', c.id).eq('client_id', params.id)
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось удалить комментарий' }, { status: 500 })

  await recordAdminAction(guard.actor, {
    action: 'expert.comment_deleted',
    entityType: 'user', entityId: params.id, targetUserId: params.id,
    oldValue: { id: c.id, author_id: c.author_id, block_key: c.block_key, text: c.text },
  }, req)
  return NextResponse.json({ ok: true })
}
