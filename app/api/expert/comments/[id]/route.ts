export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { notifyAdmins } from '@/lib/notifications'
import { expertBlockResponse, resolveExpert } from '@/lib/expert-auth'

// Service-role helper — bypasses RLS (profiles RLS has infinite recursion bug)
function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  }
}

async function srFetch(method: string, path: string, body?: unknown): Promise<Response | null> {
  const { url, key } = srBase()
  if (!url || !key) return null
  return fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
}

// PATCH /api/expert/comments/[id]  body: { text }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  // Only an approved expert (second factor where required) edits / deletes,
  // and only their own comment.
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const user = auth.viewer

  let body: { text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const text = body.text?.trim()
  if (!text || text.length < 1 || text.length > 5000)
    return NextResponse.json({ error: 'text must be 1..5000 chars' }, { status: 400 })

  // Check ownership via service-role (avoids expert_read_all → profiles RLS recursion)
  const res = await srFetch('GET', `expert_comments?id=eq.${params.id}&select=author_id&limit=1`)
  if (!res?.ok) return NextResponse.json({ error: 'server error' }, { status: 500 })
  const rows = (await res.json()) as Array<{ author_id: string }>
  if (!rows[0]) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (rows[0].author_id !== user.id)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const now = new Date().toISOString()
  const upd = await srFetch(
    'PATCH',
    `expert_comments?id=eq.${params.id}`,
    { text, updated_at: now },
  )
  if (!upd?.ok) return NextResponse.json({ error: 'failed to update' }, { status: 500 })
  const updated = await upd.json()
  notifyAdmins('expert_comment_edited', {
    commentId: params.id,
    authorId: user.id,
    preview: text.slice(0, 200),
  })
  return NextResponse.json({ data: Array.isArray(updated) ? updated[0] : updated })
}

// DELETE /api/expert/comments/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  // Only an approved expert (second factor where required) edits / deletes,
  // and only their own comment.
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)
  const user = auth.viewer

  // Check ownership via service-role
  const res = await srFetch('GET', `expert_comments?id=eq.${params.id}&select=author_id&limit=1`)
  if (!res?.ok) return NextResponse.json({ error: 'server error' }, { status: 500 })
  const rows = (await res.json()) as Array<{ author_id: string }>
  if (!rows[0]) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (rows[0].author_id !== user.id)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const del = await srFetch('DELETE', `expert_comments?id=eq.${params.id}`)
  if (!del?.ok) return NextResponse.json({ error: 'failed to delete' }, { status: 500 })
  notifyAdmins('expert_comment_deleted', {
    commentId: params.id,
    authorId: user.id,
  })
  return NextResponse.json({ ok: true })
}
