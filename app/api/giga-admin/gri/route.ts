export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'
import { hasPermission } from '@/lib/admin/rbac'
import { maskEmail } from '@/lib/admin/mask'
import { NO_ID, scopedClientIds } from '@/lib/admin/client-scope'

// GET /api/giga-admin/gri?page=&current=1&min=&max= — all assessments across
// users + platform-level GRI statistics.
const PAGE = 25

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'gri.view')
  if (guard.response) return guard.response
  const sp = req.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const onlyCurrent = sp.get('current') !== '0'
  const min = Number(sp.get('min'))
  const max = Number(sp.get('max'))
  const sb = createServiceClient()

  let q = sb
    .from('gri_assessments')
    .select('id, user_id, gri_index, section_avgs, is_current, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1)
  if (onlyCurrent) q = q.eq('is_current', true)
  // Эксперт со scope 'assigned': список замеров и черновиков — только свои клиенты.
  const allowed = await scopedClientIds(guard.actor)
  const scopeIds = allowed ? (allowed.length ? allowed : [NO_ID]) : null
  if (scopeIds) q = q.in('user_id', scopeIds)
  let draftsQ = sb.from('gri_assessment_drafts').select('user_id, updated_at').order('updated_at', { ascending: false }).limit(20)
  if (scopeIds) draftsQ = draftsQ.in('user_id', scopeIds)
  if (Number.isFinite(min) && sp.get('min')) q = q.gte('gri_index', min)
  if (Number.isFinite(max) && sp.get('max')) q = q.lte('gri_index', max)

  const [list, all, drafts] = await Promise.all([
    q,
    sb.from('gri_assessments').select('gri_index, section_avgs').eq('is_current', true),
    draftsQ,
  ])
  if (list.error || all.error) return NextResponse.json({ ok: false, error: 'Не удалось загрузить GRI' }, { status: 500 })

  const current = all.data ?? []
  const avg = (vals: number[]) => (vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null)
  const blocks = GRI_SECTIONS.map((s) => ({
    id: s.id,
    avg: avg(current.map((c) => Number((c.section_avgs as Record<string, number> | null)?.[s.id] ?? 0)).filter((v) => v > 0)),
  }))
  const buckets = [0, 2, 4, 6, 8].map((lo) => ({
    label: `${lo}–${lo + 2}`,
    count: current.filter((c) => Number(c.gri_index) >= lo && (lo === 8 ? Number(c.gri_index) <= 10 : Number(c.gri_index) < lo + 2)).length,
  }))

  const ids = Array.from(new Set([...(list.data ?? []).map((r) => r.user_id), ...(drafts.data ?? []).map((d) => d.user_id)]))
  const { data: people } = ids.length
    ? await sb.from('profiles').select('id, email, full_name, organization').in('id', ids)
    : { data: [] as Array<{ id: string; email: string; full_name: string | null; organization: string | null }> }
  const sensitive = hasPermission(guard.actor.role, 'users.sensitive')
  const byId = new Map((people ?? []).map((p) => [p.id, { ...p, email: sensitive ? p.email : maskEmail(p.email) }]))

  return NextResponse.json({
    ok: true,
    data: {
      stats: {
        users: current.length,
        avgIndex: avg(current.map((c) => Number(c.gri_index))),
        blocks,
        buckets,
        drafts: (drafts.data ?? []).length,
      },
      list: (list.data ?? []).map((r) => ({ ...r, gri_index: Number(r.gri_index), user: byId.get(r.user_id) ?? null })),
      drafts: (drafts.data ?? []).map((d) => ({ ...d, user: byId.get(d.user_id) ?? null })),
      total: list.count ?? 0,
      page,
      pageSize: PAGE,
    },
  })
}
