export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { notifyUser } from '@/lib/notifications'

const EXPERT_ROLES = new Set(['expert', 'admin', 'super_admin'])
const VALID_BLOCKS = new Set(['finance', 'sales', 'operations', 'marketing', 'strategy'])

interface AuthoredProfile {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
  expert_title: string | null
}

interface RawComment {
  id: string
  client_id: string
  author_id: string
  author_title: string | null
  block_key: string | null
  text: string
  created_at: string
  updated_at: string
  author?: AuthoredProfile | null
}

function mapComment(row: RawComment) {
  return {
    id: row.id,
    clientId: row.client_id,
    authorId: row.author_id,
    authorTitle: row.author_title,
    authorName: row.author?.full_name ?? null,
    authorAvatarUrl: row.author?.avatar_url ?? null,
    authorRole: row.author?.role ?? null,
    blockKey: row.block_key,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function getViewer() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return { sb, user: null, profile: null }

  const { data: profile } = await sb
    .from('profiles')
    .select('id, role, full_name, expert_title')
    .eq('id', user.id)
    .maybeSingle()
  return { sb, user, profile }
}

// GET /api/expert/comments?clientId=<uuid|self>&blockKey=<optional>
export async function GET(req: NextRequest) {
  const { sb, user } = await getViewer()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const clientIdParam = req.nextUrl.searchParams.get('clientId') ?? 'self'
  const blockKey = req.nextUrl.searchParams.get('blockKey')

  const clientId = clientIdParam === 'self' ? user.id : clientIdParam
  if (!clientId) return NextResponse.json({ data: [] })

  let query = sb
    .from('expert_comments')
    .select(
      'id, client_id, author_id, author_title, block_key, text, created_at, updated_at, author:profiles!expert_comments_author_id_fkey(id, full_name, avatar_url, role, expert_title)',
    )
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (blockKey && blockKey !== 'all') {
    if (blockKey === 'general') query = query.is('block_key', null)
    else query = query.eq('block_key', blockKey)
  }

  const { data, error } = await query
  if (error) {
    console.error('[expert/comments] GET error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ data: (data ?? []).map((r) => mapComment(r as unknown as RawComment)) })
}

// POST /api/expert/comments  body: { clientId, blockKey?, text }
export async function POST(req: NextRequest) {
  const { sb, user, profile } = await getViewer()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!profile || !EXPERT_ROLES.has(profile.role ?? ''))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let body: { clientId?: string; blockKey?: string | null; text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const clientId = body.clientId?.trim()
  const text = body.text?.trim()
  const blockKey = body.blockKey?.trim() || null

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (!text || text.length < 1 || text.length > 5000)
    return NextResponse.json({ error: 'text must be 1..5000 chars' }, { status: 400 })
  if (blockKey && !VALID_BLOCKS.has(blockKey))
    return NextResponse.json({ error: 'invalid blockKey' }, { status: 400 })

  const { data, error } = await sb
    .from('expert_comments')
    .insert({
      client_id: clientId,
      author_id: user.id,
      author_title: profile.expert_title ?? null,
      block_key: blockKey,
      text,
    })
    .select(
      'id, client_id, author_id, author_title, block_key, text, created_at, updated_at, author:profiles!expert_comments_author_id_fkey(id, full_name, avatar_url, role, expert_title)',
    )
    .single()

  if (error) {
    console.error('[expert/comments] POST error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const mapped = mapComment(data as unknown as RawComment)

  // Fire-and-forget notify the client
  notifyUser(clientId, 'expert_comment', {
    expertName: mapped.authorName ?? 'Эксперт',
    expertTitle: mapped.authorTitle,
    blockKey: mapped.blockKey,
    preview: mapped.text,
  })

  return NextResponse.json({ data: mapped })
}
