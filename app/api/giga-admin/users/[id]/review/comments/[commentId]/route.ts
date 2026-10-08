export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isReviewBlockKey, reviewBlockLabel, toStoredBlockKey, type ReviewBlockKey } from '@/lib/expert-review/blocks'
import { COMMENT_COLUMNS, UUID_RE, type CommentRow } from '@/lib/expert-review/server'

/**
 * PUT    /api/giga-admin/users/:id/review/comments/:commentId { text?, block? }
 * DELETE /api/giga-admin/users/:id/review/comments/:commentId
 *
 * Правятся и удаляются только ЧЕРНОВЫЕ комментарии: опубликованное клиент уже
 * видел, его молча не переписываем. Правка ИИ-черновика снимает пометки
 * валидатора — эксперт прочитал и принял текст.
 */

const putSchema = z
  .object({
    text: z.string().trim().min(1, 'Комментарий пустой').max(5000, 'Не больше 5000 символов').optional(),
    block: z.string().refine(isReviewBlockKey, 'Неизвестный блок').optional(),
  })
  .refine((v) => v.text !== undefined || v.block !== undefined, 'Нечего сохранять')

type Ctx = { params: { id: string; commentId: string } }

async function loadDraft(clientId: string, commentId: string): Promise<CommentRow | null | 'published'> {
  const { data } = await createServiceClient()
    .from('expert_comments')
    .select(COMMENT_COLUMNS)
    .eq('id', commentId)
    .eq('client_id', clientId)
    .maybeSingle()
  const row = data as CommentRow | null
  if (!row) return null
  return row.status === 'draft' ? row : 'published'
}

async function guardAll(req: NextRequest, params: Ctx['params']) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return { response: guard.response }
  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.commentId)) {
    return { response: NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 }) }
  }
  const denied = await forbidTarget(guard.actor, params.id)
  if (denied) return { response: denied }
  const row = await loadDraft(params.id, params.commentId)
  if (!row) return { response: NextResponse.json({ ok: false, error: 'Комментарий не найден' }, { status: 404 }) }
  if (row === 'published') {
    return { response: NextResponse.json({ ok: false, error: 'Опубликованный комментарий менять нельзя' }, { status: 409 }) }
  }
  return { actor: guard.actor, row }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const g = await guardAll(req, params)
  if (g.response) return g.response

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверные данные' }, { status: 400 })
  }
  const patch: Record<string, unknown> = { ai_flags: null }
  if (parsed.data.text !== undefined) patch.text = parsed.data.text
  if (parsed.data.block !== undefined) patch.block_key = toStoredBlockKey(parsed.data.block as ReviewBlockKey)

  const { data, error } = await createServiceClient()
    .from('expert_comments')
    .update(patch)
    .eq('id', params.commentId)
    .eq('client_id', params.id)
    .eq('status', 'draft')
    .select(COMMENT_COLUMNS)
    .maybeSingle()
  if (error || !data) return NextResponse.json({ ok: false, error: 'Не удалось сохранить комментарий' }, { status: 500 })

  await recordAdminAction(g.actor, {
    action: 'expert.comment_draft_updated', entityType: 'expert_comment', entityId: params.commentId, targetUserId: params.id,
    oldValue: { text: g.row.text, block_key: g.row.block_key }, newValue: { text: patch.text, block_key: patch.block_key },
  }, req)

  const row = data as CommentRow
  return NextResponse.json({ ok: true, data: { ...row, block_label: reviewBlockLabel(row.block_key) } })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const g = await guardAll(req, params)
  if (g.response) return g.response

  const { error } = await createServiceClient()
    .from('expert_comments')
    .delete()
    .eq('id', params.commentId)
    .eq('client_id', params.id)
    .eq('status', 'draft')
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось удалить комментарий' }, { status: 500 })

  await recordAdminAction(g.actor, {
    action: 'expert.comment_draft_deleted', entityType: 'expert_comment', entityId: params.commentId, targetUserId: params.id,
    oldValue: { text: g.row.text, block_key: g.row.block_key, source: g.row.source },
  }, req)

  return NextResponse.json({ ok: true })
}
