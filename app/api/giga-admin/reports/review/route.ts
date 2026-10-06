import { NextResponse, type NextRequest } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { dbError } from '@/lib/api-error'
import { listInReviewVersions, listReviews } from '@/lib/reports/review-flow'

export const dynamic = 'force-dynamic'

/**
 * GET /api/giga-admin/reports/review — versions waiting for the expert
 * (status 'in_review') and the latest decisions. reports.review: admin,
 * super_admin, super_expert.
 */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'reports.review')
  if (g.response) return g.response
  try {
    const [items, decisions] = await Promise.all([listInReviewVersions(100), listReviews({ limit: 30 })])
    return NextResponse.json({ ok: true, items, decisions })
  } catch (err) {
    return dbError('giga-admin/reports/review', err as { message?: string; code?: string }, 'Не удалось загрузить отчёты на проверке')
  }
}
