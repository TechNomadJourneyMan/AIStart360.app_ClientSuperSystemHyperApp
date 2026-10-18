export const dynamic = 'force-dynamic'

// Expert version / corrections of a client's Point B (§15.2/§19) — the OLD expert portal editor,
// now on top of PLAN VERSIONS (plan Phase 1 Task 6; point_b_versions is no longer written).
//  POST — save the expert's strategic notes as a version of the client's plan and send it for
//         approval: the client sees it only after Admin / Super Admin approves it
//         (POST /api/giga-admin/users/:id/point-b/plan/versions/:versionId/approve).
//         A draft is edited, otherwise a new one is created; a version already in review → 409.
//  GET  — the latest plan version in the legacy shape { id, expert_notes, author_name,
//         is_approved, created_at } (the legacy point_b_versions row when the client has no plan).
// Staff-only and only for the expert's assigned clients; the client reads the approved version
// via /api/v1/diagnostics/point-b and /api/v1/point-b/plan.

import { NextRequest, NextResponse } from 'next/server'
import { expertBlockResponse, guardExpertClient, resolveExpert } from '@/lib/expert-auth'
import { createServiceClient } from '@/lib/supabase-service'
import { recordAdminAction, type AuditActor } from '@/lib/admin/audit'
import { dbError } from '@/lib/api-error'
import { profanityResponse } from '@/lib/moderation/http'
import { displayNameOf } from '@/lib/expert-review/server'
import { authorKindOf, companyOfUser, latestPlanVersionLegacy, legacyShape, saveNotesAndSubmit } from '@/lib/point-b/plan/flow'
import { PLAN_AUDIT, planFailure } from '@/lib/point-b/plan/route-guard'

async function currentDiagId(sb: ReturnType<typeof createServiceClient>, clientId: string): Promise<string | null> {
  const { data } = await sb.from('diagnostics').select('id').eq('user_id', clientId).eq('is_current', true).limit(1)
  return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const denied = await guardExpertClient(auth.viewer, params.id)
  if (denied) return denied

  const sb = createServiceClient()
  try {
    const latest = await latestPlanVersionLegacy(sb, params.id)
    if (latest) return NextResponse.json({ ok: true, data: latest })
  } catch (error) {
    // The plan tables are not readable (e.g. before migration 125): fall back to the legacy row.
    console.error('[expert/point-b-version] plan not read, using the legacy version', error instanceof Error ? error.message : error)
  }
  const diagId = await currentDiagId(sb, params.id)
  if (!diagId) return NextResponse.json({ ok: true, data: null })
  const { data } = await sb
    .from('point_b_versions')
    .select('*')
    .eq('diagnostic_id', diagId)
    .order('created_at', { ascending: false })
    .limit(1)
  return NextResponse.json({ ok: true, data: ((data ?? []) as Array<Record<string, unknown>>)[0] ?? null })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const viewer = auth.viewer
  const denied = await guardExpertClient(viewer, params.id)
  if (denied) return denied

  const body = await req.json().catch(() => null) as { expert_notes?: string; change_reason?: string | null } | null
  const notes = String(body?.expert_notes ?? '').trim()
  if (!notes) return NextResponse.json({ ok: false, error: 'expert_notes required' }, { status: 400 })
  if (notes.length > 8000) return NextResponse.json({ ok: false, error: 'expert_notes too long' }, { status: 400 })
  const changeReason = typeof body?.change_reason === 'string' ? body.change_reason.trim().slice(0, 1000) || null : null
  const profane = profanityResponse({ expert_notes: notes, change_reason: changeReason })
  if (profane) return profane

  const sb = createServiceClient()
  try {
    const company = await companyOfUser(sb, params.id)
    if (!company) return NextResponse.json({ ok: false, error: 'client has no company' }, { status: 400 })

    // The client sees the label: a name, never the expert's email.
    const name = await displayNameOf(sb, viewer.id)
    const { version, created } = await saveNotesAndSubmit(sb, {
      companyId: company.id, userId: params.id, notes, changeReason,
      author: { id: viewer.id, name, kind: authorKindOf(viewer.role) },
    })

    const actor: AuditActor = { id: viewer.id, kind: 'session', email: viewer.email ?? undefined, role: viewer.role === 'admin' || viewer.role === 'super_admin' ? viewer.role : undefined }
    await recordAdminAction(actor, {
      action: created ? PLAN_AUDIT.created : PLAN_AUDIT.updated, entityType: 'pb_plan_version', entityId: version.id, targetUserId: params.id,
      metadata: { version: version.version, preview: notes.slice(0, 120), via: 'expert-portal' },
    }, req)
    await recordAdminAction(actor, {
      action: PLAN_AUDIT.submitted, entityType: 'pb_plan_version', entityId: version.id, targetUserId: params.id,
      oldValue: { status: 'draft' }, newValue: { status: version.status }, metadata: { version: version.version, via: 'expert-portal' },
    }, req)
    return NextResponse.json({ ok: true, data: legacyShape(version) })
  } catch (error) {
    return planFailure(error) ?? dbError('expert/clients/[id]/point-b-version', error as Error)
  }
}
