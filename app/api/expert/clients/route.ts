export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { expertBlockResponse, expertSeesAllClients, resolveExpert } from '@/lib/expert-auth'
import { createServiceClient } from '@/lib/supabase-service'
import { loadSurveyStaffStatuses } from '@/lib/survey/staff-status-load'
import { officialGriFromRows, type GriRowLike } from '@/lib/gri/official'
import { loadSnapshotsByDiagnostic, officialPointA } from '@/lib/point-a/official'

/**
 * Service-role REST fetch — bypasses RLS on profiles. The caller is authorised
 * by resolveExpert() first; then the list is the caller's client scope (the
 * rule of migration 140, SR-03): an expert sees only the clients assigned to
 * them (user_assignments.assignee_id — UI «Мои клиенты», PO decision), staff
 * Admin / Super Admin see every client.
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

// GET /api/expert/clients — the caller's clients (assigned; staff admins — all) with latest diagnostic + company + comment count.
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
  const CLIENT_SELECT = 'select=id,full_name,email,avatar_url,status,created_at&order=created_at.desc,id.asc'
  let clients: ClientRow[] | null
  if (expertSeesAllClients(auth.viewer)) {
    clients = await sbFetchAll<ClientRow>(`profiles?role=in.(client,owner)&${CLIENT_SELECT}`)
  } else {
    const assigned = await sbFetchAll<{ user_id: string }>(
      `user_assignments?assignee_id=eq.${encodeURIComponent(auth.viewer.id)}&select=user_id&order=user_id.asc`,
    )
    if (!assigned) return NextResponse.json({ error: 'failed to load clients' }, { status: 500 })
    const assignedIds = assigned.map((a) => a.user_id).filter(Boolean)
    clients = assignedIds.length
      ? await sbFetchByIds<ClientRow>(assignedIds, (idList) => `profiles?id=in.(${idList})&role=in.(client,owner)&${CLIENT_SELECT}`)
      : []
    // Chunked reads lose the global order: newest first, as for staff admins.
    clients?.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || a.id.localeCompare(b.id))
  }
  if (!clients) return NextResponse.json({ error: 'failed to load clients' }, { status: 500 })
  if (clients.length === 0) return NextResponse.json({ data: [] })

  const ids = clients.map((c) => c.id)

  interface DiagRow {
    id: string
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
  // The questionnaire status (survey Ф5): mode, express, full submitted. A failed
  // read leaves `survey: null` — the list itself never fails because of it.
  // GRI (R-036): the official GRI of each client (lib/gri/official.ts, 0–10) —
  // NOT diagnostics.overall_score, which is Point A (0–100).
  const [diagnostics, companies, comments, surveyStatuses, griRows] = await Promise.all([
    sbFetchByIds<DiagRow>(ids, (idList) =>
      `diagnostics?user_id=in.(${idList})&select=id,user_id,overall_score,health_index,stage,calculated_at&order=calculated_at.desc,id.asc`),
    sbFetchByIds<CompanyRow>(ids, (idList) =>
      `companies?user_id=in.(${idList})&select=user_id,name,industry,stage&order=user_id.asc`),
    sbFetchByIds<CommentRow>(ids, (idList) =>
      `expert_comments?client_id=in.(${idList})&select=client_id&order=id.asc`),
    loadSurveyStaffStatuses(createServiceClient(), ids),
    sbFetchByIds<GriRowLike>(ids, (idList) =>
      `gri_assessments?user_id=in.(${idList})&select=id,user_id,gri_index,section_avgs,is_current,created_at&order=created_at.desc,id.asc`),
  ])
  if (!diagnostics || !companies || !comments || !griRows) {
    return NextResponse.json({ error: 'failed to load client details' }, { status: 500 })
  }

  const latest = new Map<string, DiagRow>()
  for (const d of diagnostics) {
    if (!latest.has(d.user_id)) latest.set(d.user_id, d)
  }

  // The OFFICIAL Point A of each latest diagnostic (lib/point-a/official.ts,
  // R-033/R-032): no score → null, never a v1 number from an incomplete survey.
  const snaps = await loadSnapshotsByDiagnostic(createServiceClient(), [...latest.values()].map((d) => d.id))
  const officialByUser = new Map([...latest.entries()].map(([uid, d]) => [uid, officialPointA(d as unknown as Record<string, unknown>, snaps.get(d.id) ?? null)] as const))

  const companyByUser = new Map<string, CompanyRow>()
  for (const c of companies) {
    if (!companyByUser.has(c.user_id)) companyByUser.set(c.user_id, c)
  }

  const commentCount = new Map<string, number>()
  for (const c of comments) {
    commentCount.set(c.client_id, (commentCount.get(c.client_id) ?? 0) + 1)
  }

  const griByUser = officialGriFromRows(griRows)

  const result = clients.map((c) => {
    const diag = latest.get(c.id)
    const official = officialByUser.get(c.id) ?? null
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
      stage: (official?.state === 'scored' ? official.stage : null) ?? comp?.stage ?? null,
      overallScore: official?.state === 'scored' ? official.overall : null,
      healthIndex: official?.state === 'scored' ? official.health_index : null,
      /** Official GRI, 0–10; null = «нет данных» (never Point A). */
      griIndex: griByUser.get(c.id)?.index ?? null,
      calculatedAt: diag?.calculated_at ?? null,
      commentsCount: commentCount.get(c.id) ?? 0,
      survey: surveyStatuses.get(c.id) ?? null,
    }
  })

  return NextResponse.json({ data: result })
}
