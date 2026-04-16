export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { notifyUser } from '@/lib/notifications'

const EXPERT_ROLES = new Set(['expert', 'admin', 'super_admin'])
const MAX_TARGET_ID = 200  // see lib/comment-targets.ts — free-form TEXT, cap length

// ── Service-role helper ──────────────────────────────────────────────────────
// ALL DB reads/writes go through this to avoid profiles RLS infinite-recursion.
// (profiles_admin_select subqueries profiles itself → 42P17)
// Security is enforced manually in each handler rather than relying on RLS.

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
}

async function srGet<T = unknown>(path: string): Promise<T | null> {
  const { url, key } = srBase()
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[expert/comments] srGet', res.status, path)
      return null
    }
    return (await res.json()) as T
  } catch (e) {
    console.error('[expert/comments] srGet error', e)
    return null
  }
}

async function srPost<T = unknown>(table: string, body: Record<string, unknown>): Promise<T | null> {
  const { url, key } = srBase()
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      console.error('[expert/comments] srPost', res.status, txt)
      return null
    }
    const rows = (await res.json()) as T[]
    return (rows as unknown[])[0] as T ?? null
  } catch (e) {
    console.error('[expert/comments] srPost error', e)
    return null
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface AuthoredProfile {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
  expert_title: string | null
}

interface ViewerProfile {
  id: string
  role: string | null
  full_name: string | null
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

// Returns the authenticated user + their profile (via service-role, no RLS)
async function getViewer() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return { user: null, profile: null }

  const rows = await srGet<ViewerProfile[]>(
    `profiles?id=eq.${user.id}&select=id,role,full_name,expert_title&limit=1`,
  )
  const profile = rows?.[0] ?? null
  return { user, profile }
}

// Hydrates author info for a list of comment rows
async function hydrateAuthors(comments: RawComment[]): Promise<RawComment[]> {
  if (comments.length === 0) return comments
  const authorIds = Array.from(new Set(comments.map((c) => c.author_id)))
  const idList = authorIds.map((id) => `"${id}"`).join(',')
  const authors =
    (await srGet<AuthoredProfile[]>(
      `profiles?id=in.(${idList})&select=id,full_name,avatar_url,role,expert_title`,
    )) ?? []
  const byId = new Map(authors.map((a) => [a.id, a]))
  return comments.map((c) => ({ ...c, author: byId.get(c.author_id) ?? null }))
}

// ── GET /api/expert/comments?clientId=<uuid|self>&targetId=<optional> ───────
// Query params:
//   clientId: 'self' | uuid  — whose comments to fetch (default: self)
//   targetId: string | 'all' | 'general' | legacy block key
//     omitted / 'all' → no server-side filter (used by ExpertCommentsProvider
//     for batch-load; filtering happens client-side)
//   blockKey (deprecated): alias of targetId — still accepted for old clients
export async function GET(req: NextRequest) {
  const { user, profile } = await getViewer()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const clientIdParam = req.nextUrl.searchParams.get('clientId') ?? 'self'
  const targetId =
    req.nextUrl.searchParams.get('targetId') ?? req.nextUrl.searchParams.get('blockKey')

  const isExpert = profile && EXPERT_ROLES.has(profile.role ?? '')
  const clientId = clientIdParam === 'self' ? user.id : clientIdParam
  if (!clientId) return NextResponse.json({ data: [] })

  if (!isExpert && clientId !== user.id)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let qs = `expert_comments?client_id=eq.${clientId}`
    + `&select=id,client_id,author_id,author_title,block_key,text,created_at,updated_at`
    + `&order=created_at.desc`

  if (targetId && targetId !== 'all') {
    if (targetId === 'general') qs += '&block_key=is.null'
    else qs += `&block_key=eq.${encodeURIComponent(targetId)}`
  }

  const rows = await srGet<RawComment[]>(qs)
  if (!rows) return NextResponse.json({ error: 'failed to load comments' }, { status: 500 })

  const withAuthors = await hydrateAuthors(rows)
  return NextResponse.json({ data: withAuthors.map(mapComment) })
}

// ── POST /api/expert/comments  body: { clientId, targetId?|blockKey?, text } ─
// `targetId` is the generic identifier (any string from lib/comment-targets.ts
// registry, OR any free-form ≤200 chars). `blockKey` kept as deprecated alias.
// null/empty → general feed.
export async function POST(req: NextRequest) {
  const { user, profile } = await getViewer()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!profile || !EXPERT_ROLES.has(profile.role ?? ''))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let body: { clientId?: string; targetId?: string | null; blockKey?: string | null; text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const clientId = body.clientId?.trim()
  const text = body.text?.trim()
  const rawTarget = (body.targetId ?? body.blockKey ?? '').toString().trim()
  const targetId = rawTarget || null  // empty string → general feed

  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  if (!text || text.length < 1 || text.length > 5000)
    return NextResponse.json({ error: 'text must be 1..5000 chars' }, { status: 400 })
  if (targetId && targetId.length > MAX_TARGET_ID)
    return NextResponse.json({ error: `targetId must be ≤${MAX_TARGET_ID} chars` }, { status: 400 })

  const inserted = await srPost<RawComment>('expert_comments', {
    client_id: clientId,
    author_id: user.id,           // Security: always use authenticated user's id
    author_title: profile.expert_title ?? null,
    block_key: targetId,
    text,
  })

  if (!inserted) return NextResponse.json({ error: 'failed to create comment' }, { status: 500 })

  const authorProfile: AuthoredProfile = {
    id: user.id,
    full_name: profile.full_name ?? null,
    avatar_url: null,
    role: profile.role ?? null,
    expert_title: profile.expert_title ?? null,
  }
  const mapped = mapComment({ ...inserted, author: authorProfile })

  // Fire-and-forget notify the client
  notifyUser(clientId, 'expert_comment', {
    expertName: mapped.authorName ?? 'Эксперт',
    expertTitle: mapped.authorTitle,
    blockKey: mapped.blockKey,
    preview: mapped.text,
  })

  return NextResponse.json({ data: mapped })
}
