import { NextResponse, type NextRequest } from 'next/server'
import { recordAdminAction } from '@/lib/admin/audit'
import { isSameOriginMutation } from '@/lib/admin/giga-actor'
import { expertBlockResponse, resolveExpert } from '@/lib/expert-auth'
import { decideReportReview } from '@/lib/reports/review-flow'
import { ReviewBodySchema, reviewResponse } from '@/lib/reports/review-http'

export const dynamic = 'force-dynamic'

/**
 * POST /api/expert/reports/:id/review
 *   { decision: 'approve' }                         → published to the client at once
 *   { decision: 'changes_requested', comment }      → back to the report agent
 * Gate: resolveExpert (approved expert / admin / super_admin + the staff 2FA
 * gate). decideReportReview re-reads the role, the approval and the version
 * status; the audit entry is written first. A repeated decision is a no-op.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ ok: false, error: 'Cross-site request blocked' }, { status: 403 })
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const parsed = ReviewBodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверные данные: для правок нужен комментарий (от 3 символов)' }, { status: 400 })
  const actor = { id: auth.viewer.id, kind: 'session' as const, email: auth.viewer.email ?? undefined }
  try {
    const res = await decideReportReview({
      versionId: params.id,
      reviewerId: auth.viewer.id,
      decision: parsed.data.decision,
      comment: parsed.data.decision === 'changes_requested' ? parsed.data.comment : null,
      channel: 'web',
      mfaVerified: true,
      audit: (entry, opts) => recordAdminAction(actor, { ...entry, metadata: { ...(entry.metadata ?? {}), via: 'expert_cabinet' } }, req, opts),
    })
    return reviewResponse(res)
  } catch (err) {
    console.error('[api/expert/reports/:id/review]', err instanceof Error ? err.message.split('\n')[0] : err)
    return NextResponse.json({ ok: false, error: 'Не удалось сохранить решение' }, { status: 500 })
  }
}
