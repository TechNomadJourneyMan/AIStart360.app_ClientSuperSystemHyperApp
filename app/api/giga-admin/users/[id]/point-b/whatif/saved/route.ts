export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/admin/client-scope'
import { fail, guardPlanRoute } from '@/lib/point-b/plan/route-guard'
import { listSaved, toView } from '@/lib/point-b/whatif-store'

/**
 * GET /api/giga-admin/users/:id/point-b/whatif/saved → { ok, data: Array<{ id, name, note, changes, summary,
 * modelVersion, proposedAt, createdAt }> } — the client’s saved «Что если» scenarios, READ ONLY (the same list
 * the client sees; `proposedAt` marks the ones he proposed). Needs `clients.review` and access to THIS client
 * (another expert’s client → 403). A client without a company, or before migration 127, has an empty list.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isUuid(params.id)) return fail('Клиент не найден', 404)
    const g = await guardPlanRoute(req, params.id)
    if (!g.ok) return g.response
    const { ctx } = g
    if (!ctx.company) return NextResponse.json({ ok: true, data: [] })
    const rows = await listSaved(ctx.sb, { companyId: ctx.company.id, userId: ctx.userId })
    return NextResponse.json({ ok: true, data: rows.map(toView) })
  } catch (err) {
    console.error('[giga/point-b/whatif/saved GET]', err instanceof Error ? err.message : err)
    return fail('Не удалось загрузить сохранённые сценарии клиента', 500)
  }
}
