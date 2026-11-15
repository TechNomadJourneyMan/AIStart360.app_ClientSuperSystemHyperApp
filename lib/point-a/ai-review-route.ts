/**
 * lib/point-a/ai-review-route.ts — the handlers of the expert's review of the
 * AI analysis of Point A, shared by
 *   GIGA            /api/giga-admin/users/:id/point-a/ai-review   (guardPointAExpert:
 *                   read users.view + users.sensitive, write clients.review, client scope)
 *   expert cabinet  /api/expert/clients/:id/point-a-ai-review      (resolveExpert +
 *                   guardExpertClient: an assigned client)
 * The caller authorises; the handlers read / write with the service role.
 *
 *   GET   → { ok, data: AiReviewData }
 *   PUT   { diagnosticId, edits } — save the corrections (the SLA reaction)
 *   POST  { diagnosticId, edits? } — confirm («Проверено экспертом», the SLA answer)
 * Every write is in the admin journal (recordAdminAction — the journal logAudit writes to,
 * with the actor's role): point_a.ai_review.edited / point_a.ai_review.confirmed.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAdminAction, type AuditActor } from '@/lib/admin/audit'
import { displayNameOf } from '@/lib/expert-review/server'
import { profanityResponse, textOf } from '@/lib/moderation/http'
import { AiExpertEditsSchema } from './ai-review'
import { loadAiReview, saveAiReview } from './ai-review-store'

export const AI_REVIEW_AUDIT = { edited: 'point_a.ai_review.edited', confirmed: 'point_a.ai_review.confirmed' } as const

export const AiReviewBodySchema = z.object({
  diagnosticId: z.string().uuid(),
  edits: AiExpertEditsSchema.nullable().optional(),
}).strict()

export async function aiReviewGet(sb: SupabaseClient, clientId: string): Promise<NextResponse> {
  try {
    return NextResponse.json({ ok: true, data: await loadAiReview(sb, clientId) })
  } catch (err) {
    console.error('[point-a/ai-review] read failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить разбор' }, { status: 500 })
  }
}

export async function aiReviewWrite(req: Request, sb: SupabaseClient, input: {
  clientId: string
  actor: AuditActor
  confirm: boolean
  via: 'giga' | 'expert-portal'
}): Promise<NextResponse> {
  const parsed = AiReviewBodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверные правки: проверьте поля (каждое — до 4000 символов, приоритетов до 6, действий до 8)' }, { status: 400 })
  const { diagnosticId } = parsed.data
  const edits = parsed.data.edits ?? null
  if (edits) {
    const profane = profanityResponse({ edits: textOf(edits) })
    if (profane) return profane
  }
  const name = await displayNameOf(sb, input.actor.id)
  const res = await saveAiReview(sb, { clientId: input.clientId, diagnosticId, edits, confirm: input.confirm, actor: { id: input.actor.id, name } })
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status })

  await recordAdminAction(input.actor, {
    action: input.confirm ? AI_REVIEW_AUDIT.confirmed : AI_REVIEW_AUDIT.edited,
    entityType: 'diagnostic',
    entityId: diagnosticId,
    targetUserId: input.clientId,
    newValue: input.confirm ? { reviewed_by_name: name } : undefined,
    metadata: { edited: res.edited, slaTaskId: res.taskId, via: input.via },
  }, req)
  return NextResponse.json({ ok: true, data: res.data })
}
