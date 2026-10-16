export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordAdminAction } from '@/lib/admin/audit'
import { badRequest, guardPointAExpert, staffDisplayName, zodMessage } from '@/lib/admin/point-a-expert'
import { isBlockKey } from '@/lib/point-a/v4/config'
import { getMetricById } from '@/lib/metrics/registry'
import { profanityResponse } from '@/lib/moderation/http'

/**
 * POST /api/giga-admin/users/:id/point-a/v4/comments
 *   { targetKind: 'overall' | 'block' | 'metric', targetKey?, body }
 * The expert's note on the whole Point A, a block or a metric — the client
 * sees it signed with the expert's name (point_a_comments, migration 117).
 */

const Body = z.object({
  targetKind: z.enum(['overall', 'block', 'metric']),
  targetKey: z.string().trim().min(1).max(120).nullable().optional(),
  body: z.string().trim().min(1, 'Введите текст комментария').max(2000, 'Комментарий длиннее 2000 символов'),
})

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardPointAExpert(req, params.id, 'write')
  if (g.response) return g.response
  const { actor, sb, companyId } = g

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest(zodMessage(parsed.error.issues))
  const { targetKind, body } = parsed.data
  const profane = profanityResponse({ body })
  if (profane) return profane
  const targetKey = targetKind === 'overall' ? null : parsed.data.targetKey ?? null
  if (targetKind === 'block' && !isBlockKey(targetKey)) return badRequest('Неизвестный блок')
  if (targetKind === 'metric' && (!targetKey || !getMetricById(targetKey))) return badRequest('Неизвестная метрика')

  const authorName = await staffDisplayName(sb, actor)
  const { data, error } = await sb
    .from('point_a_comments')
    .insert({ company_id: companyId, target_kind: targetKind, target_key: targetKey, body, author_id: actor.id, author_name: authorName, author_role: actor.role })
    .select('id, target_kind, target_key, body, author_name, author_role, created_at')
    .maybeSingle()
  if (error) {
    console.error('[giga-admin/point-a/comments] insert failed', error.code ?? '')
    return badRequest('Не удалось сохранить комментарий', 500)
  }

  await recordAdminAction(actor, {
    action: 'point_a.comment_added',
    entityType: 'company', entityId: companyId, targetUserId: params.id,
    newValue: { targetKind, targetKey, body },
    metadata: { commentId: (data as { id?: string } | null)?.id ?? null },
  }, req)

  return NextResponse.json({ ok: true, data })
}
