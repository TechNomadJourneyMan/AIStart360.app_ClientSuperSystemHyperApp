export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { legacyShape } from '@/lib/point-b/plan/flow'
import { approveAndAudit, exceptionReasonOf, publishWarnings, findVersion, guarded, guardPlanRoute, versionNotFound } from '@/lib/point-b/plan/route-guard'

/**
 * POST /api/giga-admin/users/:id/review/point-b/approve { versionId, exceptionReason? }
 *
 * Одобрить экспертную версию Точки Б — только Admin / Super Admin (рангом выше
 * SuperExpert). `versionId` — версия ПЛАНА этого клиента; условия и исключение — те же, что в
 * …/point-b/plan/versions/:versionId/approve (главная цель проверена, причина изменений указана;
 * иначе 409 с `reasons`). После одобрения клиент видит версию в своей Точке Б.
 */

const bodySchema = z.object({
  // Looked up in THIS client's plan, so a foreign or malformed id is simply «not found».
  versionId: z.string().trim().min(1).max(64),
  exceptionReason: z.string().max(1000).nullable().optional(),
})

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return guarded('giga/review/point-b/approve POST', async () => {
    const g = await guardPlanRoute(req, params.id, { write: true, approver: true })
    if (!g.ok) return g.response
    const { ctx } = g

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Не указана версия' }, { status: 400 })
    const exception = exceptionReasonOf(parsed.data.exceptionReason)
    if ('response' in exception) return exception.response

    // The version must belong to THIS client's plan.
    const found = await findVersion(ctx, parsed.data.versionId)
    if (!found) return versionNotFound()

    const result = await approveAndAudit(req, ctx, found.version, exception.reason, 'legacy-route')
    return NextResponse.json({ ok: true, data: legacyShape(result.version), ...publishWarnings(result) })
  })
}
