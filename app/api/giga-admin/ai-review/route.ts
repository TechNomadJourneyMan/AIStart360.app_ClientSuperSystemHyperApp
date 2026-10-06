import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { dbError } from '@/lib/api-error'
import { listReviewQueue } from '@/lib/reports/review'

export const dynamic = 'force-dynamic'

/**
 * GET /api/giga-admin/ai-review?company= — model output waiting for a person:
 * AI hypotheses (diagnostic_findings) and model recommendations, each with its
 * evidence and confidence. Same permission as «Модерация ИИ» (insights.moderate):
 * both decide whether model text may reach a client.
 */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'insights.moderate')
  if (g.response) return g.response
  try {
    const items = await listReviewQueue({ companyId: req.nextUrl.searchParams.get('company')?.slice(0, 64) || null })
    return NextResponse.json({ ok: true, items, can: { run: g.actor.permissions.includes('agents.run') } })
  } catch (err) {
    return dbError('giga-admin/ai-review', err as { message?: string; code?: string }, 'Не удалось загрузить очередь проверки')
  }
}
