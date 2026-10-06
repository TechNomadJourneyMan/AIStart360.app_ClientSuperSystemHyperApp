export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { expertBlockResponse, resolveExpert } from '@/lib/expert-auth'

/**
 * Service-role REST fetch — bypasses RLS on profiles (which only exposes
 * super_admin/admin/manager by default). The caller is authorised by
 * resolveExpert() first, then all client profiles are read directly.
 */
async function sbFetch<T = unknown>(path: string): Promise<T | null> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key) return null
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[expert/clients] fetch', res.status, await res.text().catch(() => ''))
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.error('[expert/clients] fetch error:', err)
    return null
  }
}

/** PostgREST answers at most this many rows per request (hosted max_rows). */
const PAGE = 1000
/** Ids per `in.(…)` filter: ~39 URL characters each, so the URL stays short. */
const ID_CHUNK = 50

/** Every row of `path` (which has its own filters / order), page by page; null if any page fails. */
async function sbFetchAll<T>(path: string): Promise<T[] | null> {
  const out: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await sbFetch<T[]>(`${path}&limit=${PAGE}&offset=${offset}`)
    if (!page) return null
    out.push(...page)
    if (page.length < PAGE) return out
  }
}

/** sbFetchAll for `ids` split into short `in.(…)` lists; null if any chunk fails. */
async function sbFetchByIds<T>(ids: string[], build: (idList: string) => string): Promise<T[] | null> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const idList = ids.slice(i, i + ID_CHUNK).map((id) => `"${id}"`).join(',')
    const rows = await sbFetchAll<T>(build(idList))
    if (!rows) return null
    out.push(...rows)
  }
  return out
}

// GET /api/expert/clients — list of all clients with latest diagnostic + company + comment count.
// Every read is paginated (no silent 1000-row cap) and the id filters are
// chunked (no over-long URLs). A failed read answers 500 — it is never shown
// as «no company / no score / 0 comments».
export async function GET() {
  // Approved expert/admin with the second factor where required (lib/expert-auth).
  const auth = await resolveExpert()
  if (!auth.ok) return expertBlockResponse(auth.block)

  // Read all client profiles via service role (bypass RLS)
  interface ClientRow {
    id: string
    full_name: string | null
    email: string | null
    avatar_url: string | null
    status: string | null
    created_at: string
  }
  const clients = await sbFetchAll<ClientRow>(
    'profiles?role=eq.client&select=id,full_name,email,avatar_url,status,created_at&order=created_at.desc,id.asc',
  )
  if (!clients) return NextResponse.json({ error: 'failed to load clients' }, { status: 500 })
  if (clients.length === 0) return NextResponse.json({ data: [] })

  const ids = clients.map((c) => c.id)

  interface DiagRow {
    user_id: string
    overall_score: number | null
    health_index: number | null
    stage: string | null
    calculated_at: string | null
  }
  interface CompanyRow {
    user_id: string
    name: string | null
    industry: string | null
    stage: string | null
  }
  interface CommentRow {
    client_id: string
  }
  const [diagnostics, companies, comments] = await Promise.all([
    sbFetchByIds<DiagRow>(ids, (idList) =>
      `diagnostics?user_id=in.(${idList})&select=user_id,overall_score,health_index,stage,calculated_at&order=calculated_at.desc,id.asc`),
    sbFetchByIds<CompanyRow>(ids, (idList) =>
      `companies?user_id=in.(${idList})&select=user_id,name,industry,stage&order=user_id.asc`),
    sbFetchByIds<CommentRow>(ids, (idList) =>
      `expert_comments?client_id=in.(${idList})&select=client_id&order=id.asc`),
  ])
  if (!diagnostics || !companies || !comments) {
    return NextResponse.json({ error: 'failed to load client details' }, { status: 500 })
  }

  const latest = new Map<string, DiagRow>()
  for (const d of diagnostics) {
    if (!latest.has(d.user_id)) latest.set(d.user_id, d)
  }

  const companyByUser = new Map<string, CompanyRow>()
  for (const c of companies) {
    if (!companyByUser.has(c.user_id)) companyByUser.set(c.user_id, c)
  }

  const commentCount = new Map<string, number>()
  for (const c of comments) {
    commentCount.set(c.client_id, (commentCount.get(c.client_id) ?? 0) + 1)
  }

  const result = clients.map((c) => {
    const diag = latest.get(c.id)
    const comp = companyByUser.get(c.id)
    return {
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      avatarUrl: c.avatar_url,
      status: c.status,
      createdAt: c.created_at,
      companyName: comp?.name ?? null,
      industry: comp?.industry ?? null,
      stage: diag?.stage ?? comp?.stage ?? null,
      overallScore: diag?.overall_score ?? null,
      healthIndex: diag?.health_index ?? null,
      calculatedAt: diag?.calculated_at ?? null,
      commentsCount: commentCount.get(c.id) ?? 0,
    }
  })

  return NextResponse.json({ data: result })
}
