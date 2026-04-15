export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// PATCH /api/expert/comments/[id]  body: { text }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: { text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const text = body.text?.trim()
  if (!text || text.length < 1 || text.length > 5000)
    return NextResponse.json({ error: 'text must be 1..5000 chars' }, { status: 400 })

  // RLS ensures only the author can update, but we also check explicitly for better errors
  const { data: existing } = await sb
    .from('expert_comments')
    .select('author_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (existing.author_id !== user.id)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { data, error } = await sb
    .from('expert_comments')
    .update({ text })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// DELETE /api/expert/comments/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { data: existing } = await sb
    .from('expert_comments')
    .select('author_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (existing.author_id !== user.id)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { error } = await sb.from('expert_comments').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
