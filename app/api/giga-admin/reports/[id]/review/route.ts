import { NextResponse, type NextRequest } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { decideReportReview, listReviews } from '@/lib/reports/review-flow'
import { ReviewBodySchema, reviewResponse } from '@/lib/reports/review-http'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** GET /api/giga-admin/reports/:id/review — the decision on this version, if any. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireGiga(req, 'reports.review')
  if (g.response) return g.response
  if (!UUID.test(params.id)) return NextResponse.json({ ok: false, error: 'Версия отчёта не найдена' }, { status: 404 })
  const items = await listReviews({ versionId: params.id, limit: 5 })
  return NextResponse.json({ ok: true, items })
}

/**
 * POST /api/giga-admin/reports/:id/review { decision, comment? } — the expert
 * decision from GIGA / the SuperExpert cabinet (reports.review; requireGiga
 * already ran the staff 2FA gate). Same function as the expert cabinet and
 * the expert bot: decideReportReview.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireGiga(req, 'reports.review')
  if (g.response) return g.response
  const parsed = ReviewBodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Неверные данные: для правок нужен комментарий (от 3 символов)' }, { status: 400 })
  try {
    const res = await decideReportReview({
      versionId: params.id,
      reviewerId: g.actor.id,
      decision: parsed.data.decision,
      comment: parsed.data.decision === 'changes_requested' ? parsed.data.comment : null,
      channel: 'web',
      mfaVerified: true,
      audit: (entry, opts) => recordAdminAction(g.actor, entry, req, opts),
    })
    return reviewResponse(res)
  } catch (err) {
    console.error('[giga-admin/reports/:id/review]', err instanceof Error ? err.message.split('\n')[0] : err)
    return NextResponse.json({ ok: false, error: 'Не удалось сохранить решение' }, { status: 500 })
  }
}
