export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { dbError } from '@/lib/api-error'
import { expertBlockResponse, resolveExpert } from '@/lib/expert-auth'

// Both handlers: approved expert/admin with the second factor where required
// (resolveExpert); a refused caller gets the MFA code the UI acts on.

// GET /api/expert/profile — current expert's profile fields relevant to the UI
export async function GET() {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const sb = createServerClient()

  const { data, error } = await sb
    .from('profiles')
    .select('id, full_name, email, avatar_url, role, expert_title')
    .eq('id', auth.viewer.id)
    .maybeSingle()

  if (error) return dbError('expert/profile', error)
  return NextResponse.json({ data })
}

// PATCH /api/expert/profile  body: { expertTitle?, fullName?, avatarUrl? }
export async function PATCH(req: NextRequest) {
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const sb = createServerClient()

  let body: { expertTitle?: string | null; fullName?: string; avatarUrl?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (body.expertTitle !== undefined) {
    const t = (body.expertTitle ?? '').toString().trim()
    update.expert_title = t.length > 0 ? t.slice(0, 120) : null
  }
  if (body.fullName !== undefined) {
    const n = body.fullName.toString().trim()
    if (n.length >= 1 && n.length <= 200) update.full_name = n
  }
  if (body.avatarUrl !== undefined) {
    update.avatar_url = body.avatarUrl || null
  }

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { data, error } = await sb
    .from('profiles')
    .update(update)
    .eq('id', auth.viewer.id)
    .select('id, full_name, email, avatar_url, role, expert_title')
    .single()

  if (error) return dbError('expert/profile', error)
  return NextResponse.json({ data })
}
