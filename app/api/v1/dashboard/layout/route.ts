export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { safeErrorMessage } from '@/lib/api-error'

/**
 * GET  /api/v1/dashboard/layout?surface=client   → { ok, layout, updatedAt }
 * PUT  /api/v1/dashboard/layout  { surface?, layout } → { ok }
 *
 * Per-user dashboard layout persistence (DASH-01). Cookie session only — the
 * user id is taken from the session, never the body (IDOR-safe), and RLS
 * (migration 042) additionally scopes every row to auth.uid().
 */
const surfaceSchema = z.string().trim().min(1).max(32)

export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const surface = surfaceSchema.catch('client').parse(req.nextUrl.searchParams.get('surface') ?? 'client')

  const { data, error } = await sb
    .from('dashboard_layouts')
    .select('layout, updated_at')
    .eq('user_id', user.id)
    .eq('surface', surface)
    .maybeSingle()

  if (error) return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  return NextResponse.json({ ok: true, layout: data?.layout ?? null, updatedAt: data?.updated_at ?? null })
}

const putSchema = z.object({
  surface: surfaceSchema.optional(),
  layout: z
    .array(z.object({ id: z.string().min(1), type: z.string().min(1) }).passthrough())
    .max(50),
})

export async function PUT(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const parsed = putSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid layout' },
      { status: 400 },
    )
  }

  const surface = parsed.data.surface ?? 'client'
  const { error } = await sb.from('dashboard_layouts').upsert(
    { user_id: user.id, surface, layout: parsed.data.layout, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,surface' },
  )

  if (error) return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  return NextResponse.json({ ok: true })
}
