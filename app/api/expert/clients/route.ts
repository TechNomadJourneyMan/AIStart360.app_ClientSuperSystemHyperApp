export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

const EXPERT_ROLES = new Set(['expert', 'admin', 'super_admin'])

// GET /api/expert/clients — list of all clients with latest diagnostic + company name
export async function GET() {
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

  // All client profiles
  const { data: clients, error } = await sb
    .from('profiles')
    .select('id, full_name, email, avatar_url, status, created_at')
    .eq('role', 'client')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (clients ?? []).map((c) => c.id)
  if (ids.length === 0) return NextResponse.json({ data: [] })

  // Latest diagnostic per client (simple: we fetch all, reduce in memory)
  const { data: diagnostics } = await sb
    .from('diagnostics')
    .select('user_id, overall_score, health_index, stage, calculated_at')
    .in('user_id', ids)
    .order('calculated_at', { ascending: false })

  const latest = new Map<string, { overall_score?: number; health_index?: number; stage?: string; calculated_at?: string }>()
  for (const d of diagnostics ?? []) {
    if (!latest.has(d.user_id)) latest.set(d.user_id, d)
  }

  // Company name per client
  const { data: companies } = await sb
    .from('companies')
    .select('user_id, name, industry, stage')
    .in('user_id', ids)
  const companyByUser = new Map<string, { name: string; industry?: string; stage?: string }>()
  for (const c of companies ?? []) {
    if (!companyByUser.has(c.user_id)) companyByUser.set(c.user_id, c)
  }

  // Expert comment counts per client
  const { data: counts } = await sb
    .from('expert_comments')
    .select('client_id')
    .in('client_id', ids)
  const commentCount = new Map<string, number>()
  for (const c of counts ?? []) {
    commentCount.set(c.client_id, (commentCount.get(c.client_id) ?? 0) + 1)
  }

  const result = (clients ?? []).map((c) => {
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
