export const dynamic = 'force-dynamic'

// Expert version / corrections of a client's Point B (§15.2/§19).
//  POST — save the expert's strategic notes (+ optional edited roadmap) as a DRAFT:
//         the client sees it only after Admin / Super Admin approves it
//         (POST /api/giga-admin/users/:id/review/point-b/approve).
//  GET  — latest version (for the expert editor).
// Staff-only and only for the expert's assigned clients; the client reads the
// approved version via /api/v1/diagnostics/point-b.

import { NextRequest, NextResponse } from 'next/server'
import { expertBlockResponse, guardExpertClient, resolveExpert } from '@/lib/expert-auth'
import { createServiceClient } from '@/lib/supabase-service'
import { logAudit } from '@/lib/audit'
import { dbError } from '@/lib/api-error'
import { profanityResponse } from '@/lib/moderation/http'
import { displayNameOf } from '@/lib/expert-review/server'
import { saveExpertVersionDraft } from '@/lib/point-b/versions'

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

  const body = await req.json().catch(() => null) as { expert_notes?: string; roadmap?: unknown } | null
  const notes = String(body?.expert_notes ?? '').trim()
  if (!notes) return NextResponse.json({ ok: false, error: 'expert_notes required' }, { status: 400 })
  if (notes.length > 8000) return NextResponse.json({ ok: false, error: 'expert_notes too long' }, { status: 400 })
  const profane = profanityResponse({ expert_notes: notes })
  if (profane) return profane

  const sb = createServiceClient()
  const diagId = await currentDiagId(sb, params.id)
  if (!diagId) return NextResponse.json({ ok: false, error: 'client has no current diagnostic' }, { status: 400 })

  let data
  try {
    data = await saveExpertVersionDraft(sb, {
      diagnosticId: diagId,
      authorId: viewer.id,
      // The client sees the label: a name, never the expert's email.
      authorName: await displayNameOf(sb, viewer.id),
      notes,
      roadmap: body?.roadmap,
    })
  } catch (error) {
    return dbError('expert/clients/[id]/point-b-version', error as Error)
  }

  logAudit({
    entityType: 'user', entityId: params.id, action: 'expert.point_b_version_created',
    performedBy: viewer.id, diff: { preview: notes.slice(0, 120), approved: false }, ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ ok: true, data })
}
