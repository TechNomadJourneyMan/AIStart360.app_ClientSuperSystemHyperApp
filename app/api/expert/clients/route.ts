export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

const EXPERT_ROLES = new Set(['expert', 'admin', 'super_admin'])

/**
 * Service-role REST fetch — bypasses RLS on profiles (which only exposes
 * super_admin/admin/manager by default). We authorise the expert caller
 * manually above, then read all client profiles directly.
 */
async function sbFetch<T = unknown>(path: string): Promise<T | null> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
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

// GET /api/expert/clients — list of all clients with latest diagnostic + company + comment count
export async function GET() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // Authorise via service-role fetch to avoid profiles RLS infinite-recursion
  // (profiles_admin_select subqueries profiles, which re-triggers itself)
  interface ViewerRow { id: string; role: string | null }
  const viewers = await sbFetch<ViewerRow[]>(
    `profiles?id=eq.${user.id}&select=id,role&limit=1`,
  )
  const viewer = viewers?.[0] ?? null
  if (!viewer || !EXPERT_ROLES.has(viewer.role ?? ''))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Read all client profiles via service role (bypass RLS)
  interface ClientRow {
    id: string
    full_name: string | null
    email: string | null
    avatar_url: string | null
    status: string | null
    created_at: string
  }
  const clients = await sbFetch<ClientRow[]>(
    'profiles?role=eq.client&select=id,full_name,email,avatar_url,status,created_at&order=created_at.desc',
  )
  if (!clients) return NextResponse.json({ error: 'failed to load clients' }, { status: 500 })
  if (clients.length === 0) return NextResponse.json({ data: [] })

  const ids = clients.map((c) => c.id)
  const idList = ids.map((i) => `"${i}"`).join(',')

  interface DiagRow {
    user_id: string
    overall_score: number | null
    health_index: number | null
    stage: string | null
    calculated_at: string | null
  }
  const diagnostics =
    (await sbFetch<DiagRow[]>(
      `diagnostics?user_id=in.(${idList})&select=user_id,overall_score,health_index,stage,calculated_at&order=calculated_at.desc`,
    )) ?? []

  const latest = new Map<string, DiagRow>()
  for (const d of diagnostics) {
    if (!latest.has(d.user_id)) latest.set(d.user_id, d)
  }

  interface CompanyRow {
    user_id: string
    name: string | null
    industry: string | null
    stage: string | null
  }
  const companies =
    (await sbFetch<CompanyRow[]>(
      `companies?user_id=in.(${idList})&select=user_id,name,industry,stage`,
    )) ?? []
  const companyByUser = new Map<string, CompanyRow>()
  for (const c of companies) {
    if (!companyByUser.has(c.user_id)) companyByUser.set(c.user_id, c)
  }

  interface CommentRow {
    client_id: string
  }
  const comments =
    (await sbFetch<CommentRow[]>(
      `expert_comments?client_id=in.(${idList})&select=client_id`,
    )) ?? []
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
