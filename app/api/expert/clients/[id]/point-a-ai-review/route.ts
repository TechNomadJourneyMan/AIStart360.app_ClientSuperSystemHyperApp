export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { expertBlockResponse, guardExpertClient, resolveExpert, type ExpertViewer } from '@/lib/expert-auth'
import { createServiceClient } from '@/lib/supabase-service'
import type { AuditActor } from '@/lib/admin/audit'
import { aiReviewGet, aiReviewWrite } from '@/lib/point-a/ai-review-route'

/**
 * /api/expert/clients/:id/point-a-ai-review — the expert's review of the AI
 * analysis of Point A in the expert cabinet (R3-SLA, решение PO «гибрид»):
 * an approved expert for an ASSIGNED client (rule 140), a staff Admin / Super
 * Admin for any client (guardExpertClient).
 *   GET   read
 *   PUT   { diagnosticId, edits } — save the corrections (the SLA reaction)
 *   POST  { diagnosticId, edits? } — confirm («Проверено экспертом», the SLA answer)
 */
function actorOf(viewer: ExpertViewer): AuditActor {
  return { id: viewer.id, kind: 'session', email: viewer.email ?? undefined, role: viewer.role === 'admin' || viewer.role === 'super_admin' ? viewer.role : undefined }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const denied = await guardExpertClient(auth.viewer, params.id)
  if (denied) return denied
  return aiReviewGet(createServiceClient(), params.id)
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const denied = await guardExpertClient(auth.viewer, params.id)
  if (denied) return denied
  return aiReviewWrite(req, createServiceClient(), { clientId: params.id, actor: actorOf(auth.viewer), confirm: false, via: 'expert-portal' })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const denied = await guardExpertClient(auth.viewer, params.id)
  if (denied) return denied
  return aiReviewWrite(req, createServiceClient(), { clientId: params.id, actor: actorOf(auth.viewer), confirm: true, via: 'expert-portal' })
}
