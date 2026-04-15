export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

const EXPERT_ROLES = new Set(['expert', 'admin', 'super_admin'])

// GET /api/expert/profile — current expert's profile fields relevant to the UI
export async function GET() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { data, error } = await sb
    .from('profiles')
    .select('id, full_name, email, avatar_url, role, expert_title')
    .eq('id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// PATCH /api/expert/profile  body: { expertTitle?, fullName?, avatarUrl? }
export async function PATCH(req: NextRequest) {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { data: viewer } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!viewer || !EXPERT_ROLES.has(viewer.role ?? ''))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

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
    .eq('id', user.id)
    .select('id, full_name, email, avatar_url, role, expert_title')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
