export const dynamic = 'force-dynamic'

// Expert version / corrections of a client's Point B (§15.2/§19).
//  POST — save the expert's strategic notes (+ optional edited roadmap).
//  GET  — latest version (for the expert editor).
// Staff-only; the client reads the approved version via /api/v1/diagnostics/point-b.

import { NextRequest, NextResponse } from 'next/server'
import { requireExpert, srGet } from '@/lib/expert-auth'
import { createClient as createSr } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'

function sr() {
  return createSr(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function currentDiagId(clientId: string): Promise<string | null> {
  const rows = await srGet<Array<{ id: string }>>(
    `diagnostics?user_id=eq.${clientId}&is_current=eq.true&select=id&limit=1`,
  )
  return rows?.[0]?.id ?? null
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  const diagId = await currentDiagId(params.id)
  if (!diagId) return NextResponse.json({ ok: true, data: null })
  const rows = await srGet<Array<Record<string, unknown>>>(
    `point_b_versions?diagnostic_id=eq.${diagId}&order=created_at.desc&limit=1&select=*`,
  )
  return NextResponse.json({ ok: true, data: rows?.[0] ?? null })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const viewer = await requireExpert()
  if (!viewer) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as { expert_notes?: string; roadmap?: unknown } | null
  const notes = String(body?.expert_notes ?? '').trim()
  if (!notes) return NextResponse.json({ ok: false, error: 'expert_notes required' }, { status: 400 })
  if (notes.length > 8000) return NextResponse.json({ ok: false, error: 'expert_notes too long' }, { status: 400 })

  const diagId = await currentDiagId(params.id)
  if (!diagId) return NextResponse.json({ ok: false, error: 'client has no current diagnostic' }, { status: 400 })

  const admin = sr()
  const { data, error } = await admin
    .from('point_b_versions')
    .insert({
      diagnostic_id: diagId,
      authored_by: viewer.id,
      author_name: viewer.email,
      expert_notes: notes,
      roadmap: body?.roadmap ?? null,
      is_approved: true,
    })
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  logAudit({
    entityType: 'user', entityId: params.id, action: 'expert.point_b_version_created',
    performedBy: viewer.id, diff: { preview: notes.slice(0, 120) }, ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ ok: true, data })
}
