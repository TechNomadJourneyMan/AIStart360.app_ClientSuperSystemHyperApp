export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { forbidTarget, requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isReviewBlockKey, reviewBlockLabel, toStoredBlockKey } from '@/lib/expert-review/blocks'
import { COMMENT_COLUMNS, UUID_RE, ensureDraftReview, type CommentRow } from '@/lib/expert-review/server'

/**
 * POST /api/giga-admin/users/:id/review/comments { block, text }
 *
 * Добавляет комментарий в ЧЕРНОВИК разбора. Клиент его не видит и ничего не
 * получает — письмо и уведомление уходят один раз, при публикации разбора.
 */

const bodySchema = z.object({
  block: z.string().refine(isReviewBlockKey, 'Неизвестный блок'),
  text: z.string().trim().min(1, 'Комментарий пустой').max(5000, 'Не больше 5000 символов'),
})

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'clients.review')
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  const denied = await forbidTarget(guard.actor, params.id)
  if (denied) return denied

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный комментарий' }, { status: 400 })
  }
  const block = parsed.data.block as Parameters<typeof toStoredBlockKey>[0]

  const sb = createServiceClient()
  let reviewId: string
  try {
    reviewId = (await ensureDraftReview(sb, params.id, guard.actor.id)).id
  } catch {
    return NextResponse.json({ ok: false, error: 'Не удалось создать черновик разбора' }, { status: 500 })
  }

  const { data, error } = await sb
    .from('expert_comments')
    .insert({
      client_id: params.id,
      author_id: guard.actor.id,
      block_key: toStoredBlockKey(block),
      text: parsed.data.text,
      status: 'draft',
      source: 'expert',
      review_id: reviewId,
    })
    .select(COMMENT_COLUMNS)
    .single()
  if (error || !data) return NextResponse.json({ ok: false, error: 'Не удалось сохранить комментарий' }, { status: 500 })

  const row = data as CommentRow
  await recordAdminAction(guard.actor, {
    action: 'expert.comment_draft_added', entityType: 'expert_comment', entityId: row.id, targetUserId: params.id,
    metadata: { reviewId, block, preview: parsed.data.text.slice(0, 120) },
  }, req)

  return NextResponse.json({ ok: true, data: { ...row, block_label: reviewBlockLabel(row.block_key) } })
}
