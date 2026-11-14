import { NextResponse, type NextRequest } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { filterByScope, scopedCompanyIds } from '@/lib/admin/client-scope'
import { dbError } from '@/lib/api-error'
import { listInReviewVersions, listReviews, type ReviewVersionHead } from '@/lib/reports/review-flow'
import { companiesWithClosedSection, REPORT_SECTION } from '@/lib/access/owner-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/giga-admin/reports/review — versions waiting for the expert
 * (status 'in_review') and the latest decisions. reports.review: admin,
 * super_admin, super_expert.
 *
 * R2-C (M-4, product review M-4): every item says whether the client has
 * Точка А closed (`clientPaidLocked`, one batch decision for the owners of all
 * companies) — such a client sees only the notice that the report is ready.
 * A failed decision → the flag is absent (no misleading note).
 */
async function withPaidFlag(items: ReviewVersionHead[]): Promise<Array<ReviewVersionHead & { clientPaidLocked?: boolean }>> {
  const closed = await companiesWithClosedSection(items.map((i) => i.company_id), REPORT_SECTION)
  return items.map((i) => (closed.has(i.company_id) ? { ...i, clientPaidLocked: true } : i))
}
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'reports.review')
  if (g.response) return g.response
  try {
    const [items, decisions] = await Promise.all([listInReviewVersions(100), listReviews({ limit: 30 })])
    // Client scope 'assigned' (R-047): versions of the actor's clients only;
    // decisions only on those versions.
    const allowed = await scopedCompanyIds(g.actor)
    if (!allowed) return NextResponse.json({ ok: true, items: await withPaidFlag(items), decisions })
    const visible = filterByScope(items, allowed, (i) => i.company_id)
    const ids = new Set(visible.map((i) => i.id))
    return NextResponse.json({ ok: true, items: await withPaidFlag(visible), decisions: decisions.filter((d) => ids.has(d.report_version_id)) })
  } catch (err) {
    return dbError('giga-admin/reports/review', err as { message?: string; code?: string }, 'Не удалось загрузить отчёты на проверке')
  }
}
