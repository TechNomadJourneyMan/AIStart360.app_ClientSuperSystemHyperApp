export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { guardPointAExpert } from '@/lib/admin/point-a-expert'
import { aiReviewGet, aiReviewWrite } from '@/lib/point-a/ai-review-route'

/**
 * /api/giga-admin/users/:id/point-a/ai-review — the expert's review of the AI
 * analysis of Point A in GIGA (User 360 → «Точка А», R3-SLA, решение PO «гибрид»).
 *   GET   read (users.view + users.sensitive, the client scope)
 *   PUT   { diagnosticId, edits } — save the corrections (clients.review, a client account)
 *   POST  { diagnosticId, edits? } — confirm: the client sees «Проверено экспертом: имя, дата»
 * The SLA task pa_ai_review (migration 152): a correction is the reaction, the confirmation the answer.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardPointAExpert(req, params.id, 'read')
  if (g.response) return g.response
  return aiReviewGet(g.sb, params.id)
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardPointAExpert(req, params.id, 'write')
  if (g.response) return g.response
  return aiReviewWrite(req, g.sb, { clientId: params.id, actor: g.actor, confirm: false, via: 'giga' })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardPointAExpert(req, params.id, 'write')
  if (g.response) return g.response
  return aiReviewWrite(req, g.sb, { clientId: params.id, actor: g.actor, confirm: true, via: 'giga' })
}
